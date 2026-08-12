// ── Block E · Sessions ───────────────────────────────────────────────────────

fn session_insights(
    views: &[GameView],
    sessions: &[(usize, i64)],
    puzzle_days: &HashMap<i64, i64>,
) -> SessionInsights {
    let mut out = SessionInsights::default();
    if views.is_empty() {
        return out;
    }

    let mut by_index: BTreeMap<i64, (i64, f64, Vec<f64>)> = BTreeMap::new();
    let mut per_session: BTreeMap<usize, (i64, i64, i64)> = BTreeMap::new(); // (Partien, erstes Elo, letztes Elo)

    let (mut fast_games, mut fast_score, mut slow_games, mut slow_score) = (0i64, 0.0, 0i64, 0.0);
    let (mut first_games, mut first_score, mut rest_games, mut rest_score) = (0i64, 0.0, 0i64, 0.0);
    let (mut primed_games, mut primed_score, mut cold_games, mut cold_score) =
        (0i64, 0.0, 0i64, 0.0);
    let mut seen_days: HashMap<i64, bool> = HashMap::new();

    for (position, view) in views.iter().enumerate() {
        let raw = view.raw;
        let Some((session, index)) = sessions.get(position).copied() else {
            continue;
        };

        let key = index.min(5);
        let entry = by_index.entry(key).or_insert((0, 0.0, Vec::new()));
        entry.0 += 1;
        entry.1 += raw.score();
        if let Some(accuracy) = raw.accuracy {
            entry.2.push(accuracy);
        }

        if raw.my_elo > 0 {
            let session_entry = per_session
                .entry(session)
                .or_insert((0, raw.my_elo, raw.my_elo));
            session_entry.0 += 1;
            session_entry.2 = raw.my_elo;
        }

        // Wie schnell ging es nach einer Niederlage weiter?
        if position > 0 {
            let previous = &views[position - 1];
            if previous.raw.result == "loss" && sessions[position - 1].0 == session {
                let gap = raw.played_ts - previous.raw.played_ts;
                if gap > 0 && gap <= REQUEUE_LIMIT {
                    fast_games += 1;
                    fast_score += raw.score();
                } else {
                    slow_games += 1;
                    slow_score += raw.score();
                }
            }
        }

        // Aufwärmeffekt: erste Partie eines Kalendertages.
        if raw.played_ts > 0 {
            let day = raw.played_ts.div_euclid(86_400);
            let is_first = !seen_days.contains_key(&day);
            seen_days.insert(day, true);
            if is_first {
                first_games += 1;
                first_score += raw.score();
                // Wurde an diesem Tag vorher trainiert? Puzzleversuche zählen
                // tagesweise, deshalb genügt „mindestens fünf am selben Tag".
                if puzzle_days.get(&day).copied().unwrap_or(0) >= 5 {
                    primed_games += 1;
                    primed_score += raw.score();
                } else {
                    cold_games += 1;
                    cold_score += raw.score();
                }
            } else {
                rest_games += 1;
                rest_score += raw.score();
            }
        }
    }

    out.sessions = sessions.iter().map(|(s, _)| *s).max().unwrap_or(0) as i64;
    out.avg_games = if out.sessions > 0 {
        r1(views.len() as f64 / out.sessions as f64)
    } else {
        0.0
    };
    out.by_index = by_index
        .into_iter()
        .map(|(index, (games, score, accuracies))| SessionIndex {
            index,
            games,
            score_pct: pct(score, games as f64),
            accuracy: mean(&accuracies).map(r1),
        })
        .collect();

    // Empfehlung: erster Index mit belastbarem Abfall gegenüber Partie 1.
    if let Some(first) = out.by_index.first().map(|b| b.score_pct) {
        for bucket in out.by_index.iter().skip(1) {
            if bucket.games >= 10 && bucket.score_pct <= first - 5.0 {
                out.recommended_length = bucket.index - 1;
                break;
            }
        }
    }

    out.requeue = Requeue {
        fast_games,
        fast_score: pct(fast_score, fast_games as f64),
        slow_games,
        slow_score: pct(slow_score, slow_games as f64),
        threshold: REQUEUE_LIMIT,
    };
    out.warmup = Warmup {
        first_games,
        first_score: pct(first_score, first_games as f64),
        rest_games,
        rest_score: pct(rest_score, rest_games as f64),
        primed_games,
        primed_score: pct(primed_score, primed_games as f64),
        cold_games,
        cold_score: pct(cold_score, cold_games as f64),
    };

    let mut deltas: Vec<i64> = per_session
        .values()
        .filter(|(games, first, last)| *games >= 2 && *first > 0 && *last > 0)
        .map(|(_, first, last)| last - first)
        .collect();
    deltas.sort();
    let total_loss: i64 = deltas.iter().filter(|d| **d < 0).sum();
    let worst3: i64 = deltas.iter().take(3).filter(|d| **d < 0).sum();
    out.damage = SessionDamage {
        sessions: deltas.len() as i64,
        total_loss,
        worst3_pct: if total_loss < 0 {
            pct(worst3 as f64, total_loss as f64)
        } else {
            0.0
        },
        worst_delta: deltas.first().copied().unwrap_or(0),
    };

    out
}

