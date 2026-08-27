#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const TODAY: i64 = 20_000;
    const NOW: i64 = TODAY * 86_400 + 12 * 3_600;

    #[test]
    fn aggregates_due_items_activity_backlog_and_streak() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        conn.execute(
            "INSERT INTO games (source, source_id, analyzed, moves)
             VALUES ('manual', 'open', 0, 'e4 e5')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed) VALUES ('manual', 'done', 1)",
            [],
        )
        .unwrap();

        // White depth 1 and black depth 2 are trainable moves. White depth 2
        // belongs to the opponent and must not enter the due counts.
        for (side, san, depth, reps, due_ts, last_ts) in [
            ("white", "e4", 1, 0, 0, (TODAY - 2) * 86_400 + 10),
            ("black", "e5", 2, 1, NOW - 1, 0),
            ("white", "c5", 2, 0, 0, 0),
            ("white", "Nf3", 3, 1, (TODAY + 1) * 86_400 + 10, 0),
        ] {
            conn.execute(
                "INSERT INTO rep_nodes
                 (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
                 VALUES (0, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    side,
                    san,
                    format!("fen-{side}-{san}"),
                    depth,
                    reps,
                    due_ts,
                    last_ts
                ],
            )
            .unwrap();
        }

        for ts in [TODAY * 86_400 + 100, (TODAY - 1) * 86_400 + 100] {
            conn.execute(
                "INSERT INTO puzzle_attempts
                 (puzzle_id, ts, solved, rating_before, rating_after, themes)
                 VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
                params![ts],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
             VALUES ('lucena', ?1, 1, 8)",
            params![(TODAY - 2) * 86_400 + 200],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_review_log (node_id, ts, grade, side, path)
             VALUES (1, ?1, 3, 'white', 'e4')",
            params![(TODAY - 2) * 86_400 + 10],
        )
        .unwrap();

        let data = study_data_from_conn(&conn, NOW, 12).unwrap();
        assert_eq!(data.due_now, 2);
        assert_eq!(data.due_week[0], 2);
        assert_eq!(data.due_week[1], 1);
        assert_eq!(data.unanalyzed, 1);
        assert_eq!(data.today_puzzle_attempts, 1);
        assert_eq!(data.puzzle_goal, 12);
        assert_eq!(data.activity.len(), 7);
        assert_eq!(data.activity[6].puzzle_attempts, 1);
        assert_eq!(data.activity[5].puzzle_attempts, 1);
        assert_eq!(data.activity[6].puzzle_solved, 1);
        assert_eq!(data.activity[4].endgame_attempts, 1);
        assert_eq!(data.activity[4].rep_reviews, 1);
        assert_eq!(data.streak_days, 3);
    }

    #[test]
    fn streak_can_continue_from_yesterday_when_today_is_empty() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        for day in [TODAY - 1, TODAY - 2] {
            conn.execute(
                "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
                 VALUES ('philidor', ?1, 1, 6)",
                params![day * 86_400 + 1],
            )
            .unwrap();
        }

        let data = study_data_from_conn(&conn, NOW, 20).unwrap();
        assert_eq!(data.streak_days, 2);
    }

    #[test]
    fn calendar_templates_and_events_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let template = StudyTemplateInput {
            id: None,
            title: "  Calculation  ".into(),
            tool: "Board".into(),
            description: "Three candidate moves".into(),
            areas: vec!["tactics".into()],
        };
        let title = clean_text(template.title, 80);
        conn.execute(
            "INSERT INTO study_templates
             (title, duration_min, tool, description, area, areas, created_ts, updated_ts)
             VALUES (?1, 0, ?2, ?3, ?4, ?4, 1, 1)",
            params![
                title,
                template.tool,
                template.description,
                template.areas[0]
            ],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO study_events (template_id, day, position, planned_min, created_ts)
             VALUES (?1, '2026-07-22', 0, 30, 1)",
            params![id],
        )
        .unwrap();

        let calendar = calendar_from_conn(&conn, "2026-07-20", "2026-07-26", NOW).unwrap();
        assert!(calendar.templates.iter().any(|t| t.title == "Calculation"));
        assert_eq!(calendar.events.len(), 1);
        assert_eq!(calendar.events[0].planned_min, 30);
        assert_eq!(calendar.events[0].template.areas, vec!["tactics"]);
        assert!(!calendar.events[0].completed);
        assert_eq!(calendar.days.len(), 7);
        assert_eq!(calendar.days[0].day, "2026-07-20");
        assert_eq!(calendar.days[6].day, "2026-07-26");
    }

    #[test]
    fn series_days_follow_the_chosen_grid_and_stay_bounded() {
        assert_eq!(
            series_days("2026-07-27", "weekly", Some("2026-08-17")).unwrap(),
            vec![
                "2026-07-27".to_string(),
                "2026-08-03".into(),
                "2026-08-10".into(),
                "2026-08-17".into()
            ]
        );
        assert_eq!(
            series_days("2026-07-27", "biweekly", Some("2026-08-24")).unwrap(),
            vec![
                "2026-07-27".to_string(),
                "2026-08-10".into(),
                "2026-08-24".into()
            ]
        );
        // Ohne Raster bleibt es ein Einzeltermin, egal welches Enddatum.
        assert_eq!(
            series_days("2026-07-27", "", Some("2027-07-27")).unwrap(),
            vec!["2026-07-27".to_string()]
        );
        // Der Standardhorizont greift ohne Enddatum, die Obergrenze bei einem
        // absurd weit entfernten.
        assert_eq!(series_days("2026-07-27", "weekly", None).unwrap().len(), 13);
        assert_eq!(
            series_days("2026-07-27", "daily", Some("2030-01-01"))
                .unwrap()
                .len(),
            MAX_OCCURRENCES
        );
        assert!(series_days("2026-07-27", "weekly", Some("2026-07-20")).is_err());
        assert!(series_days("27.07.2026", "weekly", None).is_err());
    }

    #[test]
    fn a_planned_unit_becomes_a_series_and_can_be_ended_again() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let template_id: i64 = conn
            .query_row(
                "SELECT id FROM study_templates ORDER BY id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let key = new_series_key(&conn).unwrap();
        let days = series_days("2026-07-27", "weekly", Some("2026-08-17")).unwrap();
        assert_eq!(
            insert_units(&conn, template_id, &days, "weekly", &key, 20, "").unwrap(),
            4
        );

        let calendar = calendar_from_conn(&conn, "2026-07-27", "2026-08-17", NOW).unwrap();
        assert_eq!(calendar.events.len(), 4);
        assert!(calendar
            .events
            .iter()
            .all(|event| event.repeat_rule == "weekly" && event.series_key == key));

        // Serie ab dem zweiten Termin beenden: davor bleibt sie stehen.
        let second = calendar.events[1].id;
        let now = now_ts();
        let removed = conn
            .execute(
                "UPDATE study_events SET deleted = 1, updated_ts = ?3
                 WHERE series_key = ?1 AND day >= ?2 AND deleted = 0",
                params![key, calendar.events[1].day, now],
            )
            .unwrap();
        assert_eq!(removed, 3, "der zweite Termin und alle danach");
        assert!(second > 0);
        let left = calendar_from_conn(&conn, "2026-07-27", "2026-08-17", NOW).unwrap();
        assert_eq!(left.events.len(), 1);
        assert_eq!(left.events[0].day, "2026-07-27");
    }

    #[test]
    fn validates_calendar_days() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        assert!(calendar_from_conn(&conn, "22.07.2026", "2026-07-26", NOW).is_err());
        assert!(calendar_from_conn(&conn, "2026-07-27", "2026-07-26", NOW).is_err());
    }

    #[test]
    fn iso_days_round_trip_and_match_day_starts() {
        for day in ["1970-01-01", "2026-02-28", "2024-02-29", "2026-12-31"] {
            let ts = day_start_ts(day).unwrap();
            assert_eq!(ts % 86_400, 0);
            assert_eq!(iso_day(ts), day);
        }
        assert!(day_start_ts("2026-13-01").is_none());
    }

    #[test]
    fn calendar_days_use_the_same_minutes_as_the_real_budget() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let today = iso_day(NOW);
        let day_start = TODAY * 86_400;

        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
            params![day_start + 60],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('q', ?1, 0, 1512, 1500, 'pin')",
            params![day_start + 120],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed, analyzed_ts)
             VALUES ('manual', 'reviewed', 1, ?1)",
            params![day_start + 180],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
             VALUES (0, 'white', 'e4', 'fen-e4', 1, 0, 0, 0)",
            [],
        )
        .unwrap();

        // Ein bewusst abgehakter Analyse-Termin zählt mit seiner Dauer; das
        // oben bloß von der Engine analysierte Spiel dagegen nicht.
        let analysis_template: i64 = conn
            .query_row(
                "SELECT id FROM study_templates WHERE title = 'Game review'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO study_events
             (template_id, day, position, completed, completed_ts)
             VALUES (?1, ?2, 0, 1, ?3)",
            params![analysis_template, today, day_start + 240],
        )
        .unwrap();

        let calendar = calendar_from_conn(&conn, &today, &today, NOW).unwrap();
        let day = &calendar.days[0];
        // Beide Puzzleversuche zählen als investierte Zeit: 2 × 1,5 Minuten,
        // dazu das manuell bestätigte 25-Minuten-Review.
        assert_eq!(day.puzzle_attempts, 2);
        assert_eq!(day.puzzle_solved, 1);
        assert_eq!(day.game_reviews, 1);
        assert_eq!(day.actual_minutes, 28);
        // Neue Repertoire-Karten sind heute fällig.
        assert_eq!(day.due_reviews, 1);
    }

    #[test]
    fn training_load_splits_minutes_by_area() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let day_start = TODAY * 86_400;

        for offset in 0..4 {
            conn.execute(
                "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after)
                 VALUES ('p', ?1, 1, 1500, 1510)",
                params![day_start + offset * 60],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO endgame_attempts (drill_id, ts, solved, moves) VALUES ('lucena', ?1, 1, 20)",
            params![day_start + 500],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_review_log (node_id, ts, grade, side, path)
             VALUES (1, ?1, 3, 'white', 'e4')",
            params![day_start + 600],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games
             (source, source_id, played_ts, time_control, time_class, moves_count, analyzed, analyzed_ts)
             VALUES ('lichess', 'g1', ?1, '600+0', 'rapid', 40, 1, ?2)",
            params![day_start + 700, day_start + 800],
        )
        .unwrap();

        let program = training_program_from_conn(&conn, NOW, 28).unwrap();
        let by_area = |area: &str| -> AreaLoad {
            program
                .load_28d
                .iter()
                .find(|l| l.area == area)
                .cloned()
                .unwrap()
        };
        assert_eq!(by_area("tactics").items, 4);
        // 4 × 1,5 Minuten
        assert_eq!(by_area("tactics").minutes, 6);
        assert_eq!(by_area("endgames").items, 1);
        assert_eq!(by_area("endgames").minutes, 4);
        assert_eq!(by_area("openings").items, 1);
        assert_eq!(by_area("openings").minutes, 1);
        assert_eq!(by_area("play").items, 1);
        // 600 s nominal, zwei Drittel davon: 6,67 Minuten, am Ende gerundet.
        assert_eq!(by_area("play").minutes, 7);
        // Das Fertigwerden der Engine ist kein bewusstes Partie-Review.
        assert_eq!(by_area("analysis").items, 0);
        assert_eq!(by_area("analysis").minutes, 0);
        assert_eq!(program.days.len(), 1);
    }

    #[test]
    fn measured_time_completes_planned_units_by_itself() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let day = "2026-08-13";
        let day_ts = day_start_ts(day).unwrap();

        // Zwei geplante Taktikeinheiten à 20 Minuten an einem Tag.
        conn.execute(
            "INSERT INTO study_templates
             (sync_key, title, duration_min, tool, description, area, created_ts, updated_ts)
             VALUES ('tpl', 'Taktik', 20, '', '', 'tactics', 1, 1)",
            [],
        )
        .unwrap();
        let template_id = conn.last_insert_rowid();
        for position in 0..2 {
            conn.execute(
                "INSERT INTO study_events
                 (sync_key, template_id, day, position, created_ts, updated_ts)
                 VALUES (?1, ?2, ?3, ?4, 1, 1)",
                params![format!("event-{position}"), template_id, day, position],
            )
            .unwrap();
        }

        // 25 gemessene Minuten decken die erste Einheit, die zweite nicht.
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s1', 'tactics', ?1, ?1, 1500, ?1)",
            params![day_ts + 3_600],
        )
        .unwrap();
        let calendar = calendar_from_conn(&conn, day, day, day_ts + 7_200).unwrap();
        let done: Vec<bool> = calendar.events.iter().map(|e| e.auto_done).collect();
        assert_eq!(done, vec![true, false]);

        // Mit 40 gemessenen Minuten sind beide erfüllt.
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s2', 'tactics', ?1, ?1, 900, ?1)",
            params![day_ts + 7_200],
        )
        .unwrap();
        let calendar = calendar_from_conn(&conn, day, day, day_ts + 10_800).unwrap();
        assert!(calendar.events.iter().all(|e| e.auto_done));
    }

    #[test]
    fn units_without_an_area_are_never_completed_by_themselves() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let day = "2026-08-13";
        let day_ts = day_start_ts(day).unwrap();
        conn.execute(
            "INSERT INTO study_templates
             (sync_key, title, duration_min, tool, description, area, created_ts, updated_ts)
             VALUES ('tpl', 'Nachdenken', 20, '', '', '', 1, 1)",
            [],
        )
        .unwrap();
        let template_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO study_events
             (sync_key, template_id, day, position, created_ts, updated_ts)
             VALUES ('event', ?1, ?2, 0, 1, 1)",
            params![template_id, day],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s1', 'tactics', ?1, ?1, 7200, ?1)",
            params![day_ts + 3_600],
        )
        .unwrap();

        // Ohne Bereich lässt sich nicht sagen, worauf die gemessene Zeit
        // einzahlt · dann bleibt das Abhaken beim Nutzer.
        let calendar = calendar_from_conn(&conn, day, day, day_ts + 7_200).unwrap();
        assert!(!calendar.events[0].auto_done);
    }

    #[test]
    fn every_area_keeps_a_builtin_unit_the_week_plan_can_use() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        // Genau eine Standardeinheit je Bereich · vorher hatte die Analyse
        // keine, und der Wochenvorschlag ließ sie deshalb stillschweigend aus.
        let mut areas: Vec<String> = conn
            .prepare("SELECT builtin FROM study_templates WHERE builtin <> '' ORDER BY builtin")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        areas.sort();
        assert_eq!(
            areas,
            vec!["analysis", "endgames", "openings", "play", "tactics"]
        );

        // Sie lassen sich nicht löschen, und ein zweiter Start legt sie nicht
        // ein zweites Mal an.
        let id: i64 = conn
            .query_row(
                "SELECT id FROM study_templates WHERE builtin = 'analysis'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "UPDATE study_templates SET deleted = 1 WHERE id = ?1",
            params![id],
        )
        .unwrap();
        db::init(&conn).unwrap();
        let alive: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM study_templates WHERE builtin <> '' AND deleted = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(alive, 5);
    }

    #[test]
    fn a_unit_with_two_areas_needs_measured_time_in_both() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let day = "2026-08-13";
        let day_ts = day_start_ts(day).unwrap();
        conn.execute(
            "INSERT INTO study_templates
             (sync_key, title, duration_min, tool, description, area, areas, created_ts, updated_ts)
             VALUES ('tpl', 'Taktik und Endspiel', 0, '', '', 'tactics',
                     'tactics,endgames', 1, 1)",
            [],
        )
        .unwrap();
        let template_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO study_events
             (sync_key, template_id, day, position, planned_min, created_ts, updated_ts)
             VALUES ('event', ?1, ?2, 0, 30, 1, 1)",
            params![template_id, day],
        )
        .unwrap();

        // Nur Taktik gemessen: die Hälfte des Bedarfs fehlt weiterhin.
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s1', 'tactics', ?1, ?1, 1800, ?1)",
            params![day_ts + 3_600],
        )
        .unwrap();
        let calendar = calendar_from_conn(&conn, day, day, day_ts + 7_200).unwrap();
        assert!(!calendar.events[0].auto_done);

        // Mit einer Viertelstunde Endspiel ist die Einheit erfüllt.
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s2', 'endgames', ?1, ?1, 900, ?1)",
            params![day_ts + 7_200],
        )
        .unwrap();
        let calendar = calendar_from_conn(&conn, day, day, day_ts + 10_800).unwrap();
        assert!(calendar.events[0].auto_done);
    }

    #[test]
    fn a_second_week_plan_replaces_its_own_units_and_spares_the_rest() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let template_id: i64 = conn
            .query_row(
                "SELECT id FROM study_templates WHERE builtin = 'tactics'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Von Hand geplant und schon erledigt · beides muss den Vorschlag
        // überleben, sonst wäre er kein Regelkreis, sondern ein Bulldozer.
        insert_units(&conn, template_id, &["2026-08-11".to_string()], "", "", 20, "").unwrap();
        insert_units(&conn, template_id, &["2026-08-12".to_string()], "", "", 20, "plan").unwrap();
        conn.execute(
            "UPDATE study_events SET completed = 1 WHERE day = '2026-08-12'",
            [],
        )
        .unwrap();
        insert_units(&conn, template_id, &["2026-08-13".to_string()], "", "", 20, "plan").unwrap();

        let tx = conn.transaction().unwrap();
        tx.execute(
            "UPDATE study_events SET deleted = 1, updated_ts = 2
              WHERE source = 'plan' AND completed = 0 AND deleted = 0
                AND day >= '2026-08-10' AND day <= '2026-08-16'",
            [],
        )
        .unwrap();
        insert_units(&tx, template_id, &["2026-08-14".to_string()], "", "", 35, "plan").unwrap();
        tx.commit().unwrap();

        let calendar = calendar_from_conn(&conn, "2026-08-10", "2026-08-16", NOW).unwrap();
        let days: Vec<&str> = calendar.events.iter().map(|e| e.day.as_str()).collect();
        assert_eq!(days, vec!["2026-08-11", "2026-08-12", "2026-08-14"]);
        assert_eq!(calendar.events[2].planned_min, 35);
        assert_eq!(calendar.events[2].source, "plan");
    }

    #[test]
    fn a_planned_unit_carries_its_own_length() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        // Fünf-Minuten-Schritte, und nie kürzer als eine Sitzung.
        assert_eq!(clamp_planned(0), 0);
        assert_eq!(clamp_planned(3), 10);
        assert_eq!(clamp_planned(23), 25);
        assert_eq!(clamp_planned(500), 90);
    }

    #[test]
    fn measures_game_length_from_the_clocks() {
        // 5+3, beide Seiten haben je zwei Züge gemacht. Weiß steht am Ende bei
        // 4:50 (29000), Schwarz bei 4:40 (28000). Verbraucht hat damit Weiß
        // 300 + 2×3 − 290 = 16 s, Schwarz 300 + 2×3 − 280 = 26 s.
        let seconds = game_seconds_measured("29500 29000 29000 28000", "300+3").unwrap();
        assert!((seconds - 42.0).abs() < 0.01, "gemessen: {seconds}");

        // Ohne Uhren oder ohne Zeitvorgabe gibt es nichts zu messen.
        assert!(game_seconds_measured("", "300+3").is_none());
        assert!(game_seconds_measured("29500 29000", "").is_none());
        assert!(game_seconds_measured("29500 29000", "-").is_none());
        // Uhren, die nicht zur angegebenen Vorgabe passen, zählen lieber nicht.
        assert!(game_seconds_measured("60000 60000", "300+0").is_none());

        // Die Partieminuten nehmen die Messung, wenn es eine gibt.
        assert_eq!(
            game_minutes_real("29500 29000 29000 28000", "300+3", "blitz", 2).round(),
            1.0
        );
        // Ohne Uhren bleibt die Schätzung aus der Zeitkontrolle.
        assert_eq!(game_minutes_real("", "300+3", "blitz", 40).round(), 4.0);
        // Fernpartien zählen weiterhin gar nicht.
        assert_eq!(game_minutes_real("100 90", "1209600+0", "daily", 60), 0.0);
    }

    #[test]
    fn measured_sessions_replace_the_estimate_from_their_first_day_on() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        // Ein Puzzle-Versuch gestern, einer heute · dazu eine echte Messung,
        // aber erst ab heute.
        for day in [TODAY - 1, TODAY] {
            conn.execute(
                "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after)
                 VALUES ('p', ?1, 1, 1500, 1510)",
                params![day * 86_400 + 3_600],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO study_sessions (sync_key, area, start_ts, end_ts, seconds, updated_ts)
             VALUES ('s1', 'tactics', ?1, ?1, 900, ?1)",
            params![TODAY * 86_400 + 3_600],
        )
        .unwrap();

        let program = training_program_from_conn(&conn, NOW, 28).unwrap();
        let today = program
            .days
            .iter()
            .find(|d| d.day_ts == TODAY * 86_400)
            .unwrap();
        let yesterday = program
            .days
            .iter()
            .find(|d| d.day_ts == (TODAY - 1) * 86_400)
            .unwrap();

        // Heute zählt die Messung: 900 s sind 15 Minuten, nicht 1,5.
        assert_eq!(today.tactics, 15);
        // Gestern liegt vor der ersten Messung und behält die Hochrechnung.
        assert_eq!(yesterday.tactics, 2);
    }

    #[test]
    fn game_minutes_fall_back_to_the_time_class() {
        // Zeitkontrolle mit Inkrement: 300 s + 3 s × 20 Züge = 360 s → 4 min.
        assert_eq!(game_minutes("300+3", "blitz", 40).round(), 4.0);
        // Ohne verwertbare Angabe entscheidet die Klasse.
        assert_eq!(game_minutes("", "bullet", 30).round(), 1.0);
        assert_eq!(game_minutes("-", "rapid", 30).round(), 10.0);
        // Bei einer Fernpartie lässt sich aus Endzeitpunkt und Tagesuhr keine
        // reale Sitzungsdauer ableiten.
        assert_eq!(game_minutes("1209600+0", "daily", 60), 0.0);
    }
}
