// ── Apply: Daten der Gegenseite einmergen ───────────────────────────────────

fn apply_game_tombstones(
    conn: &mut Connection,
    tombstones: &[SyncGameTombstone],
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut deleted = 0usize;
    for tombstone in tombstones {
        tx.execute(
            "INSERT INTO game_tombstones (source, source_id, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(source, source_id) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![tombstone.source, tombstone.source_id, tombstone.deleted_ts],
        )
        .map_err(|e| e.to_string())?;
        let local: Option<(i64, i64)> = tx
            .query_row(
                "SELECT id, updated_ts FROM games WHERE source = ?1 AND source_id = ?2",
                params![tombstone.source, tombstone.source_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        if let Some((id, updated_ts)) = local {
            if tombstone.deleted_ts >= updated_ts {
                db::delete_game_rows(&tx, id)?;
                deleted += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

fn apply_games(conn: &mut Connection, games: &[SyncGame]) -> Result<usize, String> {
    let now = db::now_ts();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut applied = 0usize;
    for g in games {
        let tombstone_ts: Option<i64> = tx
            .query_row(
                "SELECT deleted_ts FROM game_tombstones WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
                |row| row.get(0),
            )
            .ok();
        if tombstone_ts.is_some_and(|deleted_ts| deleted_ts >= g.updated_ts) {
            continue;
        }
        if tombstone_ts.is_some() {
            tx.execute(
                "DELETE FROM game_tombstones WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
            )
            .map_err(|e| e.to_string())?;
        }
        let incoming_updated = if g.updated_ts > 0 { g.updated_ts } else { now };
        let existing: Option<(i64, i64, i64, bool, i64)> = tx
            .query_row(
                "SELECT id, note_ts, tags_ts, analyzed, updated_ts FROM games WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? != 0, r.get(4)?)),
            )
            .ok();
        let game_id = match existing {
            None => {
                tx.execute(
                    "INSERT INTO games (source, source_id, url, played_at, played_ts, time_class,
                        color, my_name, opponent, opp_elo, my_elo, result, opening, eco, moves_count,
                        accuracy, accuracy_opening, accuracy_middlegame, accuracy_endgame,
                        opponent_accuracy, opponent_accuracy_opening,
                        opponent_accuracy_middlegame, opponent_accuracy_endgame,
                        moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts,
                        analyzed_ts, clocks, time_control)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34)",
                    params![
                        g.source, g.source_id, g.url, g.played_at, g.played_ts, g.time_class,
                        g.color, g.my_name, g.opponent, g.opp_elo, g.my_elo, g.result, g.opening, g.eco,
                        g.moves_count, g.accuracy, g.accuracy_opening, g.accuracy_middlegame,
                        g.accuracy_endgame, g.opponent_accuracy, g.opponent_accuracy_opening,
                        g.opponent_accuracy_middlegame, g.opponent_accuracy_endgame,
                        g.moves, g.note, g.note_ts,
                        serde_json::to_string(&g.tags).map_err(|e| e.to_string())?, g.tags_ts,
                        g.analyzed as i64, g.analysis_excluded as i64, incoming_updated,
                        g.analyzed_ts, g.clocks, g.time_control
                    ],
                )
                .map_err(|e| e.to_string())?;
                applied += 1;
                tx.last_insert_rowid()
            }
            Some((id, local_note_ts, local_tags_ts, _, _local_updated_ts)) => {
                tx.execute(
                    "UPDATE games SET
                        accuracy = COALESCE(accuracy, ?2),
                        accuracy_opening = COALESCE(accuracy_opening, ?3),
                        accuracy_middlegame = COALESCE(accuracy_middlegame, ?4),
                        accuracy_endgame = COALESCE(accuracy_endgame, ?5),
                        opponent_accuracy = COALESCE(opponent_accuracy, ?6),
                        opponent_accuracy_opening = COALESCE(opponent_accuracy_opening, ?7),
                        opponent_accuracy_middlegame = COALESCE(opponent_accuracy_middlegame, ?8),
                        opponent_accuracy_endgame = COALESCE(opponent_accuracy_endgame, ?9),
                        analyzed = MAX(analyzed, ?10),
                        -- Erste bekannte Analysezeit gewinnt (0 = noch keine).
                        analyzed_ts = CASE WHEN analyzed_ts = 0 THEN ?15 ELSE analyzed_ts END,
                        analysis_excluded = CASE WHEN ?11 >= updated_ts THEN ?12 ELSE analysis_excluded END,
                        time_class = CASE WHEN ?11 >= updated_ts THEN ?13 ELSE time_class END,
                        my_name = CASE WHEN ?11 >= updated_ts AND ?14 != '' THEN ?14 ELSE my_name END,
                        -- Uhrendaten sind unveränderliche Partiedaten: wer sie
                        -- hat, behält sie; wer keine hat, übernimmt sie.
                        clocks = CASE WHEN clocks = '' THEN ?16 ELSE clocks END,
                        time_control = CASE WHEN time_control = '' THEN ?17 ELSE time_control END,
                        updated_ts = MAX(updated_ts, ?11)
                     WHERE id = ?1",
                    params![
                        id,
                        g.accuracy,
                        g.accuracy_opening,
                        g.accuracy_middlegame,
                        g.accuracy_endgame,
                        g.opponent_accuracy,
                        g.opponent_accuracy_opening,
                        g.opponent_accuracy_middlegame,
                        g.opponent_accuracy_endgame,
                        g.analyzed as i64,
                        incoming_updated,
                        g.analysis_excluded as i64,
                        g.time_class,
                        g.my_name,
                        g.analyzed_ts,
                        g.clocks,
                        g.time_control
                    ],
                )
                .map_err(|e| e.to_string())?;
                if g.note_ts > local_note_ts {
                    tx.execute(
                        "UPDATE games SET note = ?2, note_ts = ?3 WHERE id = ?1",
                        params![id, g.note, g.note_ts],
                    )
                    .map_err(|e| e.to_string())?;
                }
                if g.tags_ts > local_tags_ts {
                    tx.execute(
                        "UPDATE games SET tags = ?2, tags_ts = ?3 WHERE id = ?1",
                        params![
                            id,
                            serde_json::to_string(&g.tags).map_err(|e| e.to_string())?,
                            g.tags_ts
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
                applied += 1;
                id
            }
        };
        // Analyse übernehmen, wenn die Gegenseite sie hat und wir (noch) nicht.
        let locally_analyzed = existing.map(|(_, _, _, a, _)| a).unwrap_or(false);
        if !g.evals.is_empty() && !locally_analyzed {
            tx.execute(
                "DELETE FROM move_evals WHERE game_id = ?1",
                params![game_id],
            )
            .map_err(|e| e.to_string())?;
            let mut ins = tx
                .prepare(
                    "INSERT INTO move_evals (game_id, ply, san, eval_cp, mate_in, best_uci, judgment, phase)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                )
                .map_err(|e| e.to_string())?;
            for e in &g.evals {
                ins.execute(params![
                    game_id, e.ply, e.san, e.eval_cp, e.mate_in, e.best_uci, e.judgment, e.phase
                ])
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(applied)
}

fn apply_rep(conn: &mut Connection, nodes: &[SyncRepNode]) -> Result<usize, String> {
    // Lokale Pfade aufbauen (side + "\n" + Pfad → id, last_ts).
    let mut local_ids: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, side, san, last_ts FROM rep_nodes ORDER BY depth, id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, String, String, i64)> = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        let mut paths: HashMap<i64, String> = HashMap::new();
        for (id, parent_id, side, san, last_ts) in rows {
            let path = if parent_id == 0 {
                san
            } else {
                match paths.get(&parent_id) {
                    Some(p) => format!("{p} {san}"),
                    None => continue,
                }
            };
            paths.insert(id, path.clone());
            local_ids.insert(format!("{side}\n{path}"), (id, last_ts));
        }
    }

    // Tombstones: gelöschte Pfade nicht wieder anlegen, außer der Knoten ist
    // jünger als die Löschung (Wieder-Anlegen/Training nach dem Löschen).
    let tombstones = collect_tombstones(conn)?;

    // Eltern vor Kindern anlegen.
    let mut sorted: Vec<&SyncRepNode> = nodes.iter().collect();
    sorted.sort_by_key(|n| n.depth);
    let mut merged = 0usize;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for n in sorted {
        let alive = n.last_ts.max(n.created_ts);
        let buried = tombstones.iter().any(|t| {
            t.side == n.side
                && (n.path == t.path || n.path.starts_with(&format!("{} ", t.path)))
                && t.deleted_ts > alive
        });
        if buried {
            continue;
        }
        let key = format!("{}\n{}", n.side, n.path);
        match local_ids.get(&key) {
            None => {
                let parent_key = n
                    .path
                    .rsplit_once(' ')
                    .map(|(prefix, _)| format!("{}\n{}", n.side, prefix));
                let parent_id = match &parent_key {
                    None => 0,
                    Some(k) => match local_ids.get(k) {
                        Some((id, _)) => *id,
                        None => continue, // Elternknoten fehlt (übersprungen) · Kind auslassen
                    },
                };
                let san = n.path.rsplit(' ').next().unwrap_or(&n.path);
                tx.execute(
                    "INSERT INTO rep_nodes (parent_id, side, san, name, fen_key, depth,
                        stability, difficulty, reps, lapses, due_ts, last_ts, created_ts)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        parent_id,
                        n.side,
                        san,
                        n.name,
                        n.fen_key,
                        n.depth,
                        n.stability,
                        n.difficulty,
                        n.reps,
                        n.lapses,
                        n.due_ts,
                        n.last_ts,
                        n.created_ts
                    ],
                )
                .map_err(|e| e.to_string())?;
                local_ids.insert(key, (tx.last_insert_rowid(), n.last_ts));
                merged += 1;
            }
            Some((id, local_last)) => {
                if n.last_ts > *local_last {
                    tx.execute(
                        "UPDATE rep_nodes SET stability = ?2, difficulty = ?3, reps = ?4,
                            lapses = ?5, due_ts = ?6, last_ts = ?7 WHERE id = ?1",
                        params![
                            id,
                            n.stability,
                            n.difficulty,
                            n.reps,
                            n.lapses,
                            n.due_ts,
                            n.last_ts
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    merged += 1;
                }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(merged)
}

fn apply_puzzle_attempts(
    conn: &Connection,
    attempts: &[SyncPuzzleAttempt],
) -> Result<usize, String> {
    let mut n = 0usize;
    for a in attempts {
        n += conn
            .execute(
                "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
                 WHERE NOT EXISTS (SELECT 1 FROM puzzle_attempts WHERE puzzle_id = ?1 AND ts = ?2)",
                params![a.puzzle_id, a.ts, a.solved as i64, a.rating_before, a.rating_after, a.themes, a.puzzle_rating],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// Spiegelt den autoritativen Desktop-Snapshot. Puzzles werden über den
/// natürlichen Partie-Schlüssel an die gerätelokale Game-ID gehängt.
fn apply_own_puzzles(conn: &mut Connection, puzzles: &[SyncOwnPuzzle]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut retained = HashSet::new();
    let mut changed = 0usize;

    for puzzle in puzzles {
        let game_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM games WHERE source = ?1 AND source_id = ?2",
                params![puzzle.game_source, puzzle.game_source_id],
                |row| row.get(0),
            )
            .ok();
        let Some(game_id) = game_id else {
            continue;
        };

        retained.insert(puzzle.id.clone());
        changed += tx
            .execute(
                "INSERT INTO puzzles
                 (id, fen, moves, rating, rd, popularity, nb_plays, themes,
                  opening_tags, source, source_game_id, source_ply, setup_plies)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'own',?10,?11,?12)
                 ON CONFLICT(id) DO UPDATE SET
                    fen = excluded.fen,
                    moves = excluded.moves,
                    rating = excluded.rating,
                    rd = excluded.rd,
                    popularity = excluded.popularity,
                    nb_plays = excluded.nb_plays,
                    themes = excluded.themes,
                    opening_tags = excluded.opening_tags,
                    source = 'own',
                    source_game_id = excluded.source_game_id,
                    source_ply = excluded.source_ply,
                    setup_plies = excluded.setup_plies",
                params![
                    puzzle.id,
                    puzzle.fen,
                    puzzle.moves,
                    puzzle.rating,
                    puzzle.rd,
                    puzzle.popularity,
                    puzzle.nb_plays,
                    puzzle.themes,
                    puzzle.opening_tags,
                    game_id,
                    puzzle.source_ply,
                    puzzle.setup_plies
                ],
            )
            .map_err(|e| e.to_string())?;
    }

    let local_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM puzzles WHERE source = 'own'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for id in local_ids {
        if !retained.contains(&id) {
            changed += tx
                .execute(
                    "DELETE FROM puzzles WHERE source = 'own' AND id = ?1",
                    params![id],
                )
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

/// Spielt die Elo-Kette über alle Versuche deterministisch neu ab · nach einem
/// Merge haben damit beide Geräte identische Ratings. Sortiert wird geräte-
/// unabhängig nach (ts, puzzle_id); Versuche ohne bekanntes Puzzle-Rating
/// (puzzle_rating = 0) lassen das Rating unverändert.
fn replay_puzzle_ratings(conn: &mut Connection) -> Result<(), String> {
    const ELO_K: f64 = 24.0; // identisch zu puzzles.rs
    const DEFAULT_RATING: i64 = 1500;
    let rows: Vec<(i64, bool, i64)> = {
        let mut stmt = conn
            .prepare("SELECT id, solved, puzzle_rating FROM puzzle_attempts ORDER BY ts, puzzle_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string());
        rows?
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut rating = DEFAULT_RATING;
    for (id, solved, puzzle_rating) in rows {
        let before = rating;
        let after = if puzzle_rating > 0 {
            let expected = 1.0 / (1.0 + 10f64.powf((puzzle_rating - before) as f64 / 400.0));
            let score = if solved { 1.0 } else { 0.0 };
            (before as f64 + ELO_K * (score - expected)).round() as i64
        } else {
            before
        };
        tx.execute(
            "UPDATE puzzle_attempts SET rating_before = ?2, rating_after = ?3 WHERE id = ?1",
            params![id, before, after],
        )
        .map_err(|e| e.to_string())?;
        rating = after;
    }
    db::meta_set(&tx, "puzzle_rating", &rating.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_endgame_attempts(
    conn: &Connection,
    attempts: &[SyncEndgameAttempt],
) -> Result<usize, String> {
    let mut n = 0usize;
    for a in attempts {
        n += conn
            .execute(
                "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
                 SELECT ?1, ?2, ?3, ?4
                 WHERE NOT EXISTS (SELECT 1 FROM endgame_attempts WHERE drill_id = ?1 AND ts = ?2)",
                params![a.drill_id, a.ts, a.solved as i64, a.moves],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

fn apply_study_templates(
    conn: &Connection,
    templates: &[SyncStudyTemplate],
) -> Result<usize, String> {
    let mut merged = 0usize;
    for template in templates {
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_templates WHERE sync_key = ?1",
            params![template.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if template.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_templates
                         SET title=?1, duration_min=?2, tool=?3, description=?4,
                             created_ts=?5, updated_ts=?6, deleted=?7
                         WHERE id=?8",
                        params![
                            template.title,
                            template.duration_min,
                            template.tool,
                            template.description,
                            template.created_ts,
                            template.updated_ts,
                            template.deleted as i64,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_templates
                         (sync_key, title, duration_min, tool, description,
                          created_ts, updated_ts, deleted)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            template.sync_key,
                            template.title,
                            template.duration_min,
                            template.tool,
                            template.description,
                            template.created_ts,
                            template.updated_ts,
                            template.deleted as i64
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

fn apply_study_events(conn: &Connection, events: &[SyncStudyEvent]) -> Result<usize, String> {
    let mut merged = 0usize;
    for event in events {
        let template_id = match conn.query_row(
            "SELECT id FROM study_templates WHERE sync_key = ?1",
            params![event.template_sync_key],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(id) => id,
            Err(rusqlite::Error::QueryReturnedNoRows) => continue,
            Err(error) => return Err(error.to_string()),
        };
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_events WHERE sync_key = ?1",
            params![event.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if event.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_events
                         SET template_id=?1, day=?2, position=?3, completed=?4,
                             completed_ts=?5, created_ts=?6, updated_ts=?7, deleted=?8,
                             repeat_rule=?9, series_key=?10
                         WHERE id=?11",
                        params![
                            template_id,
                            event.day,
                            event.position,
                            event.completed as i64,
                            event.completed_ts,
                            event.created_ts,
                            event.updated_ts,
                            event.deleted as i64,
                            event.repeat_rule,
                            event.series_key,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_events
                         (sync_key, template_id, day, position, completed,
                          completed_ts, created_ts, updated_ts, deleted,
                          repeat_rule, series_key)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                        params![
                            event.sync_key,
                            template_id,
                            event.day,
                            event.position,
                            event.completed as i64,
                            event.completed_ts,
                            event.created_ts,
                            event.updated_ts,
                            event.deleted as i64,
                            event.repeat_rule,
                            event.series_key
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

/// Wiederholungen sind append-only · der Merge ist eine Vereinigung über den
/// natürlichen Schlüssel `(side, path, ts)`.
///
/// Fremde Zeilen bekommen `node_id = 0`: SQLite-IDs sind gerätelokal, und für
/// die Trainingslast zählt allein der Zeitpunkt. Die Spalte bleibt eine
/// Bequemlichkeit für lokal geschriebene Zeilen, kein Fremdschlüssel.
fn apply_rep_reviews(conn: &Connection, reviews: &[SyncRepReview]) -> Result<usize, String> {
    let mut merged = 0usize;
    for review in reviews {
        merged += conn
            .execute(
                "INSERT OR IGNORE INTO rep_review_log (node_id, ts, grade, side, path)
                 VALUES (0, ?1, ?2, ?3, ?4)",
                params![review.ts, review.grade, review.side, review.path],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(merged)
}

fn apply_study_focus(conn: &Connection, focuses: &[SyncStudyFocus]) -> Result<usize, String> {
    let mut merged = 0usize;
    for focus in focuses {
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_focus WHERE sync_key = ?1",
            params![focus.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if focus.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_focus
                         SET area=?1, metric_key=?2, label_params=?3, target=?4, cycle_days=?5,
                             start_ts=?6, end_ts=?7, status=?8, created_ts=?9, updated_ts=?10,
                             deleted=?11
                         WHERE id=?12",
                        params![
                            focus.area,
                            focus.metric_key,
                            focus.label_params,
                            focus.target,
                            focus.cycle_days,
                            focus.start_ts,
                            focus.end_ts,
                            focus.status,
                            focus.created_ts,
                            focus.updated_ts,
                            focus.deleted as i64,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_focus
                         (sync_key, area, metric_key, label_params, target, cycle_days,
                          start_ts, end_ts, status, created_ts, updated_ts, deleted)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                        params![
                            focus.sync_key,
                            focus.area,
                            focus.metric_key,
                            focus.label_params,
                            focus.target,
                            focus.cycle_days,
                            focus.start_ts,
                            focus.end_ts,
                            focus.status,
                            focus.created_ts,
                            focus.updated_ts,
                            focus.deleted as i64
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

/// Server-Seite eines Sync-Roundtrips: Request einmergen, Antwort einsammeln.
#[cfg(any(desktop, test))]
fn handle_sync(conn: &mut Connection, req: &SyncRequest) -> Result<SyncResponse, String> {
    apply_game_tombstones(conn, &req.game_tombstones)?;
    apply_games(conn, &req.games)?;
    apply_tombstones(conn, &req.rep_tombstones)?;
    apply_rep(conn, &req.rep_nodes)?;
    let pz = apply_puzzle_attempts(conn, &req.puzzle_attempts)?;
    if pz > 0 {
        replay_puzzle_ratings(conn)?;
    }
    apply_endgame_attempts(conn, &req.endgame_attempts)?;
    apply_study_templates(conn, &req.study_templates)?;
    apply_study_events(conn, &req.study_events)?;
    apply_rep_reviews(conn, &req.rep_reviews)?;
    apply_study_focus(conn, &req.study_focus)?;
    Ok(SyncResponse {
        now: db::now_ts(),
        games: collect_games(conn, req.since)?,
        game_tombstones: collect_game_tombstones(conn)?,
        rep_nodes: collect_rep(conn)?,
        rep_tombstones: collect_tombstones(conn)?,
        puzzle_attempts: collect_puzzle_attempts(conn, req.since)?,
        own_puzzles: Some(collect_own_puzzles(conn)?),
        endgame_attempts: collect_endgame_attempts(conn, req.since)?,
        study_templates: collect_study_templates(conn, req.since)?,
        study_events: collect_study_events(conn, req.since)?,
        rep_reviews: collect_rep_reviews(conn, req.since)?,
        study_focus: collect_study_focus(conn, req.since)?,
    })
}
