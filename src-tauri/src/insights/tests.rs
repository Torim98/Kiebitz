// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_time_controls() {
        assert_eq!(parse_time_control("600+5"), Some((600.0, 5.0)));
        assert_eq!(parse_time_control("300"), Some((300.0, 0.0)));
        assert_eq!(parse_time_control("40/7200:1800"), Some((7200.0, 0.0)));
        assert_eq!(parse_time_control("-"), None);
        assert_eq!(parse_time_control(""), None);
    }

    #[test]
    fn correspondence_clocks_are_not_live_time_management_data() {
        let game = RawGame {
            id: 1,
            played_ts: 0,
            source: "chess.com".into(),
            time_class: "daily".into(),
            color: "white".into(),
            result: "win".into(),
            moves: "e4 e5 Nf3 Nc6".into(),
            clocks: "60000 50000 40000 30000".into(),
            time_control: "1/86400".into(),
            my_elo: 1500,
            opp_elo: 1500,
            accuracy: None,
            opening: String::new(),
        };
        assert!(clocks_of(&game).is_none());
    }

    #[test]
    fn clock_spending_uses_the_players_own_previous_reading() {
        let clocks = Clocks {
            initial: 600.0,
            increment: 5.0,
            // Weiß: 597, 590 · Schwarz: 598, 585
            remaining: vec![597.0, 598.0, 590.0, 585.0],
        };
        // Halbzug 1 (Weiß): 600 + 5 − 597 = 8
        let (spent, share) = clocks.spent(1).unwrap();
        assert!((spent - 8.0).abs() < 0.001, "{spent}");
        assert!((share - 8.0 / 605.0).abs() < 0.001);
        // Halbzug 3 (Weiß): 597 + 5 − 590 = 12
        let (spent, _) = clocks.spent(3).unwrap();
        assert!((spent - 12.0).abs() < 0.001, "{spent}");
        // Halbzug 4 (Schwarz): 598 + 5 − 585 = 18
        let (spent, _) = clocks.spent(4).unwrap();
        assert!((spent - 18.0).abs() < 0.001, "{spent}");
    }

    #[test]
    fn clock_before_falls_back_to_the_base_time() {
        let clocks = Clocks {
            initial: 300.0,
            increment: 0.0,
            remaining: vec![295.0, 294.0, 280.0, 270.0],
        };
        assert_eq!(clocks.before(1), 300.0);
        assert_eq!(clocks.before(2), 300.0);
        assert_eq!(clocks.before(3), 295.0);
        assert_eq!(clocks.before(4), 294.0);
        assert_eq!(clocks.last_of(true), Some(280.0));
        assert_eq!(clocks.last_of(false), Some(270.0));
    }

    #[test]
    fn endgame_signatures_follow_the_material() {
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4P3/4K3"), "pawn");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4R3/4K3"), "rook");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4Q3/4K3"), "queen");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/3RN3/4K3"), "rook+minor");
        // Weißer Läufer c1 (dunkel), schwarzer Läufer f8 (dunkel) → gleichfarbig.
        assert_eq!(endgame_signature("5b2/8/8/8/8/8/8/2B1K2k"), "minor");
        // Weiß c1 (dunkel), Schwarz c8 (hell) → ungleichfarbig.
        assert_eq!(
            endgame_signature("2b5/8/8/8/8/8/8/2B1K2k"),
            "opposite-bishops"
        );
    }

    #[test]
    fn opening_families_survive_both_pgn_spellings() {
        // Lichess trennt mit Doppelpunkt, chess.com gar nicht · beide müssen
        // auf dieselbe Familie fallen, sonst zerfällt die Auswertung in
        // Einzelpartien.
        assert_eq!(
            family_from_name("Sicilian Defense: Alapin Variation, 2...d5"),
            "Sicilian Defense"
        );
        assert_eq!(
            family_from_name("Sicilian Defense Bowdler Attack"),
            "Sicilian Defense"
        );
        assert_eq!(
            family_from_name("Queen's Gambit Declined: Exchange"),
            "Queen's Gambit"
        );
        assert_eq!(family_from_name("Italian Game"), "Italian Game");
        // Ohne Schlüsselwort bleibt der Kopf stehen.
        assert_eq!(family_from_name("Ruy Lopez"), "Ruy Lopez");
        assert_eq!(family_from_name(""), "");
    }

    #[test]
    fn line_label_numbers_the_moves() {
        assert_eq!(line_label("e4 c5 Nf3 d6 d4", 4), "1.e4 c5 2.Nf3 d6");
        assert_eq!(line_label("d4", 4), "1.d4");
        assert_eq!(line_label("", 4), "");
    }

    #[test]
    fn metric_windows_report_their_sample_size() {
        // Ohne Partien im Fenster darf keine Kennzahl einen Wert vortäuschen ·
        // „noch nicht messbar" ist die richtige Antwort, nicht 0 %.
        let window = metrics_for_window(&[], &[], 0, 100);
        assert_eq!(window.games, 0);
        for value in &window.metrics {
            assert!(value.value.is_none(), "{} hat einen Wert", value.key);
            assert_eq!(value.n, 0);
        }
        assert!(window.metrics.iter().any(|m| m.key == "blunders_per100"));
        assert!(window
            .metrics
            .iter()
            .find(|m| m.key == "blunders_per100")
            .is_some_and(|m| m.lower_is_better));
        assert!(window
            .metrics
            .iter()
            .find(|m| m.key == "acc_overall")
            .is_some_and(|m| !m.lower_is_better));
    }

    #[test]
    fn puzzle_metrics_are_cut_to_the_window() {
        let attempts = vec![(50, true, 1400), (150, false, 1500), (250, true, 1600)];
        let window = metrics_for_window(&[], &attempts, 100, 200);
        let solve = window
            .metrics
            .iter()
            .find(|m| m.key == "puzzle_solve_pct")
            .unwrap();
        assert_eq!(solve.n, 1);
        assert_eq!(solve.value, Some(0.0));
        let rating = window
            .metrics
            .iter()
            .find(|m| m.key == "puzzle_rating")
            .unwrap();
        assert_eq!(rating.value, Some(1500.0));
    }

    #[test]
    fn sd_needs_at_least_two_values() {
        assert_eq!(sd_of(&[]), None);
        assert_eq!(sd_of(&[5.0]), None);
        let sd = sd_of(&[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]).unwrap();
        assert!((sd - 2.138).abs() < 0.01, "{sd}");
    }

    #[test]
    fn piece_of_san_reads_the_leading_letter() {
        assert_eq!(piece_of_san("e4"), "P");
        assert_eq!(piece_of_san("exd5"), "P");
        assert_eq!(piece_of_san("Nf3"), "N");
        assert_eq!(piece_of_san("O-O"), "K");
        assert_eq!(piece_of_san("Qxh7#"), "Q");
    }

    #[test]
    fn month_keys_match_the_calendar() {
        // 2026-07-31 00:00 UTC
        assert_eq!(month_key(1_785_456_000), "2026-07");
        // 1970-01-01
        assert_eq!(month_key(0), "1970-01");
    }

    #[test]
    fn loss_is_measured_from_the_moving_side() {
        let raw = RawGame {
            id: 1,
            played_ts: 0,
            source: "lichess".into(),
            time_class: "blitz".into(),
            color: "white".into(),
            result: "loss".into(),
            moves: String::new(),
            clocks: String::new(),
            time_control: String::new(),
            my_elo: 1500,
            opp_elo: 1500,
            accuracy: None,
            opening: String::new(),
        };
        let evals = vec![
            Ev {
                ply: 1,
                san: "e4".into(),
                eval_cp: Some(0),
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: "opening".into(),
            },
            Ev {
                ply: 2,
                san: "e5".into(),
                eval_cp: Some(300),
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: "opening".into(),
            },
        ];
        let wp = evals
            .iter()
            .map(|e| win_prob(e.eval_cp, e.mate_in))
            .collect();
        let view = GameView {
            raw: &raw,
            evals: &evals,
            wp,
            clocks: None,
            book_departure: None,
            book_plies: 0,
        };
        // Halbzug 2 ist Schwarz und verschlechtert die Lage von Schwarz.
        let loss = view.loss(2).unwrap();
        assert!(loss > 0.2, "Schwarz verliert Winrate: {loss}");
        // Aus meiner (weißen) Sicht steht es danach besser.
        assert_eq!(view.cp_mine(2), Some(300.0));
    }

    /// Ende zu Ende gegen eine echte Datenbank: SQL, Nachspielen der Züge und
    /// Aggregation greifen ineinander, und genau dort brechen Änderungen.
    #[test]
    fn computes_over_a_real_database() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();

        // Skandinavisch, in dem Weiß im 5. Zug eine Figur einstellt. Die
        // Uhrwerte sinken je Halbzug um zwei Sekunden, der 9. Halbzug (Weiß)
        // kostet bewusst deutlich mehr.
        let moves = "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Bd2 Qb6";
        let clocks: Vec<String> = (1..=10)
            .map(|ply: i64| {
                let base = 30_000 - ply * 200;
                (if ply == 9 { base - 4_000 } else { base }).to_string()
            })
            .collect();

        conn.execute(
            "INSERT INTO games (id, source, source_id, played_at, played_ts, time_class, color,
                                opponent, opp_elo, my_elo, result, opening, moves_count, accuracy,
                                moves, analyzed, clocks, time_control)
             VALUES (1,'lichess','g1','2026-07-01',1782000000,'blitz','white','Gegner',1500,1500,
                     'loss','Scandinavian Defense',10,68.0,?1,1,?2,'300+0')",
            rusqlite::params![moves, clocks.join(" ")],
        )
        .unwrap();

        // Bewertungen: bis Halbzug 8 ausgeglichen, Halbzug 9 ist der Patzer.
        for ply in 1..=10i64 {
            let eval = if ply >= 9 { -350 } else { 20 };
            let judgment = if ply == 9 { "blunder" } else { "" };
            // Der übersehene Bestzug im 9. Halbzug wäre Bb5+ gewesen · ein
            // Schach und damit forcierend.
            let best = if ply == 9 { "f1b5" } else { "" };
            conn.execute(
                "INSERT INTO move_evals (game_id, ply, san, eval_cp, best_uci, judgment, phase)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, 'opening')",
                rusqlite::params![
                    ply,
                    moves.split_whitespace().nth((ply - 1) as usize).unwrap(),
                    eval,
                    best,
                    judgment
                ],
            )
            .unwrap();
        }

        let out = compute(&conn).unwrap();

        assert_eq!(out.coverage.games, 1);
        assert_eq!(out.coverage.analyzed, 1);
        assert_eq!(out.coverage.with_clocks, 1, "Uhren wurden gelesen");
        assert_eq!(out.coverage.moves_judged, 10);

        // Zeit: fünf eigene Halbzüge, der Patzer ist der teuerste davon.
        assert_eq!(out.time.games, 1);
        assert_eq!(out.time.moves, 5);
        assert_eq!(
            out.time.theory.book_moves, 0,
            "ohne Repertoire ist kein Zug bekannt"
        );
        assert!(
            out.time.focus.error_share > out.time.focus.ok_share,
            "der lange Zug war der Fehlzug: {:?}",
            out.time.focus
        );

        // Eine schmale Linie kennt genau die passenden eigenen Züge. Nach
        // ihrem Ende werden die restlichen Eröffnungszüge nicht pauschal zu
        // Repertoirezügen erklärt.
        conn.execute(
            "INSERT INTO rep_nodes (id, parent_id, side, san, fen_key, depth)
             VALUES (1, 0, 'white', 'e4', 'book-e4', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (id, parent_id, side, san, fen_key, depth)
             VALUES (2, 1, 'white', 'd5', 'book-e4-d5', 2)",
            [],
        )
        .unwrap();
        let with_book = compute(&conn).unwrap();
        assert_eq!(with_book.time.theory.book_moves, 1);

        // Inhalt: der Patzer wird der Figur zugeordnet, die gezogen hat (Läufer
        // Bd2), und der übersehene Bestzug war forcierend.
        assert_eq!(out.content.games, 1);
        assert_eq!(out.content.anatomy.errors, 1);
        assert_eq!(
            out.content.anatomy.forcing_missed, 1,
            "Bb5+ wäre ein Schach"
        );
        let bishop = out
            .content
            .anatomy
            .by_piece
            .iter()
            .find(|p| p.piece == "B")
            .expect("Läuferzüge wurden gezählt");
        assert_eq!(bishop.errors, 1);

        // Feldvergleich: eigene und gegnerische Züge landen getrennt.
        let me = out.benchmark.me.expect("eigene Züge");
        let field = out.benchmark.field.expect("Gegnerzüge");
        assert_eq!(me.moves, 5);
        assert_eq!(field.moves, 5);
        assert!(me.blunders_per_100 > field.blunders_per_100);

        // Formate: eine Partie fällt unter die Mindestgröße und taucht nicht auf.
        assert!(out.formats.formats.is_empty());
        assert_eq!(out.sessions.sessions, 1);

        // Eröffnungsfamilie: aus dem PGN-Namen gekürzt, meiner Farbe zugeordnet.
        assert_eq!(out.openings.games, 1);
        let family = &out.openings.families[0];
        assert_eq!(family.label, "Scandinavian Defense");
        assert_eq!(family.color, "white");
        assert_eq!(family.root, "e4");
        assert_eq!(family.games, 1);
        assert_eq!(family.score_pct, 0.0);
        // Fünf eigene Halbzüge in der Eröffnungsphase, davon einer ein Patzer.
        assert_eq!(family.moves, 5);
        assert_eq!(family.blunders_per_100, 20.0);
        assert_eq!(out.openings.baseline_score, 0.0);
    }

    #[test]
    fn metric_windows_cut_the_same_database_by_time() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();

        // Zwei Partien, ein Monat auseinander · die zweite läuft sauber.
        for (id, ts, judgment) in [(1i64, 1_700_000_000i64, "blunder"), (2, 1_702_600_000, "")] {
            conn.execute(
                "INSERT INTO games (id, source, source_id, played_ts, time_class, color, result,
                                    opening, moves_count, accuracy, moves, analyzed, my_elo)
                 VALUES (?1,'lichess',?2,?3,'blitz','white','win','Italian Game',4,70.0,
                         'e4 e5 Nf3 Nc6', 1, 1500)",
                rusqlite::params![id, format!("g{id}"), ts],
            )
            .unwrap();
            for ply in 1..=4i64 {
                conn.execute(
                    "INSERT INTO move_evals (game_id, ply, san, eval_cp, judgment, phase)
                     VALUES (?1, ?2, 'e4', 10, ?3, 'middlegame')",
                    rusqlite::params![id, ply, if ply == 1 { judgment } else { "" }],
                )
                .unwrap();
            }
        }

        let windows = metrics_from_conn(
            &conn,
            &[
                WindowSpec {
                    from_ts: 1_699_000_000,
                    to_ts: 1_701_000_000,
                },
                WindowSpec {
                    from_ts: 1_701_000_000,
                    to_ts: 1_703_000_000,
                },
            ],
        )
        .unwrap();

        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].games, 1);
        assert_eq!(windows[1].games, 1);
        let blunders = |window: &MetricWindow| {
            window
                .metrics
                .iter()
                .find(|m| m.key == "blunders_middlegame_per100")
                .unwrap()
                .value
        };
        // Zwei eigene Züge je Partie, im ersten Fenster einer davon ein Patzer.
        assert_eq!(blunders(&windows[0]), Some(50.0));
        assert_eq!(blunders(&windows[1]), Some(0.0));

        // Ratings reisen nach Pool getrennt · erst das Frontend rechnet sie um.
        assert_eq!(windows[0].ratings.len(), 1);
        assert_eq!(windows[0].ratings[0].time_class, "blitz");
        assert_eq!(windows[0].ratings[0].games, 1);
    }

    #[test]
    fn metric_windows_are_bounded() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        assert!(metrics_from_conn(&conn, &[]).unwrap().is_empty());
        let too_many: Vec<WindowSpec> = (0..MAX_WINDOWS + 1)
            .map(|index| WindowSpec {
                from_ts: index as i64,
                to_ts: index as i64 + 1,
            })
            .collect();
        assert!(metrics_from_conn(&conn, &too_many).is_err());
    }

    #[test]
    fn sessions_split_on_long_breaks() {
        const BASE: i64 = 1_700_000_000;
        let games: Vec<RawGame> = [BASE, BASE + 300, BASE + 600, BASE + 100_000, BASE + 100_300]
            .iter()
            .enumerate()
            .map(|(i, ts)| RawGame {
                id: i as i64,
                played_ts: *ts,
                source: "lichess".into(),
                time_class: "blitz".into(),
                color: "white".into(),
                result: "win".into(),
                moves: String::new(),
                clocks: String::new(),
                time_control: String::new(),
                my_elo: 1500,
                opp_elo: 1500,
                accuracy: None,
                opening: String::new(),
            })
            .collect();
        let empty: Vec<Ev> = Vec::new();
        let views: Vec<GameView> = games
            .iter()
            .map(|raw| GameView {
                raw,
                evals: &empty,
                wp: Vec::new(),
                clocks: None,
                book_departure: None,
                book_plies: 0,
            })
            .collect();
        let bounds = session_bounds(&views);
        assert_eq!(
            bounds,
            vec![(1, 1), (1, 2), (1, 3), (2, 1), (2, 2)],
            "nach 100.000 s Pause beginnt eine neue Sitzung"
        );
    }
}
