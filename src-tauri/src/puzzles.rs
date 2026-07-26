//! Puzzle-Training: importiert den Lichess-Puzzle-Dump (CC0) in die lokale
//! Datenbank, wählt Aufgaben nahe am persönlichen Rating und führt ein
//! Elo-basiertes Puzzle-Rating über alle Versuche.

use crate::db;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

pub struct PuzzleImportState(pub AtomicBool);

impl Default for PuzzleImportState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

const DUMP_URL: &str = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const DEFAULT_RATING: i64 = 1500;
const ELO_K: f64 = 24.0;

pub(crate) struct OwnPuzzleCandidate {
    pub ply: u32,
    pub fen: String,
    pub best_uci: String,
    pub phase: String,
    pub judgment: String,
}

/// Ersetzt die automatisch erzeugten Aufgaben einer Partie. Eine eigene
/// Aufgabe beginnt direkt vor dem verpassten Zug; deshalb gibt es keinen
/// automatisch abgespielten Setup-Zug (`setup_plies = 0`).
pub(crate) fn replace_own_game_puzzles(
    conn: &Connection,
    game_id: i64,
    player_rating: i64,
    candidates: &[OwnPuzzleCandidate],
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM puzzles WHERE source = 'own' AND source_game_id = ?1",
        params![game_id],
    )
    .map_err(|e| e.to_string())?;
    let mut inserted = 0usize;
    for candidate in candidates {
        if candidate.best_uci.len() < 4 {
            continue;
        }
        let rating = (player_rating
            + if candidate.judgment == "blunder" {
                50
            } else {
                -50
            })
        .clamp(600, 2800);
        let id = format!("own:{game_id}:{}", candidate.ply);
        let themes = format!("ownGame {} {} oneMove", candidate.phase, candidate.judgment);
        conn.execute(
            "INSERT OR REPLACE INTO puzzles
             (id, fen, moves, rating, themes, opening_tags, source,
              source_game_id, source_ply, setup_plies)
             VALUES (?1, ?2, ?3, ?4, ?5, '', 'own', ?6, ?7, 0)",
            params![
                id,
                candidate.fen,
                candidate.best_uci,
                rating,
                themes,
                game_id,
                candidate.ply
            ],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }
    Ok(inserted)
}

