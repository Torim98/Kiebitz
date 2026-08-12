// ── Hauptberechnung ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deep_insights(app: tauri::AppHandle) -> Result<DeepInsights, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The calculation can scan many games and evaluations. A dedicated
        // read-only WAL connection keeps that work off the global command
        // mutex while still giving the whole calculation one stable snapshot.
        let path = app
            .state::<analysis::DbPath>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = compute(&conn);
        if result.is_ok() {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        } else {
            let _ = conn.execute_batch("ROLLBACK");
        }
        result
    })
    .await
    .map_err(|e| format!("Tiefenanalyse fehlgeschlagen: {e}"))?
}

fn compute(conn: &Connection) -> Result<DeepInsights, String> {
    let games = load_games(conn)?;
    let evals = load_evals(conn)?;
    let puzzle_days = load_puzzle_days(conn)?;
    let nodes = repertoire::load_nodes(conn).unwrap_or_default();
    let children = repertoire::book_children(&nodes);

    // Reihenfolge aufsteigend · Sessions, Trends und Fortschritt brauchen sie.
    let mut asc: Vec<&RawGame> = games.iter().collect();
    asc.sort_by_key(|g| (g.played_ts, g.id));

    let empty: Vec<Ev> = Vec::new();
    let mut views: Vec<GameView> = Vec::with_capacity(asc.len());
    for game in &asc {
        let rows = evals.get(&game.id).unwrap_or(&empty);
        let mut wp = Vec::with_capacity(rows.len());
        for ev in rows {
            wp.push(win_prob(ev.eval_cp, ev.mate_in));
        }
        let (book_departure, book_plies) = book_progress(&nodes, &children, game);
        views.push(GameView {
            raw: game,
            evals: rows,
            wp,
            clocks: clocks_of(game),
            book_departure,
            book_plies,
        });
    }

    let coverage = Coverage {
        games: views.len() as i64,
        analyzed: views.iter().filter(|v| !v.evals.is_empty()).count() as i64,
        with_clocks: views.iter().filter(|v| v.clocks.is_some()).count() as i64,
        moves_judged: views.iter().map(|v| v.evals.len() as i64).sum(),
        first_ts: asc.first().map(|g| g.played_ts).unwrap_or(0),
        last_ts: asc.last().map(|g| g.played_ts).unwrap_or(0),
    };

    let sessions = session_bounds(&views);

    Ok(DeepInsights {
        time: time_insights(&views, &sessions),
        content: content_insights(&views),
        benchmark: benchmark_insights(&views),
        sessions: session_insights(&views, &sessions, &puzzle_days),
        progress: progress_insights(conn, &views, &nodes, &children)?,
        repertoire: repertoire_insights(&views, &nodes, &children),
        formats: format_insights(&views),
        openings: opening_insights(&views),
        spotlight: spotlight(&views),
        coverage,
    })
}

/// Prüftiefe für den Buchabgleich · 20 Halbzüge sind zehn Züge und decken das
/// ab, was ein Amateurrepertoire realistisch enthält.
const BOOK_PLIES: usize = 20;

/// Liefert getrennt die fachliche Abweichung und die tatsächlich passende
/// Präfixlänge. `None` bei der Abweichung kann nämlich sowohl "bis zum Ende im
/// Buch" als auch "gespeicherte Linie ist hier zu Ende" heißen; nur die Länge
/// ist für die Kennzahl "bekannte Züge" eindeutig.
fn book_progress(
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
    game: &RawGame,
) -> (Option<(i64, bool)>, i64) {
    if nodes.is_empty() {
        return (None, 0);
    }
    let walk = repertoire::walk_book(children, &game.color, &game.moves, BOOK_PLIES);
    let book_plies = match &walk {
        Some(departure) => departure.ply - 1,
        None => game.moves.split_whitespace().take(BOOK_PLIES).count() as i64,
    };
    let departure = match walk {
        Some(departure) if departure.book_has_moves => {
            Some((departure.ply, game.mine(departure.ply)))
        }
        // Ende einer angelegten Linie ist keine Abweichung, aber auch kein
        // Freibrief, alle weiteren Eröffnungszüge als bekannt zu zählen.
        _ => None,
    };
    (departure, book_plies)
}

fn load_games(conn: &Connection) -> Result<Vec<RawGame>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, played_ts, source, time_class, color, result, moves, clocks,
                    time_control, my_elo, opp_elo, accuracy, opening
             FROM games
             WHERE analysis_excluded = 0 AND moves != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RawGame {
                id: r.get(0)?,
                played_ts: r.get(1)?,
                source: r.get(2)?,
                time_class: r.get(3)?,
                color: r.get(4)?,
                result: r.get(5)?,
                moves: r.get(6)?,
                clocks: r.get(7)?,
                time_control: r.get(8)?,
                my_elo: r.get(9)?,
                opp_elo: r.get(10)?,
                accuracy: r.get(11)?,
                opening: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_evals(conn: &Connection) -> Result<HashMap<i64, Vec<Ev>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.game_id, e.ply, e.san, e.eval_cp, e.mate_in, e.best_uci, e.judgment, e.phase
             FROM move_evals e
             JOIN games g ON g.id = e.game_id
             WHERE g.analysis_excluded = 0
             ORDER BY e.game_id, e.ply",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Ev {
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
        .map_err(|e| e.to_string())?;

    let mut out: HashMap<i64, Vec<Ev>> = HashMap::new();
    for row in rows {
        let (game_id, ev) = row.map_err(|e| e.to_string())?;
        let list = out.entry(game_id).or_default();
        // Lücken in der Halbzugfolge dürfen die Indizierung nicht verschieben ·
        // `wp` und `evals` werden über den Index angesprochen.
        while list.len() as i64 + 1 < ev.ply {
            let ply = list.len() as i64 + 1;
            list.push(Ev {
                ply,
                san: String::new(),
                eval_cp: None,
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: String::new(),
            });
        }
        list.push(ev);
    }
    Ok(out)
}

/// UTC-Tag → Puzzleversuche, für den Aufwärm-Effekt.
fn load_puzzle_days(conn: &Connection) -> Result<HashMap<i64, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT ts FROM puzzle_attempts")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    let mut out: HashMap<i64, i64> = HashMap::new();
    for ts in rows {
        let ts = ts.map_err(|e| e.to_string())?;
        *out.entry(ts.div_euclid(86_400)).or_insert(0) += 1;
    }
    Ok(out)
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/// Sitzungsgrenze: mehr als eine Stunde Pause beginnt eine neue Sitzung.
const SESSION_GAP: i64 = 3_600;

/// Für jede Partie (Index in `views`): Sitzungsnummer und Position darin.
fn session_bounds(views: &[GameView]) -> Vec<(usize, i64)> {
    let mut out = Vec::with_capacity(views.len());
    let mut session = 0usize;
    let mut index = 0i64;
    let mut previous_ts = i64::MIN;
    for view in views {
        let ts = view.raw.played_ts;
        if ts <= 0 {
            // `played_ts = 0` heißt „Zeitpunkt unbekannt" (PGN-Importe ohne
            // Datum). Solche Partien hängen an der laufenden Sitzung, ohne eine
            // neue zu beginnen · sonst zerfiele jeder Import in Einzelsitzungen.
            if session == 0 {
                session = 1;
                index = 1;
            }
            out.push((session, index.max(1)));
            continue;
        }
        if previous_ts == i64::MIN || ts - previous_ts > SESSION_GAP {
            session += 1;
            index = 1;
        } else {
            index += 1;
        }
        previous_ts = ts;
        out.push((session, index));
    }
    out
}
