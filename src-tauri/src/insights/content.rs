// ── Block C · Partieinhalt ───────────────────────────────────────────────────

/// Obergrenze für die Partieinhalt-Auswertung.
///
/// Block C ist der einzige Teil, der jede Partie nachspielen muss (für die
/// Eigenschaften des übersehenen Bestzuges und das Materialbild beim
/// Endspieleintritt). Bei mehreren tausend analysierten Partien wird das
/// spürbar, und die ältesten Partien sagen ohnehin am wenigsten über das
/// heutige Spiel. Gerechnet wird deshalb über die jüngsten Partien · wie viele
/// es waren, steht als `content.games` in der Oberfläche.
const CONTENT_LIMIT: usize = 600;

fn content_insights(views: &[GameView]) -> ContentInsights {
    let analyzed: Vec<&GameView> = views.iter().filter(|v| !v.evals.is_empty()).collect();
    let recent = &analyzed[analyzed.len().saturating_sub(CONTENT_LIMIT)..];
    content_from(recent)
}

fn content_from(views: &[&GameView]) -> ContentInsights {
    let mut out = ContentInsights::default();

    let (mut conv_games, mut conv_won, mut conv_drawn, mut conv_lost) = (0i64, 0i64, 0i64, 0i64);
    let mut conv_score = 0.0f64;
    let mut lost_at: Vec<f64> = Vec::new();
    let mut conv_phase = [0i64; 3];

    let (mut def_games, mut def_saved) = (0i64, 0i64);

    let mut decisive_moves: Vec<f64> = Vec::new();
    let mut decisive_phase = [0i64; 3];

    let (mut chances, mut missed) = (0i64, 0i64);

    let (mut errors, mut forcing_missed) = (0i64, 0i64);
    let (mut forcing_total, mut forcing_all) = (0i64, 0i64);
    let mut piece_errors: HashMap<&'static str, (i64, i64)> = HashMap::new();
    let mut forcing_losses: Vec<f64> = Vec::new();
    let mut quiet_losses: Vec<f64> = Vec::new();

    let mut endgames: HashMap<&'static str, (i64, f64, Vec<f64>)> = HashMap::new();

    for view in views {
        out.games += 1;
        let plies = view.evals.len() as i64;

        // Nachspielen brauchen wir für die Stellungen: Bestzug-Eigenschaften
        // und das Materialbild beim Endspieleintritt.
        let walked = chess::walk_sans(&view.raw.moves);

        let mut peak = f64::MIN;
        let mut low = f64::MAX;
        let mut advantage_lost_at: Option<i64> = None;
        for ply in 1..=plies {
            let Some(cp) = view.cp_mine(ply) else {
                continue;
            };
            if cp > peak {
                peak = cp;
            }
            if cp < low {
                low = cp;
            }
            if peak >= 200.0 && cp < 50.0 && advantage_lost_at.is_none() {
                advantage_lost_at = Some(ply);
            }
        }

        if peak >= 200.0 {
            conv_games += 1;
            conv_score += view.raw.score();
            match view.raw.result.as_str() {
                "win" => conv_won += 1,
                "draw" => conv_drawn += 1,
                _ => conv_lost += 1,
            }
            if view.raw.result != "win" {
                if let Some(ply) = advantage_lost_at {
                    lost_at.push(((ply + 1) / 2) as f64);
                    if let Some(ev) = view.evals.get((ply - 1) as usize) {
                        conv_phase[phase_index(&ev.phase)] += 1;
                    }
                }
            }
        }
        if low <= -200.0 {
            def_games += 1;
            if view.raw.result != "loss" {
                def_saved += 1;
            }
        }

        // Punkt ohne Rückkehr: letzter Halbzug, an dem ±150 zuletzt gekreuzt
        // wurde und danach nie mehr zurück.
        let mut crossing: Option<i64> = None;
        let mut previous_side: Option<bool> = None;
        for ply in 1..=plies {
            let Some(cp) = view.cp_mine(ply) else {
                continue;
            };
            if cp.abs() < 150.0 {
                previous_side = None;
                continue;
            }
            let side = cp > 0.0;
            if previous_side != Some(side) {
                crossing = Some(ply);
            }
            previous_side = Some(side);
        }
        if let Some(ply) = crossing {
            decisive_moves.push(((ply + 1) / 2) as f64);
            if let Some(ev) = view.evals.get((ply - 1) as usize) {
                decisive_phase[phase_index(&ev.phase)] += 1;
            }
        }

        for ply in 1..=plies {
            let Some(ev) = view.evals.get((ply - 1) as usize) else {
                continue;
            };
            if view.raw.mine(ply) {
                // Fehler-Anatomie
                let is_error = matches!(ev.judgment.as_str(), "mistake" | "blunder");
                let piece = piece_of_san(&ev.san);
                let entry = piece_errors.entry(piece).or_insert((0, 0));
                entry.1 += 1;
                if is_error {
                    entry.0 += 1;
                    errors += 1;
                }

                // Eigenschaften des übersehenen Bestzuges.
                let traits = if ev.best_uci.is_empty() {
                    None
                } else {
                    walked
                        .get((ply - 1) as usize)
                        .and_then(|w| chess::uci_traits(&w.fen_before, &ev.best_uci))
                };
                if let Some(traits) = traits {
                    let forcing = traits.forcing();
                    forcing_all += 1;
                    if forcing {
                        forcing_total += 1;
                    }
                    if let Some(loss) = view.loss(ply) {
                        if forcing {
                            forcing_losses.push(loss);
                        } else {
                            quiet_losses.push(loss);
                        }
                    }
                    if is_error && forcing {
                        forcing_missed += 1;
                    }
                }
            } else if matches!(ev.judgment.as_str(), "mistake" | "blunder") {
                // Verpasste Bestrafung: mein direkt folgender Zug.
                if view.evals.get(ply as usize).is_some() {
                    chances += 1;
                    if view.loss(ply + 1).unwrap_or(0.0) >= 0.10 {
                        missed += 1;
                    }
                }
            }
        }

        // Endspieltyp beim ersten Halbzug mit Endspielphase.
        if let Some(entry) = view.evals.iter().find(|e| e.phase == "endgame") {
            if let Some(walk) = walked.get((entry.ply - 1) as usize) {
                if let Some(placement) = walk.fen_after.split(' ').next() {
                    let key = endgame_signature(placement);
                    let bucket = endgames.entry(key).or_insert((0, 0.0, Vec::new()));
                    bucket.0 += 1;
                    bucket.1 += view.raw.score();
                    if let Some(accuracy) = view.raw.accuracy {
                        bucket.2.push(accuracy);
                    }
                }
            }
        }
    }

    out.conversion = Conversion {
        games: conv_games,
        won: conv_won,
        drawn: conv_drawn,
        lost: conv_lost,
        score_pct: pct(conv_score, conv_games as f64),
        lost_at_move: r1(mean(&lost_at).unwrap_or(0.0)),
        phase: PHASES[argmax(&conv_phase)].to_string(),
    };
    out.defense = Defense {
        games: def_games,
        saved: def_saved,
        save_pct: pct(def_saved as f64, def_games as f64),
    };
    let decisive_games: i64 = decisive_phase.iter().sum();
    out.decisive = Decisive {
        games: decisive_games,
        avg_move: r1(mean(&decisive_moves).unwrap_or(0.0)),
        by_phase: PHASES
            .iter()
            .enumerate()
            .map(|(i, phase)| PhaseShare {
                phase: (*phase).to_string(),
                games: decisive_phase[i],
                share_pct: pct(decisive_phase[i] as f64, decisive_games as f64),
            })
            .collect(),
    };
    out.punishment = MissedPunishment {
        chances,
        missed,
        missed_pct: pct(missed as f64, chances as f64),
    };

    let mut by_piece: Vec<PieceErrors> = piece_errors
        .into_iter()
        .map(|(piece, (errors, moves))| PieceErrors {
            piece: piece.to_string(),
            errors,
            moves,
            errors_per_100: if moves > 0 {
                r1(errors as f64 / moves as f64 * 100.0)
            } else {
                0.0
            },
        })
        .collect();
    by_piece.sort_by(|a, b| b.errors.cmp(&a.errors).then(a.piece.cmp(&b.piece)));

    out.anatomy = Anatomy {
        errors,
        forcing_missed,
        forcing_pct: pct(forcing_missed as f64, errors as f64),
        forcing_base_pct: pct(forcing_total as f64, forcing_all as f64),
        by_piece,
        forcing_loss: r1(mean(&forcing_losses).unwrap_or(0.0) * 100.0),
        quiet_loss: r1(mean(&quiet_losses).unwrap_or(0.0) * 100.0),
        forcing_moves: forcing_losses.len() as i64,
        quiet_moves: quiet_losses.len() as i64,
    };

    let mut list: Vec<EndgameType> = endgames
        .into_iter()
        .map(|(key, (games, score, accuracies))| EndgameType {
            key: key.to_string(),
            games,
            score_pct: pct(score, games as f64),
            accuracy: mean(&accuracies).map(r1),
        })
        .collect();
    list.sort_by(|a, b| b.games.cmp(&a.games).then(a.key.cmp(&b.key)));
    out.endgames = list;

    out
}