fn backfill_own_puzzles(conn: &Connection) -> Result<(), String> {
    if db::meta_get(conn, "own_puzzles_backfilled_v1").is_some() {
        return Ok(());
    }
    let games: Vec<(i64, String, String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, moves, color, my_elo FROM games
                 WHERE analyzed = 1 AND analysis_excluded = 0 AND moves != ''
                   AND EXISTS (SELECT 1 FROM move_evals WHERE game_id = games.id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for (game_id, moves, color, rating) in games {
        let walked = crate::chess::walk_sans(&moves);
        let my_white = color == "white";
        let rows: Vec<(u32, String, String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT ply, best_uci, phase, judgment FROM move_evals
                     WHERE game_id = ?1 AND judgment IN ('mistake', 'blunder')",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![game_id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        let candidates: Vec<OwnPuzzleCandidate> = rows
            .into_iter()
            .filter_map(|(ply, best_uci, phase, judgment)| {
                let walked_move = walked.get(ply.saturating_sub(1) as usize)?;
                if walked_move.by_white != my_white {
                    return None;
                }
                Some(OwnPuzzleCandidate {
                    ply,
                    fen: walked_move.fen_before.clone(),
                    best_uci,
                    phase,
                    judgment,
                })
            })
            .collect();
        replace_own_game_puzzles(
            conn,
            game_id,
            if rating > 0 { rating } else { DEFAULT_RATING },
            &candidates,
        )?;
    }
    db::meta_set(conn, "own_puzzles_backfilled_v1", "1")
}

// ── Import ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ImportProgress {
    imported: u64,
    /// "download" oder "file"
    source: String,
}

#[derive(Serialize, Clone)]
struct ImportDone {
    imported: u64,
    total: i64,
    error: Option<String>,
}

/// Importiert den Lichess-Puzzle-Dump. Mit `path` aus einer lokalen Datei
/// (.csv oder .csv.zst), ohne `path` als Direkt-Download (~250 MB).
#[tauri::command]
pub fn import_puzzles(
    app: tauri::AppHandle,
    state: State<PuzzleImportState>,
    path: Option<String>,
) -> Result<(), String> {
    if state.0.swap(true, Ordering::SeqCst) {
        return Err("Ein Puzzle-Import läuft bereits.".into());
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_import(&app2, path);
        let st = app2.state::<PuzzleImportState>();
        st.0.store(false, Ordering::SeqCst);
        let (imported, total, error) = match result {
            Ok((n, total)) => (n, total, None),
            Err(e) => (0, 0, Some(e)),
        };
        let _ = app2.emit(
            "puzzles://done",
            ImportDone {
                imported,
                total,
                error,
            },
        );
    });
    Ok(())
}

fn run_import(app: &tauri::AppHandle, path: Option<String>) -> Result<(u64, i64), String> {
    let db_path = app
        .state::<crate::analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let mut conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "busy_timeout", "10000");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");

    let (reader, source): (Box<dyn Read>, &str) = match &path {
        Some(p) => {
            let file =
                std::fs::File::open(p).map_err(|e| format!("Datei nicht lesbar ({p}): {e}"))?;
            if p.to_lowercase().ends_with(".zst") {
                (
                    Box::new(zstd::stream::read::Decoder::new(file).map_err(|e| e.to_string())?),
                    "file",
                )
            } else {
                (Box::new(file), "file")
            }
        }
        None => {
            let resp = ureq::get(DUMP_URL)
                .timeout(std::time::Duration::from_secs(3600))
                .call()
                .map_err(|e| format!("Download fehlgeschlagen: {e}"))?;
            (
                Box::new(
                    zstd::stream::read::Decoder::new(resp.into_reader())
                        .map_err(|e| e.to_string())?,
                ),
                "download",
            )
        }
    };

    let mut csv = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);
    let mut imported = 0u64;
    let mut batch = 0u32;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO puzzles
                    (id, fen, moves, rating, rd, popularity, nb_plays, themes, opening_tags,
                     source, setup_plies)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'lichess', 1)",
            )
            .map_err(|e| e.to_string())?;
        for record in csv.records() {
            let r = record.map_err(|e| format!("CSV-Fehler: {e}"))?;
            // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
            if r.len() < 8 {
                continue;
            }
            let rating: i64 = r.get(3).and_then(|v| v.parse().ok()).unwrap_or(0);
            if rating == 0 {
                continue;
            }
            stmt.execute(params![
                r.get(0).unwrap_or(""),
                r.get(1).unwrap_or(""),
                r.get(2).unwrap_or(""),
                rating,
                r.get(4).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                r.get(5).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                r.get(6).and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                r.get(7).unwrap_or(""),
                r.get(9).unwrap_or(""),
            ])
            .map_err(|e| e.to_string())?;
            imported += 1;
            batch += 1;
            if batch >= 25_000 {
                batch = 0;
                let _ = app.emit(
                    "puzzles://progress",
                    ImportProgress {
                        imported,
                        source: source.to_string(),
                    },
                );
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = db::meta_set(&conn, "puzzle_imported_at", &now.to_string());

    let lichess_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'lichess'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    db::meta_set(&conn, "puzzle_lichess_total", &lichess_total.to_string())?;
    let own_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total = lichess_total + own_total;
    // Millionen frisch geschriebener Zeilen liegen sonst im WAL und bremsen
    // jede spätere Puzzle-Abfrage aus.
    db::checkpoint(&conn);
    Ok((imported, total))
}

// ── Trainer ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct PuzzleOut {
    pub id: String,
    pub fen: String,
    /// UCI-Züge; der erste ist der Gegnerzug, der die Aufgabe stellt.
    pub moves: Vec<String>,
    pub rating: i64,
    pub themes: Vec<String>,
    pub source: String,
    pub source_game_id: Option<i64>,
    /// Anzahl der automatisch gespielten Züge, bevor der Löser am Zug ist.
    pub setup_plies: i64,
}

fn personal_rating(conn: &Connection) -> i64 {
    db::meta_get(conn, "puzzle_rating")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RATING)
}

/// Nächstes Puzzle: nahe am persönlichen Rating (oder im gewünschten Band),
/// optional nach Motiv gefiltert; bereits gelöste werden gemieden.
#[tauri::command]
pub async fn next_puzzle(
    app: tauri::AppHandle,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
) -> Result<Option<PuzzleOut>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        next_puzzle_from_conn(&conn, theme, source, min_rating, max_rating)
    })
    .await
    .map_err(|e| format!("Puzzle-Auswahl fehlgeschlagen: {e}"))?
}

/// Nach dieser Zeit darf eine gelöste Aufgabe wieder drankommen — Taktik will
/// wiederholt werden, nur eben nicht am selben Tag.
pub const SOLVED_COOLDOWN_DAYS: i64 = 30;

