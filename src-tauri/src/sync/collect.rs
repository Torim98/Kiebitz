// ── Collect: lokale Daten für die Gegenseite einsammeln ─────────────────────

fn collect_games(conn: &Connection, since: i64) -> Result<Vec<SyncGame>, String> {
    let cutoff = since.saturating_sub(SLACK);
    let mut stmt = conn
        .prepare(
            "SELECT id, source, source_id, url, played_at, played_ts, time_class, color,
                    my_name, opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame,
                    opponent_accuracy, opponent_accuracy_opening,
                    opponent_accuracy_middlegame, opponent_accuracy_endgame,
                    moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts,
                    analyzed_ts, clocks, time_control, termination
             FROM games
             WHERE source = 'manual' OR updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, SyncGame)> = stmt
        .query_map(params![cutoff], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                SyncGame {
                    source: r.get(1)?,
                    source_id: r.get(2)?,
                    url: r.get(3)?,
                    played_at: r.get(4)?,
                    played_ts: r.get(5)?,
                    time_class: r.get(6)?,
                    color: r.get(7)?,
                    my_name: r.get(8)?,
                    opponent: r.get(9)?,
                    opp_elo: r.get(10)?,
                    my_elo: r.get(11)?,
                    result: r.get(12)?,
                    opening: r.get(13)?,
                    eco: r.get(14)?,
                    moves_count: r.get(15)?,
                    accuracy: r.get(16)?,
                    accuracy_opening: r.get(17)?,
                    accuracy_middlegame: r.get(18)?,
                    accuracy_endgame: r.get(19)?,
                    opponent_accuracy: r.get(20)?,
                    opponent_accuracy_opening: r.get(21)?,
                    opponent_accuracy_middlegame: r.get(22)?,
                    opponent_accuracy_endgame: r.get(23)?,
                    moves: r.get(24)?,
                    note: r.get(25)?,
                    note_ts: r.get(26)?,
                    tags: serde_json::from_str(&r.get::<_, String>(27)?).unwrap_or_default(),
                    tags_ts: r.get(28)?,
                    analyzed: r.get::<_, i64>(29)? != 0,
                    analysis_excluded: r.get::<_, i64>(30)? != 0,
                    updated_ts: r.get(31)?,
                    analyzed_ts: r.get(32)?,
                    clocks: r.get(33)?,
                    time_control: r.get(34)?,
                    termination: r.get(35)?,
                    evals: Vec::new(),
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut eval_stmt = conn
        .prepare(
            "SELECT e.game_id, e.ply, e.san, e.eval_cp, e.mate_in, e.best_uci,
                    e.judgment, e.phase
             FROM move_evals e
             JOIN games g ON g.id = e.game_id
             WHERE g.analyzed = 1 AND (g.source = 'manual' OR g.updated_ts >= ?1)
             ORDER BY e.game_id, e.ply",
        )
        .map_err(|e| e.to_string())?;
    let mut evals_by_game: HashMap<i64, Vec<SyncEval>> = HashMap::new();
    for row in eval_stmt
        .query_map(params![cutoff], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                SyncEval {
                    ply: r.get(1)?,
                    san: r.get(2)?,
                    eval_cp: r.get(3)?,
                    mate_in: r.get(4)?,
                    best_uci: r.get(5)?,
                    judgment: r.get(6)?,
                    phase: r.get(7)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
    {
        let (game_id, eval) = row.map_err(|e| e.to_string())?;
        evals_by_game.entry(game_id).or_default().push(eval);
    }

    let mut out = Vec::with_capacity(rows.len());
    for (id, mut g) in rows {
        if g.analyzed {
            g.evals = evals_by_game.remove(&id).unwrap_or_default();
        }
        out.push(g);
    }
    Ok(out)
}

fn collect_game_tombstones(conn: &Connection) -> Result<Vec<SyncGameTombstone>, String> {
    let mut stmt = conn
        .prepare("SELECT source, source_id, deleted_ts FROM game_tombstones")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncGameTombstone {
                source: r.get(0)?,
                source_id: r.get(1)?,
                deleted_ts: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Kompletter Repertoire-Baum mit berechneten Pfaden (klein genug für "immer alles").
fn collect_rep(conn: &Connection) -> Result<Vec<SyncRepNode>, String> {
    struct Row {
        id: i64,
        parent_id: i64,
        side: String,
        san: String,
        name: String,
        fen_key: String,
        depth: i64,
        stability: f64,
        difficulty: f64,
        reps: i64,
        lapses: i64,
        due_ts: i64,
        last_ts: i64,
        created_ts: i64,
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, side, san, name, fen_key, depth, stability, difficulty,
                    reps, lapses, due_ts, last_ts, created_ts
             FROM rep_nodes ORDER BY depth, id",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                side: r.get(2)?,
                san: r.get(3)?,
                name: r.get(4)?,
                fen_key: r.get(5)?,
                depth: r.get(6)?,
                stability: r.get(7)?,
                difficulty: r.get(8)?,
                reps: r.get(9)?,
                lapses: r.get(10)?,
                due_ts: r.get(11)?,
                last_ts: r.get(12)?,
                created_ts: r.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    // Pfade aufbauen: dank ORDER BY depth sind Eltern immer vor Kindern dran.
    let mut paths: HashMap<i64, String> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let path = if r.parent_id == 0 {
            r.san.clone()
        } else {
            match paths.get(&r.parent_id) {
                Some(p) => format!("{p} {}", r.san),
                None => continue, // verwaister Knoten · überspringen
            }
        };
        paths.insert(r.id, path.clone());
        out.push(SyncRepNode {
            side: r.side.clone(),
            path,
            name: r.name.clone(),
            fen_key: r.fen_key.clone(),
            depth: r.depth,
            stability: r.stability,
            difficulty: r.difficulty,
            reps: r.reps,
            lapses: r.lapses,
            due_ts: r.due_ts,
            last_ts: r.last_ts,
            created_ts: r.created_ts,
        });
    }
    Ok(out)
}

fn collect_tombstones(conn: &Connection) -> Result<Vec<SyncTombstone>, String> {
    let mut stmt = conn
        .prepare("SELECT side, path, deleted_ts FROM rep_tombstones")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncTombstone {
                side: r.get(0)?,
                path: r.get(1)?,
                deleted_ts: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Tombstones der Gegenseite übernehmen (Union, neuester Zeitstempel gewinnt)
/// und danach lokal alle abgedeckten Knoten löschen, die älter sind als die
/// Löschung · jüngere (wieder angelegte oder frisch trainierte) überleben.
fn apply_tombstones(conn: &mut Connection, tombstones: &[SyncTombstone]) -> Result<usize, String> {
    for t in tombstones {
        conn.execute(
            "INSERT INTO rep_tombstones (side, path, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(side, path) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![t.side, t.path, t.deleted_ts],
        )
        .map_err(|e| e.to_string())?;
    }
    // Sweep über den lokalen Baum mit allen (auch schon vorhandenen) Tombstones.
    let all = collect_tombstones(conn)?;
    if all.is_empty() {
        return Ok(0);
    }
    let local = collect_rep(conn)?;
    let mut delete_keys: Vec<(String, String)> = Vec::new();
    for n in &local {
        let alive = n.last_ts.max(n.created_ts);
        let covered = all.iter().any(|t| {
            t.side == n.side
                && (n.path == t.path || n.path.starts_with(&format!("{} ", t.path)))
                && t.deleted_ts > alive
        });
        if covered {
            delete_keys.push((n.side.clone(), n.path.clone()));
        }
    }
    // Über (side, parent, san) je Ebene löschen · wir haben nur Pfade, keine IDs.
    let mut deleted = 0usize;
    if !delete_keys.is_empty() {
        // IDs nachschlagen wie in apply_rep.
        let mut stmt = conn
            .prepare("SELECT id, parent_id, side, san FROM rep_nodes ORDER BY depth, id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        let mut paths: HashMap<i64, String> = HashMap::new();
        let mut ids: Vec<i64> = Vec::new();
        for (id, parent_id, side, san) in rows {
            let path = if parent_id == 0 {
                san
            } else {
                match paths.get(&parent_id) {
                    Some(p) => format!("{p} {san}"),
                    None => continue,
                }
            };
            paths.insert(id, path.clone());
            if delete_keys.iter().any(|(s, p)| *s == side && *p == path) {
                ids.push(id);
            }
        }
        for id in ids {
            deleted += conn
                .execute("DELETE FROM rep_nodes WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(deleted)
}

fn collect_puzzle_attempts(
    conn: &Connection,
    _since: i64,
) -> Result<Vec<SyncPuzzleAttempt>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating
             FROM puzzle_attempts ORDER BY ts, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncPuzzleAttempt {
                puzzle_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                rating_before: r.get(3)?,
                rating_after: r.get(4)?,
                themes: r.get(5)?,
                puzzle_rating: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Eigene Puzzles sind im Vergleich zum Lichess-Dump klein und abgeleitete
/// Desktop-Daten. Ein vollständiger Snapshot macht auch Entfernungen nach einer
/// Re-Analyse ohne Puzzle-Tombstones eindeutig.
fn collect_own_puzzles(conn: &Connection) -> Result<Vec<SyncOwnPuzzle>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.fen, p.moves, p.rating, p.rd, p.popularity, p.nb_plays,
                    p.themes, p.opening_tags, g.source, g.source_id,
                    p.source_ply, p.setup_plies
             FROM puzzles p
             JOIN games g ON g.id = p.source_game_id
             WHERE p.source = 'own'
             ORDER BY p.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncOwnPuzzle {
                id: r.get(0)?,
                fen: r.get(1)?,
                moves: r.get(2)?,
                rating: r.get(3)?,
                rd: r.get(4)?,
                popularity: r.get(5)?,
                nb_plays: r.get(6)?,
                themes: r.get(7)?,
                opening_tags: r.get(8)?,
                game_source: r.get(9)?,
                game_source_id: r.get(10)?,
                source_ply: r.get(11)?,
                setup_plies: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_endgame_attempts(
    conn: &Connection,
    since: i64,
) -> Result<Vec<SyncEndgameAttempt>, String> {
    let mut stmt = conn
        .prepare("SELECT drill_id, ts, solved, moves FROM endgame_attempts WHERE ts >= ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncEndgameAttempt {
                drill_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                moves: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_templates(
    conn: &Connection,
    since: i64,
) -> Result<Vec<SyncStudyTemplate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sync_key, title, duration_min, tool, description,
                    created_ts, updated_ts, deleted
             FROM study_templates WHERE updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyTemplate {
                sync_key: r.get(0)?,
                title: r.get(1)?,
                duration_min: r.get(2)?,
                tool: r.get(3)?,
                description: r.get(4)?,
                created_ts: r.get(5)?,
                updated_ts: r.get(6)?,
                deleted: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_events(conn: &Connection, since: i64) -> Result<Vec<SyncStudyEvent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.sync_key, t.sync_key, e.day, e.position, e.completed,
                    e.completed_ts, e.created_ts, e.updated_ts, e.deleted,
                    e.repeat_rule, e.series_key
             FROM study_events e
             JOIN study_templates t ON t.id = e.template_id
             WHERE e.updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyEvent {
                sync_key: r.get(0)?,
                template_sync_key: r.get(1)?,
                day: r.get(2)?,
                position: r.get(3)?,
                completed: r.get::<_, i64>(4)? != 0,
                completed_ts: r.get(5)?,
                created_ts: r.get(6)?,
                updated_ts: r.get(7)?,
                deleted: r.get::<_, i64>(8)? != 0,
                repeat_rule: r.get(9)?,
                series_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_rep_reviews(conn: &Connection, since: i64) -> Result<Vec<SyncRepReview>, String> {
    let mut stmt = conn
        .prepare("SELECT side, path, ts, grade FROM rep_review_log WHERE ts >= ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncRepReview {
                side: r.get(0)?,
                path: r.get(1)?,
                ts: r.get(2)?,
                grade: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_sessions(
    conn: &Connection,
    since: i64,
) -> Result<Vec<SyncStudySession>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sync_key, area, start_ts, end_ts, seconds, updated_ts
             FROM study_sessions WHERE updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudySession {
                sync_key: r.get(0)?,
                area: r.get(1)?,
                start_ts: r.get(2)?,
                end_ts: r.get(3)?,
                seconds: r.get(4)?,
                updated_ts: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_focus(conn: &Connection, since: i64) -> Result<Vec<SyncStudyFocus>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sync_key, area, metric_key, label_params, target, cycle_days,
                    start_ts, end_ts, status, created_ts, updated_ts, deleted
             FROM study_focus WHERE updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyFocus {
                sync_key: r.get(0)?,
                area: r.get(1)?,
                metric_key: r.get(2)?,
                label_params: r.get(3)?,
                target: r.get(4)?,
                cycle_days: r.get(5)?,
                start_ts: r.get(6)?,
                end_ts: r.get(7)?,
                status: r.get(8)?,
                created_ts: r.get(9)?,
                updated_ts: r.get(10)?,
                deleted: r.get::<_, i64>(11)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}