fn argmax(values: &[i64; 3]) -> usize {
    let mut best = 0;
    for (i, value) in values.iter().enumerate() {
        if *value > values[best] {
            best = i;
        }
    }
    best
}

// ── Block D · Feld-Vergleich ─────────────────────────────────────────────────

/// Fenster um das eigene Rating, in dem Gegner als „gleich stark" gelten.
const FIELD_WINDOW: i64 = 150;

fn benchmark_insights(views: &[GameView]) -> BenchmarkInsights {
    let mut out = BenchmarkInsights::default();
    let mut elos: Vec<f64> = Vec::new();

    struct Acc {
        losses: Vec<f64>,
        errors: i64,
        blunders: i64,
        phase_losses: [Vec<f64>; 3],
        phase_blunders: [i64; 3],
        phase_moves: [i64; 3],
        shares: Vec<f64>,
        trouble: i64,
        timed: i64,
    }
    impl Acc {
        fn new() -> Self {
            Acc {
                losses: Vec::new(),
                errors: 0,
                blunders: 0,
                phase_losses: [Vec::new(), Vec::new(), Vec::new()],
                phase_blunders: [0; 3],
                phase_moves: [0; 3],
                shares: Vec::new(),
                trouble: 0,
                timed: 0,
            }
        }
        fn finish(self) -> Option<SideMetrics> {
            let moves = self.losses.len() as i64;
            if moves == 0 {
                return None;
            }
            Some(SideMetrics {
                moves,
                avg_loss: r1(mean(&self.losses).unwrap_or(0.0) * 100.0),
                errors_per_100: r1(self.errors as f64 / moves as f64 * 100.0),
                blunders_per_100: r1(self.blunders as f64 / moves as f64 * 100.0),
                accuracy: accuracy_from_losses(&self.losses),
                by_phase: PHASES
                    .iter()
                    .enumerate()
                    .map(|(i, phase)| PhaseMetric {
                        phase: (*phase).to_string(),
                        moves: self.phase_moves[i],
                        blunders_per_100: if self.phase_moves[i] > 0 {
                            r1(self.phase_blunders[i] as f64 / self.phase_moves[i] as f64 * 100.0)
                        } else {
                            0.0
                        },
                        avg_loss: r1(mean(&self.phase_losses[i]).unwrap_or(0.0) * 100.0),
                    })
                    .collect(),
                avg_share: if self.timed > 0 {
                    mean(&self.shares).map(|v| r1(v * 100.0))
                } else {
                    None
                },
                trouble_pct: if self.timed > 0 {
                    Some(pct(self.trouble as f64, self.timed as f64))
                } else {
                    None
                },
            })
        }
    }

    let mut me = Acc::new();
    let mut field = Acc::new();

    for view in views {
        let raw = view.raw;
        if view.evals.is_empty() || raw.my_elo <= 0 || raw.opp_elo <= 0 {
            continue;
        }
        if (raw.opp_elo - raw.my_elo).abs() > FIELD_WINDOW {
            continue;
        }
        out.games += 1;
        elos.push(raw.opp_elo as f64);

        for ply in 1..=view.evals.len() as i64 {
            let Some(ev) = view.evals.get((ply - 1) as usize) else {
                continue;
            };
            if ev.phase.is_empty() {
                continue;
            }
            let Some(loss) = view.loss(ply) else { continue };
            let acc = if raw.mine(ply) { &mut me } else { &mut field };
            let phase = phase_index(&ev.phase);
            acc.losses.push(loss);
            acc.phase_losses[phase].push(loss);
            acc.phase_moves[phase] += 1;
            match ev.judgment.as_str() {
                "blunder" => {
                    acc.errors += 1;
                    acc.blunders += 1;
                    acc.phase_blunders[phase] += 1;
                }
                "mistake" => acc.errors += 1,
                _ => {}
            }
            if let Some(clocks) = &view.clocks {
                if let Some((_, share)) = clocks.spent(ply) {
                    acc.shares.push(share);
                    acc.timed += 1;
                    if clocks.before(ply) < clocks.initial * 0.10 {
                        acc.trouble += 1;
                    }
                }
            }
        }
    }

    out.avg_opp_elo = mean(&elos).unwrap_or(0.0).round() as i64;
    out.me = me.finish();
    out.field = field.finish();
    out
}