fn next_puzzle_from_conn(
    conn: &Connection,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
) -> Result<Option<PuzzleOut>, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    next_puzzle_at(conn, theme, source, min_rating, max_rating, now)
}

fn next_puzzle_at(
    conn: &Connection,
    theme: Option<String>,
    source: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    now: i64,
) -> Result<Option<PuzzleOut>, String> {
    let me = personal_rating(conn);
    let (base_lo, base_hi) = match (min_rating, max_rating) {
        (Some(lo), Some(hi)) => (lo, hi),
        _ => (me - 75, me + 75),
    };

    let theme_filter = theme.filter(|t| !t.is_empty());
    let source_filter = source.filter(|s| s == "lichess" || s == "own");
    let theme_pattern = theme_filter.as_ref().map(|t| format!("% {t} %"));
    let cooldown = now - SOLVED_COOLDOWN_DAYS * 86_400;
    // Kürzlich gelöste Aufgaben überspringen; ältere dürfen zurückkommen.
    let filter = "FROM puzzles INDEXED BY idx_puzzles_rating
             WHERE rating BETWEEN ?1 AND ?2
               AND (?3 IS NULL OR source = ?3)
               AND (?4 IS NULL OR (' ' || themes || ' ') LIKE ?4)
               AND NOT EXISTS (
                 SELECT 1 FROM puzzle_attempts AS pa
                 WHERE pa.puzzle_id = puzzles.id AND pa.solved = 1 AND pa.ts >= ?5
               )";
    let columns = "SELECT id, fen, moves, rating, themes, source, source_game_id, setup_plies";
    // Ein zufälliges Zielrating und je ein Indexsprung nach oben und unten:
    // das ist auch bei Millionen Aufgaben konstant schnell, während COUNT(*)
    // plus OFFSET über das ganze Fenster laufen musste.
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(1);
    for widen in [0i64, 150, 400, 1200, 4000] {
        let lo = base_lo - widen;
        let hi = base_hi + widen;
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        let span = (hi - lo).max(1) as u64;
        let target = lo + (seed >> 33).rem_euclid(span) as i64;
        for (window_lo, window_hi, order) in [(target, hi, "ASC"), (lo, target, "DESC")] {
            let sql = format!("{columns} {filter} ORDER BY rating {order} LIMIT 1");
            let row = conn.query_row(
                &sql,
                params![
                    window_lo,
                    window_hi,
                    source_filter.as_deref(),
                    theme_pattern.as_deref(),
                    cooldown
                ],
                map_puzzle,
            );
            match row {
                Ok(p) => return Ok(Some(p)),
                Err(rusqlite::Error::QueryReturnedNoRows) => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(None)
}

fn map_puzzle(r: &rusqlite::Row) -> rusqlite::Result<PuzzleOut> {
    let moves: String = r.get(2)?;
    let themes: String = r.get(4)?;
    Ok(PuzzleOut {
        id: r.get(0)?,
        fen: r.get(1)?,
        moves: moves.split_whitespace().map(String::from).collect(),
        rating: r.get(3)?,
        themes: themes.split_whitespace().map(String::from).collect(),
        source: r.get(5)?,
        source_game_id: r.get(6)?,
        setup_plies: r.get(7)?,
    })
}

#[derive(Serialize)]
pub struct AttemptResult {
    pub rating_before: i64,
    pub rating_after: i64,
    pub delta: i64,
}

/// Verbucht einen Versuch (gelöst/gescheitert am ersten Anlauf) und
/// aktualisiert das persönliche Rating nach Elo.
#[tauri::command]
pub fn record_attempt(
    db: State<db::Db>,
    puzzle_id: String,
    solved: bool,
) -> Result<AttemptResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    record_attempt_at(&conn, &puzzle_id, solved, now)
}

fn elo_after(before: i64, puzzle_rating: i64, solved: bool) -> i64 {
    let expected = 1.0 / (1.0 + 10f64.powf((puzzle_rating - before) as f64 / 400.0));
    let score = if solved { 1.0 } else { 0.0 };
    (before as f64 + ELO_K * (score - expected)).round() as i64
}

fn record_attempt_at(
    conn: &Connection,
    puzzle_id: &str,
    solved: bool,
    now: i64,
) -> Result<AttemptResult, String> {
    let (puzzle_rating, themes): (i64, String) = conn
        .query_row(
            "SELECT rating, themes FROM puzzles WHERE id = ?1",
            params![puzzle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Puzzle nicht gefunden".to_string())?;

    let before = personal_rating(conn);
    let after = elo_after(before, puzzle_rating, solved);
    conn.execute(
        "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![puzzle_id, now, solved, before, after, themes, puzzle_rating],
    )
    .map_err(|e| e.to_string())?;
    db::meta_set(conn, "puzzle_rating", &after.to_string())?;

    Ok(AttemptResult {
        rating_before: before,
        rating_after: after,
        delta: after - before,
    })
}

// ── Statistik ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct ThemeStat {
    pub theme: String,
    pub attempts: i64,
    pub solved: i64,
}

#[derive(Serialize)]
pub struct PuzzleStats {
    pub personal_rating: i64,
    pub db_total: i64,
    pub lichess_total: i64,
    pub own_total: i64,
    pub attempts: i64,
    pub solved: i64,
    pub today_solved: i64,
    /// Alle heutigen Versuche (gelöst oder nicht) — fürs Tagesziel im Dashboard.
    pub today_attempts: i64,
    pub streak_days: i64,
    pub history: Vec<i64>,
    pub themes: Vec<ThemeStat>,
    pub importing: bool,
    /// Unix-Sekunden des letzten Dump-Imports (None = nie importiert).
    pub imported_at: Option<i64>,
}

#[tauri::command]
pub async fn puzzle_stats(app: tauri::AppHandle) -> Result<PuzzleStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let importing = app.state::<PuzzleImportState>().0.load(Ordering::SeqCst);
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        puzzle_stats_from_conn(&conn, importing)
    })
    .await
    .map_err(|e| format!("Puzzle-Statistik fehlgeschlagen: {e}"))?
}