/// „Sofort weiter" nach einer Niederlage · zwei Minuten.
const REQUEUE_LIMIT: i64 = 120;

// ── Block F · Fortschritt ────────────────────────────────────────────────────

fn progress_insights(
    conn: &Connection,
    views: &[GameView],
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
) -> Result<ProgressInsights, String> {
    let mut out = ProgressInsights::default();

    struct Month {
        games: i64,
        score: f64,
        accuracies: Vec<f64>,
        rating: Option<i64>,
        my_moves: i64,
        blunders: i64,
    }
    let mut months: BTreeMap<String, Month> = BTreeMap::new();

    for view in views {
        let raw = view.raw;
        if raw.played_ts <= 0 {
            continue;
        }
        let key = month_key(raw.played_ts);
        let entry = months.entry(key).or_insert(Month {
            games: 0,
            score: 0.0,
            accuracies: Vec::new(),
            rating: None,
            my_moves: 0,
            blunders: 0,
        });
        entry.games += 1;
        entry.score += raw.score();
        if let Some(accuracy) = raw.accuracy {
            entry.accuracies.push(accuracy);
        }
        if raw.my_elo > 0 {
            entry.rating = Some(raw.my_elo);
        }
        for ply in 1..=view.evals.len() as i64 {
            if !raw.mine(ply) {
                continue;
            }
            if let Some(ev) = view.evals.get((ply - 1) as usize) {
                if ev.phase.is_empty() {
                    continue;
                }
                entry.my_moves += 1;
                if ev.judgment == "blunder" {
                    entry.blunders += 1;
                }
            }
        }
    }

    // Puzzleaufkommen je Monat aus derselben Quelle wie der Puzzle-Reiter.
    let mut puzzles: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT ts, solved FROM puzzle_attempts")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, solved) = row.map_err(|e| e.to_string())?;
            let entry = puzzles.entry(month_key(ts)).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += solved;
        }
    }

    out.months = months
        .into_iter()
        .map(|(month, data)| {
            let (attempts, solved) = puzzles.get(&month).copied().unwrap_or((0, 0));
            MonthPoint {
                score_pct: pct(data.score, data.games as f64),
                accuracy: mean(&data.accuracies).map(r1),
                rating: data.rating,
                blunders_per_100: if data.my_moves > 0 {
                    Some(r1(data.blunders as f64 / data.my_moves as f64 * 100.0))
                } else {
                    None
                },
                games: data.games,
                month,
                puzzle_attempts: attempts,
                puzzle_solved: solved,
            }
        })
        .collect();
    // Der Verlauf soll die jüngere Entwicklung zeigen, nicht die Frühgeschichte.
    if out.months.len() > 18 {
        out.months = out.months.split_off(out.months.len() - 18);
    }

    let with_accuracy: Vec<f64> = out.months.iter().filter_map(|m| m.accuracy).collect();
    if with_accuracy.len() >= 4 {
        let half = with_accuracy.len() / 2;
        let early = mean(&with_accuracy[..half]);
        let late = mean(&with_accuracy[half..]);
        if let (Some(early), Some(late)) = (early, late) {
            out.accuracy_delta = Some(r1(late - early));
        }
    }
    let ratings: Vec<i64> = out.months.iter().filter_map(|m| m.rating).collect();
    if ratings.len() >= 2 {
        out.rating_delta = Some(ratings[ratings.len() - 1] - ratings[0]);
    }

    out.themes = theme_progress(conn)?;
    out.rep_effect = rep_effect(views, nodes, children);
    Ok(out)
}

