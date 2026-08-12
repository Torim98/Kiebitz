// ── Block A · Zeitmanagement ─────────────────────────────────────────────────

fn time_insights(views: &[GameView], sessions: &[(usize, i64)]) -> TimeInsights {
    let mut out = TimeInsights::default();

    // Vier Tempostufen, gemessen am Anteil der Restzeit · absolute Sekunden
    // wären zwischen Bullet und Rapid nicht vergleichbar.
    let limits = [0.02f64, 0.08, 0.20];
    let keys = ["instant", "quick", "normal", "long"];
    let mut buckets = [(0i64, 0i64, 0i64, 0.0f64); 4];

    let mut balanced: Vec<f64> = Vec::new();
    let mut decided: Vec<f64> = Vec::new();
    let mut error_share: Vec<f64> = Vec::new();
    let mut ok_share: Vec<f64> = Vec::new();

    let (mut trouble_moves, mut trouble_errors) = (0i64, 0i64);
    let (mut safe_moves, mut safe_errors) = (0i64, 0i64);
    let mut trouble_games = 0i64;
    let mut first_trouble: Vec<f64> = Vec::new();
    let mut flag_losses = 0i64;
    let mut trouble_scores: Vec<f64> = Vec::new();
    let mut safe_scores: Vec<f64> = Vec::new();

    let (mut ahead, mut ahead_score, mut behind, mut behind_score) = (0i64, 0.0f64, 0i64, 0.0f64);
    let mut diffs: Vec<f64> = Vec::new();

    let mut book_time = 0.0f64;
    let mut total_time = 0.0f64;
    let mut book_moves = 0i64;
    let mut book_shares: Vec<f64> = Vec::new();
    let mut own_shares: Vec<f64> = Vec::new();
    let mut theory_games = 0i64;

    let (mut inc_games, mut inc_moves, mut inc_over) = (0i64, 0i64, 0i64);
    let mut inc_spent: Vec<f64> = Vec::new();
    let mut inc_value: Vec<f64> = Vec::new();

    let mut phase_moves = [0i64; 3];
    let mut phase_time = [0.0f64; 3];
    let mut phase_shares: [Vec<f64>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut phase_initial = 0.0f64;
    let mut phase_games = 0i64;

    let mut drift: BTreeMap<i64, (i64, Vec<f64>, f64)> = BTreeMap::new();

    for (position, view) in views.iter().enumerate() {
        let Some(clocks) = &view.clocks else { continue };
        out.games += 1;
        let plies = clocks.remaining.len() as i64;
        let trouble_limit = clocks.initial * 0.10;
        let mut game_trouble = false;
        let mut game_shares: Vec<f64> = Vec::new();
        let mut game_book_moves = 0i64;

        if clocks.increment > 0.0 {
            inc_games += 1;
        }
        phase_games += 1;
        phase_initial += clocks.initial;

        for ply in 1..=plies {
            if !view.raw.mine(ply) {
                continue;
            }
            let Some((spent, share)) = clocks.spent(ply) else {
                continue;
            };
            out.moves += 1;
            total_time += spent;
            game_shares.push(share);

            let bucket = limits.iter().position(|limit| share < *limit).unwrap_or(3);
            buckets[bucket].0 += 1;
            buckets[bucket].3 += share;

            let judgment = view
                .evals
                .get((ply - 1) as usize)
                .map(|e| e.judgment.as_str());
            let is_error = matches!(judgment, Some("mistake") | Some("blunder"));
            if is_error {
                buckets[bucket].1 += 1;
                if judgment == Some("blunder") {
                    buckets[bucket].2 += 1;
                }
                error_share.push(share);
            } else if judgment.is_some() {
                ok_share.push(share);
            }

            // Zeit gegen Stellungswert: Wo wird nachgedacht, wo nicht?
            // Vor dem ersten Halbzug gibt es keine gespeicherte Bewertung ·
            // die Grundstellung gilt als ausgeglichen.
            let before = if ply == 1 {
                Some(0.0)
            } else {
                view.cp_mine(ply - 1)
            };
            if let Some(cp) = before {
                if cp.abs() <= 100.0 {
                    balanced.push(share);
                } else if cp.abs() >= 300.0 {
                    decided.push(share);
                }
            }

            // Zeitnot
            if clocks.before(ply) < trouble_limit {
                trouble_moves += 1;
                if is_error {
                    trouble_errors += 1;
                }
                if !game_trouble {
                    game_trouble = true;
                    first_trouble.push(((ply + 1) / 2) as f64);
                }
            } else {
                safe_moves += 1;
                if is_error {
                    safe_errors += 1;
                }
            }

            // Buchzeit: nur ein vom Start bis zu diesem Halbzug lückenlos
            // passender Pfad im eigenen Weiß-/Schwarz-Repertoire zählt.
            if ply <= view.book_plies {
                book_time += spent;
                book_moves += 1;
                game_book_moves += 1;
                book_shares.push(share);
            } else {
                own_shares.push(share);
            }

            if clocks.increment > 0.0 {
                inc_moves += 1;
                inc_spent.push(spent);
                if spent > clocks.increment {
                    inc_over += 1;
                }
            }

            let phase = view
                .evals
                .get((ply - 1) as usize)
                .map(|e| phase_index(&e.phase))
                .unwrap_or(if ply <= 20 { 0 } else { 1 });
            phase_moves[phase] += 1;
            phase_time[phase] += spent;
            phase_shares[phase].push(share);
        }

        if clocks.increment > 0.0 {
            inc_value.push(clocks.increment);
        }
        if game_book_moves > 0 {
            theory_games += 1;
        }
        if game_trouble {
            trouble_games += 1;
            trouble_scores.push(view.raw.score());
        } else {
            safe_scores.push(view.raw.score());
        }
        if view.raw.result == "loss" {
            if let Some(last) = clocks.last_of(view.raw.my_white()) {
                if last < 2.0 {
                    flag_losses += 1;
                }
            }
        }

        // Uhrvorsprung am 60-%-Punkt: früh genug, um noch etwas zu bedeuten,
        // spät genug, dass sich ein Unterschied aufgebaut hat.
        let mark = ((plies as f64) * 0.6).round() as i64;
        if mark >= 4 {
            let mine = last_before(clocks, mark, view.raw.my_white());
            let theirs = last_before(clocks, mark, !view.raw.my_white());
            if let (Some(mine), Some(theirs)) = (mine, theirs) {
                let diff = mine - theirs;
                diffs.push(diff);
                if diff > 0.0 {
                    ahead += 1;
                    ahead_score += view.raw.score();
                } else {
                    behind += 1;
                    behind_score += view.raw.score();
                }
            }
        }

        // Tempo-Drift über die Sitzung
        if let (Some(avg), Some((_, index))) = (mean(&game_shares), sessions.get(position)) {
            let key = (*index).min(5);
            let entry = drift.entry(key).or_insert((0, Vec::new(), 0.0));
            entry.0 += 1;
            entry.1.push(avg);
            entry.2 += view.raw.score();
        }
    }

    out.by_speed = keys
        .iter()
        .enumerate()
        .map(|(i, key)| {
            let (moves, errors, blunders, share_sum) = buckets[i];
            SpeedBucket {
                key: (*key).to_string(),
                moves,
                errors,
                blunders,
                errors_per_100: if moves > 0 {
                    r1(errors as f64 / moves as f64 * 100.0)
                } else {
                    0.0
                },
                avg_loss: 0.0,
                share_pct: if moves > 0 {
                    r1(share_sum / moves as f64 * 100.0)
                } else {
                    0.0
                },
            }
        })
        .collect();
    // Verluste pro Tempostufe brauchen die Bewertungen · zweiter, billiger Lauf.
    fill_speed_losses(views, &limits, &mut out.by_speed);

    out.focus = TimeFocus {
        balanced_share: r1(mean(&balanced).unwrap_or(0.0) * 100.0),
        decided_share: r1(mean(&decided).unwrap_or(0.0) * 100.0),
        balanced_moves: balanced.len() as i64,
        decided_moves: decided.len() as i64,
        error_share: r1(mean(&error_share).unwrap_or(0.0) * 100.0),
        ok_share: r1(mean(&ok_share).unwrap_or(0.0) * 100.0),
    };

    out.trouble = TimeTrouble {
        moves: trouble_moves,
        share_pct: pct(trouble_moves as f64, (trouble_moves + safe_moves) as f64),
        errors_per_100: if trouble_moves > 0 {
            r1(trouble_errors as f64 / trouble_moves as f64 * 100.0)
        } else {
            0.0
        },
        baseline_per_100: if safe_moves > 0 {
            r1(safe_errors as f64 / safe_moves as f64 * 100.0)
        } else {
            0.0
        },
        games: trouble_games,
        games_pct: pct(trouble_games as f64, out.games as f64),
        first_move: r1(mean(&first_trouble).unwrap_or(0.0)),
        flag_losses,
        score_in_trouble: r1(mean(&trouble_scores).unwrap_or(0.0) * 100.0),
        score_without: r1(mean(&safe_scores).unwrap_or(0.0) * 100.0),
    };

    out.edge = ClockEdge {
        games: ahead + behind,
        ahead_games: ahead,
        ahead_score: pct(ahead_score, ahead as f64),
        behind_games: behind,
        behind_score: pct(behind_score, behind as f64),
        avg_diff: r1(mean(&diffs).unwrap_or(0.0)),
    };

    out.theory = TheoryTime {
        games: theory_games,
        book_share_pct: pct(book_time, total_time),
        book_moves,
        book_avg_share: r1(mean(&book_shares).unwrap_or(0.0) * 100.0),
        own_avg_share: r1(mean(&own_shares).unwrap_or(0.0) * 100.0),
    };

    out.increment = IncrementBalance {
        games: inc_games,
        moves: inc_moves,
        over_increment_pct: pct(inc_over as f64, inc_moves as f64),
        avg_spent: r1(mean(&inc_spent).unwrap_or(0.0)),
        increment: r1(mean(&inc_value).unwrap_or(0.0)),
    };

    out.drift = drift
        .into_iter()
        .map(|(index, (games, shares, score))| DriftPoint {
            index,
            games,
            avg_share: r1(mean(&shares).unwrap_or(0.0) * 100.0),
            score_pct: pct(score, games as f64),
        })
        .collect();

    let avg_initial = if phase_games > 0 {
        phase_initial / phase_games as f64
    } else {
        0.0
    };
    out.by_phase = PHASES
        .iter()
        .enumerate()
        .map(|(i, phase)| PhaseTime {
            phase: (*phase).to_string(),
            moves: phase_moves[i],
            clock_pct: if avg_initial > 0.0 && phase_games > 0 {
                pct(phase_time[i] / phase_games as f64, avg_initial)
            } else {
                0.0
            },
            avg_share: r1(mean(&phase_shares[i]).unwrap_or(0.0) * 100.0),
        })
        .collect();

    out
}

/// Restzeit der gesuchten Seite bei oder vor Halbzug `mark`.
fn last_before(clocks: &Clocks, mark: i64, white: bool) -> Option<f64> {
    (1..=mark.min(clocks.remaining.len() as i64))
        .rev()
        .find(|ply| white_plays(*ply) == white)
        .and_then(|ply| clocks.remaining.get((ply - 1) as usize).copied())
}

fn fill_speed_losses(views: &[GameView], limits: &[f64; 3], buckets: &mut [SpeedBucket]) {
    let mut sums = [(0.0f64, 0i64); 4];
    for view in views {
        let Some(clocks) = &view.clocks else { continue };
        for ply in 1..=clocks.remaining.len() as i64 {
            if !view.raw.mine(ply) {
                continue;
            }
            let (Some((_, share)), Some(loss)) = (clocks.spent(ply), view.loss(ply)) else {
                continue;
            };
            if view.evals.get((ply - 1) as usize).is_none() {
                continue;
            }
            let bucket = limits.iter().position(|limit| share < *limit).unwrap_or(3);
            sums[bucket].0 += loss;
            sums[bucket].1 += 1;
        }
    }
    for (i, bucket) in buckets.iter_mut().enumerate() {
        if sums[i].1 > 0 {
            bucket.avg_loss = r1(sums[i].0 / sums[i].1 as f64 * 100.0);
        }
    }
}