fn puzzle_stats_from_conn(conn: &Connection, importing: bool) -> Result<PuzzleStats, String> {
    backfill_own_puzzles(&conn)?;
    let imported_at = db::meta_get(conn, "puzzle_imported_at").and_then(|v| v.parse().ok());
    let cached_lichess_total =
        db::meta_get(conn, "puzzle_lichess_total").and_then(|value| value.parse::<i64>().ok());
    let lichess_total = match cached_lichess_total {
        Some(total) => total,
        None => {
            let total: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM puzzles WHERE source = 'lichess'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            // Imported databases are static between explicit dump imports, so
            // this millions-row count only needs to run once after upgrading.
            if imported_at.is_some() {
                db::meta_set(conn, "puzzle_lichess_total", &total.to_string())?;
            }
            total
        }
    };
    let own_total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let db_total = lichess_total + own_total;
    let (attempts, solved): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(solved), 0) FROM puzzle_attempts",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Lokale Tagesgrenzen sind hier nicht kritisch — UTC-Tage genügen.
    let day_start = now - now.rem_euclid(86_400);
    let today_solved: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzle_attempts WHERE solved = 1 AND ts >= ?1",
            params![day_start],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let today_attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1",
            params![day_start],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Serie: aufeinanderfolgende Tage (rückwärts ab heute) mit ≥ 1 gelöstem Puzzle.
    let days: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT ts / 86400 FROM puzzle_attempts WHERE solved = 1 ORDER BY 1 DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let today = now / 86_400;
    let streak = solved_streak(&days, today);

    let history: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rating_after FROM puzzle_attempts ORDER BY id DESC LIMIT 30")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut v: Vec<i64> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        v.reverse();
        v
    };

    // Motiv-Statistik aus den Versuchen.
    let mut theme_map: std::collections::HashMap<String, (i64, i64)> =
        std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT themes, solved FROM puzzle_attempts")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (themes, ok) = row.map_err(|e| e.to_string())?;
            for t in themes.split_whitespace() {
                let e = theme_map.entry(t.to_string()).or_insert((0, 0));
                e.0 += 1;
                e.1 += ok;
            }
        }
    }
    let mut themes: Vec<ThemeStat> = theme_map
        .into_iter()
        .map(|(theme, (attempts, solved))| ThemeStat {
            theme,
            attempts,
            solved,
        })
        .collect();
    themes.sort_by(|a, b| b.attempts.cmp(&a.attempts));
    themes.truncate(10);

    Ok(PuzzleStats {
        personal_rating: personal_rating(&conn),
        db_total,
        lichess_total,
        own_total,
        attempts,
        solved,
        today_solved,
        today_attempts,
        streak_days: streak,
        history,
        themes,
        importing,
        imported_at,
    })
}

