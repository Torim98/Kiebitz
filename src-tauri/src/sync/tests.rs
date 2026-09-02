#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        conn
    }

    fn sample_game(id: &str) -> SyncGame {
        SyncGame {
            source: "lichess".into(),
            source_id: id.into(),
            url: String::new(),
            played_at: "2026-07-01".into(),
            played_ts: 100,
            time_class: "rapid".into(),
            color: "white".into(),
            my_name: "Torim98".into(),
            opponent: "opp".into(),
            opp_elo: 1500,
            my_elo: 1490,
            result: "win".into(),
            opening: "Italian".into(),
            eco: "C50".into(),
            moves_count: 30,
            accuracy: None,
            accuracy_opening: None,
            accuracy_middlegame: None,
            accuracy_endgame: None,
            opponent_accuracy: None,
            opponent_accuracy_opening: None,
            opponent_accuracy_middlegame: None,
            opponent_accuracy_endgame: None,
            moves: "e4 e5".into(),
            note: String::new(),
            note_ts: 0,
            tags: Vec::new(),
            tags_ts: 0,
            analyzed: false,
            analyzed_ts: 0,
            clocks: String::new(),
            time_control: String::new(),
            termination: String::new(),
            analysis_excluded: false,
            updated_ts: 100,
            evals: Vec::new(),
        }
    }

    #[test]
    fn games_merge_is_idempotent_and_lww_metadata_wins() {
        let mut conn = mem_db();
        let mut g = sample_game("g1");
        g.note = "vom Handy".into();
        g.note_ts = 50;
        g.tags = vec!["OTB".into()];
        g.tags_ts = 50;
        g.accuracy_opening = Some(91.0);
        g.opponent_accuracy = Some(76.4);
        g.opponent_accuracy_opening = Some(79.2);
        apply_games(&mut conn, &[g.clone()]).unwrap();
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let (tags, opening, opponent, opponent_opening):
            (String, Option<f64>, Option<f64>, Option<f64>) = conn
            .query_row("SELECT tags, accuracy_opening, opponent_accuracy, opponent_accuracy_opening FROM games", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(tags, r#"["OTB"]"#);
        assert_eq!(opening, Some(91.0));
        assert_eq!(opponent, Some(76.4));
        assert_eq!(opponent_opening, Some(79.2));

        // Ältere Notiz verliert, neuere gewinnt.
        let mut older = g.clone();
        older.note = "alt".into();
        older.note_ts = 10;
        older.tags = vec!["old".into()];
        older.tags_ts = 10;
        apply_games(&mut conn, &[older]).unwrap();
        let note: String = conn
            .query_row("SELECT note FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note, "vom Handy");

        let mut newer = g;
        newer.note = "neu".into();
        newer.note_ts = 99;
        newer.tags = vec!["Club".into(), "Important".into()];
        newer.tags_ts = 99;
        apply_games(&mut conn, &[newer]).unwrap();
        let note: String = conn
            .query_row("SELECT note FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note, "neu");
        let tags: String = conn
            .query_row("SELECT tags FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, r#"["Club","Important"]"#);
    }

    #[test]
    fn game_tombstone_deletes_remote_copy_and_blocks_stale_recreation() {
        let mut conn = mem_db();
        let old = sample_game("deleted-game");
        apply_games(&mut conn, std::slice::from_ref(&old)).unwrap();

        let tombstone = SyncGameTombstone {
            source: old.source.clone(),
            source_id: old.source_id.clone(),
            deleted_ts: 200,
        };
        assert_eq!(apply_game_tombstones(&mut conn, &[tombstone]).unwrap(), 1);
        assert_eq!(
            apply_games(&mut conn, std::slice::from_ref(&old)).unwrap(),
            0
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        let mut reimported = old;
        reimported.updated_ts = 300;
        assert_eq!(apply_games(&mut conn, &[reimported]).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "a genuinely newer reimport may recreate the game");
    }

    #[test]
    fn manual_games_converge_even_when_they_predate_the_sync_cursor() {
        let mut desktop = mem_db();
        let mut mobile = mem_db();

        let mut desktop_game = sample_game("desktop-manual-legacy");
        desktop_game.source = "manual".into();
        desktop_game.updated_ts = 1;
        apply_games(&mut desktop, &[desktop_game]).unwrap();
        // Reproduziert eine Partie aus einer alten Datenbankmigration: Ein
        // Delta-Sync hinter einem gesetzten Cursor würde sie nie einsammeln.
        desktop
            .execute(
                "UPDATE games SET updated_ts = 0 WHERE source_id = 'desktop-manual-legacy'",
                [],
            )
            .unwrap();

        let mut mobile_game = sample_game("mobile-manual-offline");
        mobile_game.source = "manual".into();
        mobile_game.updated_ts = 1_000;
        apply_games(&mut mobile, &[mobile_game]).unwrap();
        let mut old_online_game = sample_game("mobile-online-old");
        old_online_game.updated_ts = 1_000;
        apply_games(&mut mobile, &[old_online_game]).unwrap();

        let since = 50_000;
        let outgoing = collect_games(&mobile, since).unwrap();
        // Nur der nicht wiederbeschaffbare manuelle Datensatz umgeht den
        // Cursor; alte Onlinepartien blähen das Delta nicht auf.
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].source_id, "mobile-manual-offline");

        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: outgoing,
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        let response = handle_sync(&mut desktop, &request).unwrap();
        apply_game_tombstones(&mut mobile, &response.game_tombstones).unwrap();
        apply_games(&mut mobile, &response.games).unwrap();

        for conn in [&desktop, &mobile] {
            let ids: Vec<String> = conn
                .prepare("SELECT source_id FROM games WHERE source = 'manual' ORDER BY source_id")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(ids, vec!["desktop-manual-legacy", "mobile-manual-offline"]);
        }

        // Der Vollabgleich darf beim nächsten Roundtrip keine Duplikate
        // erzeugen; der Natural Key bleibt die einzige Zeile pro Partie.
        let second_request = SyncRequest {
            code: "000000".into(),
            since,
            games: collect_games(&mobile, since).unwrap(),
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        let second_response = handle_sync(&mut desktop, &second_request).unwrap();
        apply_games(&mut mobile, &second_response.games).unwrap();
        for conn in [&desktop, &mobile] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM games WHERE source = 'manual'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 2);
        }
    }

    #[test]
    fn manual_full_sync_does_not_resurrect_a_tombstoned_game() {
        let mut desktop = mem_db();
        let mut mobile = mem_db();
        let mut stale = sample_game("deleted-manual");
        stale.source = "manual".into();
        stale.updated_ts = 100;
        apply_games(&mut desktop, &[stale.clone()]).unwrap();
        apply_games(&mut mobile, &[stale]).unwrap();

        let deletion = SyncGameTombstone {
            source: "manual".into(),
            source_id: "deleted-manual".into(),
            deleted_ts: 200,
        };
        apply_game_tombstones(&mut desktop, &[deletion]).unwrap();

        let since = 50_000;
        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: collect_games(&mobile, since).unwrap(),
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        assert_eq!(request.games.len(), 1, "manual games bypass the cursor");
        let response = handle_sync(&mut desktop, &request).unwrap();
        assert!(response.games.is_empty());
        apply_game_tombstones(&mut mobile, &response.game_tombstones).unwrap();
        apply_games(&mut mobile, &response.games).unwrap();

        for conn in [&desktop, &mobile] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM games WHERE source_id = 'deleted-manual'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);
        }
    }

    #[test]
    fn evals_adopted_only_when_not_locally_analyzed() {
        let mut conn = mem_db();
        let mut g = sample_game("g2");
        g.analyzed = true;
        g.evals = vec![SyncEval {
            ply: 1,
            san: "e4".into(),
            eval_cp: Some(30),
            mate_in: None,
            best_uci: "e2e4".into(),
            judgment: String::new(),
            phase: "opening".into(),
        }];
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let evals: i64 = conn
            .query_row("SELECT COUNT(*) FROM move_evals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(evals, 1);
        let analyzed: i64 = conn
            .query_row("SELECT analyzed FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(analyzed, 1);

        // Zweiter Sync mit anderen Evals überschreibt die lokale Analyse nicht.
        g.evals[0].eval_cp = Some(999);
        apply_games(&mut conn, &[g]).unwrap();
        let cp: i64 = conn
            .query_row("SELECT eval_cp FROM move_evals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cp, 30);
    }

    #[test]
    fn collect_games_groups_bulk_loaded_evals_by_game_and_ply() {
        let mut conn = mem_db();
        let games: Vec<SyncGame> = (0..64)
            .map(|index| {
                let mut game = sample_game(&format!("bulk-evals-{index}"));
                game.analyzed = true;
                game.evals = vec![
                    SyncEval {
                        ply: 2,
                        san: "e5".into(),
                        eval_cp: Some(index),
                        mate_in: None,
                        best_uci: "e7e5".into(),
                        judgment: String::new(),
                        phase: "opening".into(),
                    },
                    SyncEval {
                        ply: 1,
                        san: "e4".into(),
                        eval_cp: Some(index + 1),
                        mate_in: None,
                        best_uci: "e2e4".into(),
                        judgment: String::new(),
                        phase: "opening".into(),
                    },
                ];
                game
            })
            .collect();
        apply_games(&mut conn, &games).unwrap();

        let collected = collect_games(&conn, 0).unwrap();
        assert_eq!(collected.len(), games.len());
        assert!(collected
            .iter()
            .all(|game| game.evals.iter().map(|eval| eval.ply).collect::<Vec<_>>() == [1, 2]));
    }

    #[test]
    fn own_puzzle_snapshot_remaps_game_ids_and_propagates_removals() {
        let mut desktop = mem_db();
        apply_games(&mut desktop, &[sample_game("puzzle-game")]).unwrap();
        let desktop_game_id: i64 = desktop
            .query_row(
                "SELECT id FROM games WHERE source_id = 'puzzle-game'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        desktop
            .execute(
                "INSERT INTO puzzles
                 (id, fen, moves, rating, themes, opening_tags, source,
                  source_game_id, source_ply, setup_plies)
                 VALUES ('own:desktop:17', 'test-fen', 'e2e4', 1540,
                         'ownGame opening mistake oneMove', '', 'own', ?1, 17, 0)",
                params![desktop_game_id],
            )
            .unwrap();

        let snapshot = collect_own_puzzles(&desktop).unwrap();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].game_source_id, "puzzle-game");

        let mut mobile = mem_db();
        apply_games(&mut mobile, &[sample_game("filler")]).unwrap();
        apply_games(&mut mobile, &[sample_game("puzzle-game")]).unwrap();
        let mobile_game_id: i64 = mobile
            .query_row(
                "SELECT id FROM games WHERE source_id = 'puzzle-game'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(desktop_game_id, mobile_game_id);

        assert_eq!(apply_own_puzzles(&mut mobile, &snapshot).unwrap(), 1);
        let received: (i64, String, i64) = mobile
            .query_row(
                "SELECT source_game_id, moves, setup_plies
                 FROM puzzles WHERE id = 'own:desktop:17'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(received, (mobile_game_id, "e2e4".into(), 0));

        assert_eq!(apply_own_puzzles(&mut mobile, &[]).unwrap(), 1);
        let remaining: i64 = mobile
            .query_row(
                "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn analysis_time_travels_and_is_not_overwritten() {
        let mut conn = mem_db();
        let mut g = sample_game("g3");
        g.analyzed = true;
        g.analyzed_ts = 1_784_000_000;
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let stored = |c: &Connection| -> i64 {
            c.query_row("SELECT analyzed_ts FROM games", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(stored(&conn), 1_784_000_000);

        // Ein späterer Sync verschiebt den Review-Tag nicht mehr.
        g.analyzed_ts = 1_790_000_000;
        g.updated_ts += 10;
        apply_games(&mut conn, &[g]).unwrap();
        assert_eq!(stored(&conn), 1_784_000_000);
    }

    #[test]
    fn rep_merge_adds_paths_and_lww_fsrs() {
        let mut conn = mem_db();
        let node = |path: &str, depth: i64, last_ts: i64, reps: i64| SyncRepNode {
            side: "white".into(),
            path: path.into(),
            name: String::new(),
            fen_key: format!("fen-{path}"),
            depth,
            stability: 1.0,
            difficulty: 5.0,
            reps,
            lapses: 0,
            due_ts: 0,
            last_ts,
            created_ts: 0,
            sort_order: 0,
            sort_ts: 0,
        };
        apply_rep(&mut conn, &[node("e4", 1, 10, 1), node("e4 e5", 2, 10, 1)]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // Frischere Review gewinnt, ältere nicht.
        apply_rep(&mut conn, &[node("e4", 1, 20, 5)]).unwrap();
        let reps: i64 = conn
            .query_row("SELECT reps FROM rep_nodes WHERE san = 'e4'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(reps, 5);
        apply_rep(&mut conn, &[node("e4", 1, 15, 3)]).unwrap();
        let reps: i64 = conn
            .query_row("SELECT reps FROM rep_nodes WHERE san = 'e4'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(reps, 5);
    }

    /// Die selbst gezogene Reihenfolge hat ihren eigenen Zeitstempel: sie
    /// wandert unabhängig vom Lernstand, und die jüngere Anordnung gewinnt.
    /// Gegenstellen ohne das Feld (sort_ts 0) lassen sie in Ruhe.
    #[test]
    fn rep_merge_takes_the_younger_order() {
        let mut conn = mem_db();
        let node = |path: &str, sort_order: i64, sort_ts: i64| SyncRepNode {
            side: "white".into(),
            path: path.into(),
            name: String::new(),
            fen_key: format!("fen-{path}"),
            depth: 1,
            stability: 1.0,
            difficulty: 5.0,
            reps: 1,
            lapses: 0,
            due_ts: 0,
            last_ts: 10,
            created_ts: 0,
            sort_order,
            sort_ts,
        };
        let order = |conn: &Connection| -> (i64, i64) {
            conn.query_row(
                "SELECT sort_order, sort_ts FROM rep_nodes WHERE san = 'e4'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };

        // Anlegen bringt die Reihenfolge gleich mit.
        apply_rep(&mut conn, &[node("e4", 2, 100)]).unwrap();
        assert_eq!(order(&conn), (2, 100));

        // Jünger gewinnt, älter nicht.
        apply_rep(&mut conn, &[node("e4", 5, 200)]).unwrap();
        assert_eq!(order(&conn), (5, 200));
        apply_rep(&mut conn, &[node("e4", 9, 150)]).unwrap();
        assert_eq!(order(&conn), (5, 200));

        // Eine ältere Gegenstelle kennt das Feld nicht · sie ordnet nichts um.
        apply_rep(&mut conn, &[node("e4", 0, 0)]).unwrap();
        assert_eq!(order(&conn), (5, 200));
    }

    #[test]
    fn attempts_dedupe_on_natural_key() {
        let conn = mem_db();
        let a = SyncPuzzleAttempt {
            puzzle_id: "p1".into(),
            ts: 1000,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1480,
        };
        assert_eq!(
            apply_puzzle_attempts(&conn, std::slice::from_ref(&a)).unwrap(),
            1
        );
        assert_eq!(apply_puzzle_attempts(&conn, &[a]).unwrap(), 0);

        let e = SyncEndgameAttempt {
            drill_id: "lucena".into(),
            ts: 2000,
            solved: true,
            moves: 14,
        };
        assert_eq!(
            apply_endgame_attempts(&conn, std::slice::from_ref(&e)).unwrap(),
            1
        );
        assert_eq!(apply_endgame_attempts(&conn, &[e]).unwrap(), 0);
    }

    #[test]
    fn puzzle_history_is_collected_even_when_it_predates_the_sync_cursor() {
        let conn = mem_db();
        let old_attempt = SyncPuzzleAttempt {
            puzzle_id: "offline-puzzle".into(),
            ts: 1_000,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1600,
        };
        apply_puzzle_attempts(&conn, &[old_attempt]).unwrap();

        // Ein Zeitstempel-basierter Delta-Filter würde diesen bislang nie
        // synchronisierten Offline-Versuch dauerhaft verlieren.
        let collected = collect_puzzle_attempts(&conn, 50_000).unwrap();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].puzzle_id, "offline-puzzle");
    }

    #[test]
    fn puzzle_history_converges_after_a_cursor_gap() {
        let mut desktop = mem_db();
        let mobile = mem_db();
        let attempt = |id: &str, ts: i64| SyncPuzzleAttempt {
            puzzle_id: id.into(),
            ts,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1600,
        };
        apply_puzzle_attempts(&desktop, &[attempt("desktop-old", 1_000)]).unwrap();
        apply_puzzle_attempts(&mobile, &[attempt("mobile-old", 2_000)]).unwrap();

        let since = 50_000;
        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: vec![],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: collect_puzzle_attempts(&mobile, since).unwrap(),
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        let response = handle_sync(&mut desktop, &request).unwrap();
        apply_puzzle_attempts(&mobile, &response.puzzle_attempts).unwrap();

        for conn in [&desktop, &mobile] {
            let ids: Vec<String> = conn
                .prepare("SELECT puzzle_id FROM puzzle_attempts ORDER BY puzzle_id")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(ids, vec!["desktop-old", "mobile-old"]);
        }
    }

    /// Das Trainingsprogramm gehört dem Nutzer, nicht dem Gerät: Wochenbudget
    /// und Trainingstage reisen mit, und der jüngere Stand gewinnt.
    #[test]
    fn training_prefs_travel_between_devices() {
        let mut desktop = mem_db();
        db::study_pref_set(&desktop, "weekly_minutes", "0", 1).unwrap();
        db::study_pref_set(&desktop, "training_days", "0", 1).unwrap();

        let request = SyncRequest {
            code: "code".into(),
            since: 0,
            games: vec![],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![
                SyncPref {
                    key: "weekly_minutes".into(),
                    value: "180".into(),
                    updated_ts: 500,
                },
                // Ein Schlüssel, den dieses Gerät nicht kennt, wird verworfen.
                SyncPref {
                    key: "engine_path".into(),
                    value: "/tmp/stockfish".into(),
                    updated_ts: 900,
                },
            ],
        };
        let response = handle_sync(&mut desktop, &request).unwrap();
        assert_eq!(
            db::study_pref_get(&desktop, "weekly_minutes").as_deref(),
            Some("180")
        );
        assert!(db::study_pref_get(&desktop, "engine_path").is_none());
        // Die Antwort trägt den vereinigten Stand zurück.
        assert!(response
            .prefs
            .iter()
            .any(|pref| pref.key == "weekly_minutes" && pref.value == "180"));

        // Ein älterer Stand überschreibt den neueren nicht.
        let stale = SyncRequest {
            prefs: vec![SyncPref {
                key: "weekly_minutes".into(),
                value: "30".into(),
                updated_ts: 100,
            }],
            ..request
        };
        handle_sync(&mut desktop, &stale).unwrap();
        assert_eq!(
            db::study_pref_get(&desktop, "weekly_minutes").as_deref(),
            Some("180")
        );
    }

    #[test]
    fn study_plan_syncs_templates_events_completion_and_deletion() {
        let conn = mem_db();
        let template = SyncStudyTemplate {
            sync_key: "custom-calculation".into(),
            title: "Calculation".into(),
            duration_min: 30,
            tool: "Board".into(),
            description: "Candidate moves".into(),
            created_ts: 100,
            updated_ts: 100,
            deleted: false,
            area: "tactics".into(),
            i18n_key: String::new(),
            areas: "tactics".into(),
            builtin: String::new(),
        };
        let mut event = SyncStudyEvent {
            sync_key: "event-calculation-monday".into(),
            template_sync_key: template.sync_key.clone(),
            day: "2026-07-27".into(),
            position: 0,
            completed: false,
            completed_ts: 0,
            created_ts: 110,
            updated_ts: 110,
            deleted: false,
            repeat_rule: "weekly".into(),
            series_key: "series-calculation".into(),
            planned_min: 25,
            source: String::new(),
        };

        assert_eq!(
            apply_study_templates(&conn, std::slice::from_ref(&template)).unwrap(),
            1
        );
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 0);

        event.completed = true;
        event.completed_ts = 200;
        event.updated_ts = 200;
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        let completed: i64 = conn
            .query_row(
                "SELECT completed FROM study_events WHERE sync_key = ?1",
                params![event.sync_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1);

        event.deleted = true;
        event.updated_ts = 300;
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        assert!(collect_study_events(&conn, 250)
            .unwrap()
            .iter()
            .any(|entry| entry.sync_key == event.sync_key && entry.deleted));
    }

    #[test]
    fn rep_reviews_union_without_duplicating() {
        let conn = mem_db();
        let review = |ts: i64, grade: i64| SyncRepReview {
            side: "white".into(),
            path: "e4 e5 Nf3".into(),
            ts,
            grade,
        };

        assert_eq!(apply_rep_reviews(&conn, &[review(100, 3)]).unwrap(), 1);
        // Append-only heißt: derselbe Eintrag zweimal bleibt ein Eintrag. Ohne
        // das würde jede Synchronisation die Trainingslast aufblähen.
        assert_eq!(apply_rep_reviews(&conn, &[review(100, 3)]).unwrap(), 0);
        assert_eq!(apply_rep_reviews(&conn, &[review(200, 1)]).unwrap(), 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_review_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // Eingesammelt wird ab dem Cursor (mit Karenz), nicht alles.
        let collected = collect_rep_reviews(&conn, 150 + SLACK).unwrap();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].ts, 200);
        assert_eq!(collected[0].path, "e4 e5 Nf3");
    }

    #[test]
    fn tombstones_delete_subtree_but_newer_nodes_survive() {
        let mut conn = mem_db();
        let node = |path: &str, depth: i64, last_ts: i64, created_ts: i64| SyncRepNode {
            side: "white".into(),
            path: path.into(),
            name: String::new(),
            fen_key: format!("fen-{path}"),
            depth,
            stability: 1.0,
            difficulty: 5.0,
            reps: 1,
            lapses: 0,
            due_ts: 0,
            last_ts,
            created_ts,
            sort_order: 0,
            sort_ts: 0,
        };
        // Baum: e4 → e5 → Nf3; alles alt (ts 10).
        apply_rep(
            &mut conn,
            &[
                node("e4", 1, 10, 10),
                node("e4 e5", 2, 10, 10),
                node("e4 e5 Nf3", 3, 10, 10),
            ],
        )
        .unwrap();

        // Tombstone auf "e4 e5" (ts 50) löscht den Teilbaum, nicht die Wurzel.
        let tomb = SyncTombstone {
            side: "white".into(),
            path: "e4 e5".into(),
            deleted_ts: 50,
        };
        let deleted = apply_tombstones(&mut conn, std::slice::from_ref(&tomb)).unwrap();
        assert_eq!(deleted, 2);
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);

        // Alte Kopie der Gegenseite kommt nicht zurück (buried) …
        apply_rep(&mut conn, &[node("e4 e5", 2, 10, 10)]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);

        // … aber ein NEU angelegter Knoten (created_ts 100 > 50) überlebt.
        apply_rep(&mut conn, &[node("e4 e5", 2, 0, 100)]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 2);
        // Ein erneuter Tombstone-Sweep mit demselben Stein löscht ihn nicht.
        apply_tombstones(&mut conn, &[tomb]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 2);
    }

    #[test]
    fn rating_replay_is_deterministic_across_merge_orders() {
        // Zwei "Geräte" mit unterschiedlichen Versuchen; nach Merge + Replay
        // müssen beide dieselbe Elo-Kette und dasselbe Endrating haben.
        let attempt = |id: &str, ts: i64, solved: bool, pr: i64| SyncPuzzleAttempt {
            puzzle_id: id.into(),
            ts,
            solved,
            rating_before: 0,
            rating_after: 0,
            themes: String::new(),
            puzzle_rating: pr,
        };
        let a_set = [
            attempt("a", 100, true, 1600),
            attempt("b", 300, false, 1400),
        ];
        let b_set = [attempt("c", 200, true, 1550)];

        let final_rating = |first: &[SyncPuzzleAttempt], second: &[SyncPuzzleAttempt]| {
            let mut conn = mem_db();
            apply_puzzle_attempts(&conn, first).unwrap();
            apply_puzzle_attempts(&conn, second).unwrap();
            replay_puzzle_ratings(&mut conn).unwrap();
            db::meta_get(&conn, "puzzle_rating").unwrap()
        };
        let r1 = final_rating(&a_set, &b_set);
        let r2 = final_rating(&b_set, &a_set);
        assert_eq!(r1, r2, "Merge-Reihenfolge darf das Rating nicht ändern");
        assert_ne!(r1, "1500", "Replay muss die Versuche einrechnen");
    }

    #[test]
    fn pair_uri_roundtrips_through_parser() {
        let fingerprint = "0".repeat(64);
        let uri = pair_uri("192.168.178.30:47323", "123456", &fingerprint);
        assert_eq!(
            uri,
            "kiebitz://sync?host=192.168.178.30:47323&code=123456&fingerprint=0000000000000000000000000000000000000000000000000000000000000000"
        );
        // dieselbe Zerlegung wie im Frontend (parsePairUri).
        let q = &uri[uri.find('?').unwrap() + 1..];
        let mut host = "";
        let mut code = "";
        let mut parsed_fingerprint = "";
        for kv in q.split('&') {
            match kv.split_once('=') {
                Some(("host", v)) => host = v,
                Some(("code", v)) => code = v,
                Some(("fingerprint", v)) => parsed_fingerprint = v,
                _ => {}
            }
        }
        assert_eq!(host, "192.168.178.30:47323");
        assert_eq!(code, "123456");
        assert_eq!(parsed_fingerprint, fingerprint);
    }

    #[cfg(desktop)]
    #[test]
    fn qr_svg_encodes_pairing_uri() {
        let svg = qr_svg(&pair_uri("192.168.178.30:47323", "123456", &"a".repeat(64))).unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("<path d='M")); // mindestens ein dunkles Modul
        assert!(svg.contains("viewBox='0 0 "));
    }

    #[test]
    fn https_roundtrip_over_localhost_with_pinned_certificate() {
        // Echter TLS-tiny_http-Server + gepinnter ureq-Client · dieselben
        // Transportbausteine wie in start_server/sync_now, ohne Tauri-AppHandle.
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let fingerprint = hex_fingerprint(cert.der().as_ref());
        let server = tiny_http::Server::https(
            "127.0.0.1:0",
            tiny_http::SslConfig {
                certificate: cert.pem().into_bytes(),
                private_key: signing_key.serialize_pem().into_bytes(),
            },
        )
        .unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let mut body = Vec::new();
            request.as_reader().read_to_end(&mut body).unwrap();
            let req: SyncRequest = serde_json::from_slice(&body).unwrap();
            assert_eq!(req.code, "424242");
            let mut conn = mem_db();
            let resp = handle_sync(&mut conn, &req).unwrap();
            let json = serde_json::to_string(&resp).unwrap();
            request
                .respond(tiny_http::Response::from_string(json))
                .unwrap();
        });

        let req = SyncRequest {
            code: "424242".into(),
            since: 0,
            games: vec![sample_game("http1")],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        let tls_config = pinned_tls_config(&fingerprint).unwrap();
        let agent = ureq::AgentBuilder::new()
            .https_only(true)
            .tls_config(tls_config)
            .build();
        let resp = agent
            .post(&format!("https://localhost:{port}/sync"))
            .send_string(&serde_json::to_string(&req).unwrap())
            .unwrap();
        let resp: SyncResponse = serde_json::from_reader(resp.into_reader()).unwrap();
        assert!(resp.now > 0);
        // Der Server hat unsere Partie gemergt und liefert sie im Delta zurück.
        assert_eq!(resp.games.len(), 1);
        assert_eq!(resp.games[0].source_id, "http1");
        handle.join().unwrap();
    }

    #[test]
    fn roundtrip_via_handle_sync() {
        // "Desktop" hat eine analysierte Partie, "Handy" schickt einen Versuch.
        let mut desktop = mem_db();
        let mut g = sample_game("rt1");
        g.analyzed = true;
        g.evals = vec![SyncEval {
            ply: 1,
            san: "e4".into(),
            eval_cp: Some(20),
            mate_in: None,
            best_uci: "e2e4".into(),
            judgment: String::new(),
            phase: "opening".into(),
        }];
        apply_games(&mut desktop, &[g]).unwrap();

        let req = SyncRequest {
            code: "000000".into(),
            since: 0,
            games: vec![],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![SyncPuzzleAttempt {
                puzzle_id: "p9".into(),
                ts: 500,
                solved: false,
                rating_before: 1400,
                rating_after: 1390,
                themes: String::new(),
                puzzle_rating: 1450,
            }],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_sessions: vec![],
            prefs: vec![],
        };
        let resp = handle_sync(&mut desktop, &req).unwrap();
        assert_eq!(resp.games.len(), 1);
        assert_eq!(resp.games[0].evals.len(), 1);
        assert_eq!(resp.puzzle_attempts.len(), 1); // enthält den gerade gepushten

        // Der Versuch ist beim Desktop angekommen.
        let n: i64 = desktop
            .query_row("SELECT COUNT(*) FROM puzzle_attempts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