fn month_key(ts: i64) -> String {
    // Ohne Kalenderbibliothek: aus dem Tagesindex Jahr und Monat rechnen.
    let days = ts.div_euclid(86_400);
    let (year, month, _) = civil_from_days(days);
    format!("{year:04}-{month:02}")
}

/// Tagesindex → (Jahr, Monat, Tag) nach Howard Hinnants `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn theme_progress(conn: &Connection) -> Result<Vec<ThemeProgress>, String> {
    let mut stmt = conn
        .prepare("SELECT solved, themes FROM puzzle_attempts ORDER BY ts, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut per_theme: HashMap<String, Vec<bool>> = HashMap::new();
    for row in rows {
        let (solved, themes) = row.map_err(|e| e.to_string())?;
        for theme in themes.split_whitespace() {
            per_theme
                .entry(theme.to_string())
                .or_default()
                .push(solved != 0);
        }
    }

    // Lernkurve: erste gegen zweite Hälfte der Versuche eines Motivs. Unter 20
    // Versuchen ist die Differenz reines Rauschen.
    let mut out: Vec<ThemeProgress> = per_theme
        .into_iter()
        .filter(|(_, attempts)| attempts.len() >= 20)
        .map(|(theme, attempts)| {
            let half = attempts.len() / 2;
            let rate = |slice: &[bool]| -> f64 {
                pct(
                    slice.iter().filter(|s| **s).count() as f64,
                    slice.len() as f64,
                )
            };
            let early = rate(&attempts[..half]);
            let late = rate(&attempts[half..]);
            ThemeProgress {
                theme,
                attempts: attempts.len() as i64,
                early_pct: early,
                late_pct: late,
                delta: r1(late - early),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.delta
            .partial_cmp(&a.delta)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.theme.cmp(&b.theme))
    });
    out.truncate(12);
    Ok(out)
}

/// Wirkt das Repertoiretraining? Partien, die eine trainierte Linie erreichten,
/// vor dem ersten Review gegen die danach.
fn rep_effect(
    views: &[GameView],
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
) -> RepEffect {
    let mut out = RepEffect::default();
    if nodes.is_empty() {
        return out;
    }
    // Frühester Review je Knoten · `last_ts` ist der letzte, das genügt als
    // Trennlinie: davor war die Linie sicher untrainiert.
    let trained: HashMap<i64, i64> = nodes
        .iter()
        .filter(|n| n.reps > 0 && n.due_ts > 0)
        .map(|n| (n.id, n.due_ts))
        .collect();
    if trained.is_empty() {
        return out;
    }

    for view in views {
        let raw = view.raw;
        if raw.played_ts <= 0 {
            continue;
        }
        // Tiefster erreichter Buchknoten dieser Partie.
        let mut node_id = 0i64;
        let mut trained_ts: Option<i64> = None;
        for san in raw.moves.split_whitespace().take(BOOK_PLIES) {
            let kids = children.get(&(raw.color.clone(), node_id));
            match kids.and_then(|k| k.iter().find(|(s, _)| s == san)) {
                Some((_, id)) => {
                    node_id = *id;
                    if let Some(ts) = trained.get(id) {
                        trained_ts = Some(*ts);
                    }
                }
                None => break,
            }
        }
        let Some(ts) = trained_ts else { continue };
        if raw.played_ts < ts {
            out.before_games += 1;
            out.before_score += raw.score();
        } else {
            out.after_games += 1;
            out.after_score += raw.score();
        }
    }
    out.before_score = pct(out.before_score, out.before_games as f64);
    out.after_score = pct(out.after_score, out.after_games as f64);
    out
}