// ── Verlauf ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
pub struct AttemptRow {
    pub puzzle_id: String,
    pub ts: i64,
    pub solved: bool,
    pub rating_before: i64,
    pub rating_after: i64,
    pub puzzle_rating: i64,
    pub themes: Vec<String>,
    /// FEN der Aufgabe, sofern sie noch in der Datenbank liegt.
    pub fen: Option<String>,
}

/// Die letzten Versuche, neueste zuerst.
#[tauri::command]
pub async fn puzzle_history(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<AttemptRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        puzzle_history_from_conn(&conn, limit.unwrap_or(25).clamp(1, 200))
    })
    .await
    .map_err(|e| format!("Puzzle-Verlauf fehlgeschlagen: {e}"))?
}

fn puzzle_history_from_conn(conn: &Connection, limit: i64) -> Result<Vec<AttemptRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT a.puzzle_id, a.ts, a.solved, a.rating_before, a.rating_after,
                    a.puzzle_rating, a.themes, p.fen
             FROM puzzle_attempts AS a
             LEFT JOIN puzzles AS p ON p.id = a.puzzle_id
             ORDER BY a.ts DESC, a.id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            let themes: String = r.get(6)?;
            Ok(AttemptRow {
                puzzle_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                rating_before: r.get(3)?,
                rating_after: r.get(4)?,
                puzzle_rating: r.get(5)?,
                themes: themes.split_whitespace().map(String::from).collect(),
                fen: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ── Detailanalyse (Insights-Unterreiter) ─────────────────────────────────────

#[derive(Serialize, Debug, PartialEq)]
pub struct BucketStat {
    /// Untergrenze des Ratingfensters bzw. Index (Wochentag 0 = Montag, Stunde).
    pub key: i64,
    pub attempts: i64,
    pub solved: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DayPoint {
    /// Unix-Sekunden des UTC-Tagesbeginns.
    pub day_ts: i64,
    pub attempts: i64,
    pub solved: i64,
    /// Persönliches Rating am Ende dieses Tages.
    pub rating: i64,
}

#[derive(Serialize)]
pub struct PuzzleInsights {
    pub personal_rating: i64,
    pub attempts: i64,
    pub solved: i64,
    /// Ø Rating der versuchten Aufgaben; 0 ohne Versuche.
    pub avg_puzzle_rating: i64,
    /// Ø Rating der gelösten Aufgaben — die tatsächlich geknackte Härte.
    pub avg_solved_rating: i64,
    /// Längste Serie gelöster Aufgaben in Folge.
    pub best_run: i64,
    /// Aktuelle Serie gelöster Aufgaben (0 nach einem Fehlversuch).
    pub current_run: i64,
    /// Alle Motive mit mindestens einem Versuch, absteigend nach Versuchen.
    pub themes: Vec<ThemeStat>,
    /// Trefferquote nach Aufgabenschwierigkeit (400er-Fenster).
    pub by_rating: Vec<BucketStat>,
    /// Trefferquote nach Wochentag (0 = Montag) und Tagesstunde (UTC).
    pub by_weekday: Vec<BucketStat>,
    pub by_hour: Vec<BucketStat>,
    /// Tagesverlauf der letzten Wochen (aufsteigend).
    pub timeline: Vec<DayPoint>,
}

#[tauri::command]
pub async fn puzzle_insights(
    app: tauri::AppHandle,
    days: Option<i64>,
) -> Result<PuzzleInsights, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        puzzle_insights_from_conn(&conn, now, days.unwrap_or(30).clamp(7, 365))
    })
    .await
    .map_err(|e| format!("Puzzle-Analyse fehlgeschlagen: {e}"))?
}

fn puzzle_insights_from_conn(
    conn: &Connection,
    now: i64,
    window_days: i64,
) -> Result<PuzzleInsights, String> {
    // Ein Durchlauf über alle Versuche — die Tabelle bleibt auch nach Jahren
    // klein genug, und so bleiben alle Auswertungen konsistent zueinander.
    struct Attempt {
        ts: i64,
        solved: bool,
        rating_after: i64,
        puzzle_rating: i64,
        themes: String,
    }
    let attempts: Vec<Attempt> = {
        let mut stmt = conn
            .prepare(
                "SELECT ts, solved, rating_after, puzzle_rating, themes
                 FROM puzzle_attempts ORDER BY ts, id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Attempt {
                    ts: r.get(0)?,
                    solved: r.get::<_, i64>(1)? != 0,
                    rating_after: r.get(2)?,
                    puzzle_rating: r.get(3)?,
                    themes: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let solved = attempts.iter().filter(|a| a.solved).count() as i64;
    let rated: Vec<&Attempt> = attempts.iter().filter(|a| a.puzzle_rating > 0).collect();
    let avg = |values: &[i64]| -> i64 {
        if values.is_empty() {
            0
        } else {
            values.iter().sum::<i64>() / values.len() as i64
        }
    };
    let avg_puzzle_rating = avg(&rated.iter().map(|a| a.puzzle_rating).collect::<Vec<_>>());
    let avg_solved_rating = avg(&rated
        .iter()
        .filter(|a| a.solved)
        .map(|a| a.puzzle_rating)
        .collect::<Vec<_>>());

    let (mut best_run, mut current_run) = (0i64, 0i64);
    for attempt in &attempts {
        current_run = if attempt.solved { current_run + 1 } else { 0 };
        best_run = best_run.max(current_run);
    }

    let mut theme_map: std::collections::HashMap<&str, (i64, i64)> =
        std::collections::HashMap::new();
    let mut rating_map: std::collections::BTreeMap<i64, (i64, i64)> =
        std::collections::BTreeMap::new();
    let mut weekday = [(0i64, 0i64); 7];
    let mut hour = [(0i64, 0i64); 24];
    for attempt in &attempts {
        let ok = i64::from(attempt.solved);
        for theme in attempt.themes.split_whitespace() {
            let entry = theme_map.entry(theme).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += ok;
        }
        if attempt.puzzle_rating > 0 {
            let bucket = (attempt.puzzle_rating / 400) * 400;
            let entry = rating_map.entry(bucket).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += ok;
        }
        // 1970-01-01 war ein Donnerstag → Index 3 in einer Montagswoche.
        let index = ((attempt.ts.div_euclid(86_400) + 3).rem_euclid(7)) as usize;
        weekday[index].0 += 1;
        weekday[index].1 += ok;
        let slot = (attempt.ts.rem_euclid(86_400) / 3_600) as usize;
        hour[slot].0 += 1;
        hour[slot].1 += ok;
    }

    let mut themes: Vec<ThemeStat> = theme_map
        .into_iter()
        .map(|(theme, (attempts, solved))| ThemeStat {
            theme: theme.to_string(),
            attempts,
            solved,
        })
        .collect();
    themes.sort_by(|a, b| b.attempts.cmp(&a.attempts).then(a.theme.cmp(&b.theme)));

    let bucket_list = |entries: Vec<(i64, (i64, i64))>| -> Vec<BucketStat> {
        entries
            .into_iter()
            .map(|(key, (attempts, solved))| BucketStat {
                key,
                attempts,
                solved,
            })
            .collect()
    };

    // Tagesverlauf: letzte `window_days` Tage, Rating vom letzten Versuch des Tages.
    let today = now.div_euclid(86_400);
    let first_day = today - window_days + 1;
    let mut timeline: Vec<DayPoint> = (0..window_days)
        .map(|offset| DayPoint {
            day_ts: (first_day + offset) * 86_400,
            attempts: 0,
            solved: 0,
            rating: 0,
        })
        .collect();
    let mut rating_before_window = personal_rating(conn);
    for attempt in &attempts {
        let day = attempt.ts.div_euclid(86_400);
        if day < first_day {
            rating_before_window = attempt.rating_after;
            continue;
        }
        let Some(point) = timeline.get_mut((day - first_day) as usize) else {
            continue;
        };
        point.attempts += 1;
        point.solved += i64::from(attempt.solved);
        point.rating = attempt.rating_after;
    }
    // Tage ohne Versuch übernehmen das Rating des Vortags.
    let mut carried = if attempts.is_empty() {
        personal_rating(conn)
    } else {
        rating_before_window
    };
    for point in timeline.iter_mut() {
        if point.rating == 0 {
            point.rating = carried;
        } else {
            carried = point.rating;
        }
    }

    Ok(PuzzleInsights {
        personal_rating: personal_rating(conn),
        attempts: attempts.len() as i64,
        solved,
        avg_puzzle_rating,
        avg_solved_rating,
        best_run,
        current_run,
        themes,
        by_rating: bucket_list(rating_map.into_iter().collect()),
        by_weekday: bucket_list(
            weekday
                .iter()
                .enumerate()
                .map(|(i, v)| (i as i64, *v))
                .collect(),
        ),
        by_hour: bucket_list(
            hour.iter()
                .enumerate()
                .map(|(i, v)| (i as i64, *v))
                .collect(),
        ),
        timeline,
    })
}

fn solved_streak(days: &[i64], today: i64) -> i64 {
    let mut streak = 0i64;
    let mut expect = today;
    for &day in days {
        if day == expect {
            streak += 1;
            expect -= 1;
        } else if day == expect - 1 && streak == 0 {
            // Nothing solved today: a still-active streak may start yesterday.
            streak = 1;
            expect = day - 1;
        } else {
            break;
        }
    }
    streak
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn puzzle(conn: &Connection, id: &str, rating: i64, themes: &str) {
        conn.execute(
            "INSERT INTO puzzles (id, fen, moves, rating, themes)
             VALUES (?1, '8/8/8/8/8/8/8/K6k w - - 0 1', 'a1a2 h1h2', ?2, ?3)",
            params![id, rating, themes],
        )
        .unwrap();
    }

    #[test]
    fn elo_moves_in_the_expected_direction() {
        assert_eq!(elo_after(1500, 1500, true), 1512);
        assert_eq!(elo_after(1500, 1500, false), 1488);
        assert!(elo_after(1500, 1800, true) > 1512);
        assert!(elo_after(1500, 1200, false) < 1488);
    }

    #[test]
    fn records_attempt_and_persists_new_personal_rating() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");

        let result = record_attempt_at(&conn, "fork-1", true, 1234).unwrap();
        assert_eq!(result.rating_before, 1500);
        assert_eq!(result.rating_after, 1512);
        assert_eq!(result.delta, 12);
        assert_eq!(personal_rating(&conn), 1512);

        let stored: (i64, i64, String) = conn
            .query_row(
                "SELECT ts, solved, themes FROM puzzle_attempts WHERE puzzle_id = 'fork-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored, (1234, 1, "fork short".into()));
    }

    #[test]
    fn selects_by_theme_and_skips_already_solved_puzzles() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1500, "pin short");

        let selected =
            next_puzzle_from_conn(&conn, Some("fork".into()), None, Some(1400), Some(1600))
                .unwrap()
                .unwrap();
        assert_eq!(selected.id, "fork-1");
        assert_eq!(selected.moves, vec!["a1a2", "h1h2"]);
        assert_eq!(selected.themes, vec!["fork", "short"]);

        // Gerade gelöst — innerhalb der Sperrfrist kommt nichts zurück.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        record_attempt_at(&conn, "fork-1", true, now).unwrap();
        assert!(
            next_puzzle_from_conn(&conn, Some("fork".into()), None, Some(1400), Some(1600),)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn solved_puzzles_return_after_the_cooldown() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        let solved_at = 1_800_000_000i64;
        record_attempt_at(&conn, "fork-1", true, solved_at).unwrap();

        let pick = |now: i64| {
            next_puzzle_at(&conn, None, None, Some(1400), Some(1600), now)
                .unwrap()
                .map(|p| p.id)
        };
        // Frisch gelöst: nicht noch einmal.
        assert_eq!(pick(solved_at + 86_400), None);
        assert_eq!(pick(solved_at + (SOLVED_COOLDOWN_DAYS - 1) * 86_400), None);
        // Nach der Sperrfrist darf dieselbe Aufgabe wiederkommen.
        assert_eq!(
            pick(solved_at + (SOLVED_COOLDOWN_DAYS + 1) * 86_400),
            Some("fork-1".to_string())
        );
    }

    #[test]
    fn selection_covers_the_whole_rating_window() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        for rating in [1200, 1300, 1400, 1500, 1600] {
            puzzle(&conn, &format!("p{rating}"), rating, "fork short");
        }
        // Über viele Ziehungen müssen mehrere Aufgaben vorkommen — sonst
        // liefert der Indexsprung immer dieselbe Kante.
        let mut seen = std::collections::HashSet::new();
        for i in 0..40 {
            if let Some(p) =
                next_puzzle_at(&conn, None, None, Some(1200), Some(1600), 1_800_000_000 + i)
                    .unwrap()
            {
                seen.insert(p.id);
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert!(seen.len() >= 3, "zu wenig Streuung: {seen:?}");
    }

    #[test]
    fn stats_cache_the_static_lichess_total_after_an_import() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1550, "pin short");
        db::meta_set(&conn, "puzzle_imported_at", "1234").unwrap();

        let stats = puzzle_stats_from_conn(&conn, false).unwrap();
        assert_eq!(stats.db_total, 2);
        assert_eq!(stats.lichess_total, 2);
        assert_eq!(
            db::meta_get(&conn, "puzzle_lichess_total"),
            Some("2".into())
        );
    }

    #[test]
    fn insights_aggregate_themes_ratings_and_timeline() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1200, "fork short");
        puzzle(&conn, "fork-2", 1600, "fork long");
        puzzle(&conn, "pin-1", 1600, "pin short");
        let today = 20_000i64;
        let now = today * 86_400 + 12 * 3_600;

        // Zwei gelöste Aufgaben gestern, ein Fehlversuch heute.
        record_attempt_at(&conn, "fork-1", true, (today - 1) * 86_400 + 3_600).unwrap();
        record_attempt_at(&conn, "fork-2", true, (today - 1) * 86_400 + 7_200).unwrap();
        record_attempt_at(&conn, "pin-1", false, today * 86_400 + 3_600).unwrap();

        let insights = puzzle_insights_from_conn(&conn, now, 30).unwrap();
        assert_eq!(insights.attempts, 3);
        assert_eq!(insights.solved, 2);
        assert_eq!(insights.best_run, 2);
        assert_eq!(insights.current_run, 0);
        assert_eq!(insights.avg_puzzle_rating, (1200 + 1600 + 1600) / 3);
        assert_eq!(insights.avg_solved_rating, (1200 + 1600) / 2);

        let fork = insights
            .themes
            .iter()
            .find(|theme| theme.theme == "fork")
            .unwrap();
        assert_eq!((fork.attempts, fork.solved), (2, 2));

        // Ratingfenster in 400er-Schritten: 1200 und 1600.
        assert_eq!(
            insights.by_rating,
            vec![
                BucketStat {
                    key: 1200,
                    attempts: 1,
                    solved: 1
                },
                BucketStat {
                    key: 1600,
                    attempts: 2,
                    solved: 1
                },
            ]
        );
        assert_eq!(insights.timeline.len(), 30);
        assert_eq!(insights.timeline[29].day_ts, today * 86_400);
        assert_eq!(insights.timeline[29].attempts, 1);
        assert_eq!(insights.timeline[28].solved, 2);
        // Tage ohne Versuch tragen das zuletzt bekannte Rating weiter.
        assert!(insights.timeline[0].rating > 0);
    }

    #[test]
    fn history_returns_newest_attempts_with_puzzle_data() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        puzzle(&conn, "fork-1", 1500, "fork short");
        puzzle(&conn, "pin-1", 1600, "pin short");
        record_attempt_at(&conn, "fork-1", true, 1_800_000_000).unwrap();
        record_attempt_at(&conn, "pin-1", false, 1_800_000_100).unwrap();

        let history = puzzle_history_from_conn(&conn, 25).unwrap();
        assert_eq!(history.len(), 2);
        // Neueste zuerst.
        assert_eq!(history[0].puzzle_id, "pin-1");
        assert!(!history[0].solved);
        assert_eq!(history[0].puzzle_rating, 1600);
        assert_eq!(history[1].themes, vec!["fork", "short"]);
        assert!(history[1].fen.is_some());
        assert_eq!(puzzle_history_from_conn(&conn, 1).unwrap().len(), 1);
    }

    #[test]
    fn solved_streak_handles_today_yesterday_and_gaps() {
        assert_eq!(solved_streak(&[10, 9, 8], 10), 3);
        assert_eq!(solved_streak(&[9, 8], 10), 2);
        assert_eq!(solved_streak(&[10, 8], 10), 1);
        assert_eq!(solved_streak(&[], 10), 0);
    }

    #[test]
    fn generates_and_replaces_puzzles_from_own_games() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let candidates = vec![OwnPuzzleCandidate {
            ply: 17,
            fen: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".into(),
            best_uci: "e1g1".into(),
            phase: "opening".into(),
            judgment: "blunder".into(),
        }];
        assert_eq!(
            replace_own_game_puzzles(&conn, 42, 1400, &candidates).unwrap(),
            1
        );

        let selected =
            next_puzzle_from_conn(&conn, None, Some("own".into()), Some(1000), Some(1800))
                .unwrap()
                .unwrap();
        assert_eq!(selected.id, "own:42:17");
        assert_eq!(selected.source, "own");
        assert_eq!(selected.source_game_id, Some(42));
        assert_eq!(selected.setup_plies, 0);
        assert_eq!(selected.moves, vec!["e1g1"]);

        replace_own_game_puzzles(&conn, 42, 1400, &[]).unwrap();
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
