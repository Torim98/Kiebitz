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
        let _ = app2.emit("puzzles://done", ImportDone { imported, total, error });
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
            let file = std::fs::File::open(p).map_err(|e| format!("Datei nicht lesbar ({p}): {e}"))?;
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

    let mut csv = csv::ReaderBuilder::new().has_headers(true).from_reader(reader);
    let mut imported = 0u64;
    let mut batch = 0u32;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR REPLACE INTO puzzles
                    (id, fen, moves, rating, rd, popularity, nb_plays, themes, opening_tags)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
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
}

fn personal_rating(conn: &Connection) -> i64 {
    db::meta_get(conn, "puzzle_rating")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_RATING)
}

/// Nächstes Puzzle: nahe am persönlichen Rating (oder im gewünschten Band),
/// optional nach Motiv gefiltert; bereits gelöste werden gemieden.
#[tauri::command]
pub fn next_puzzle(
    db: State<db::Db>,
    theme: Option<String>,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
) -> Result<Option<PuzzleOut>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let me = personal_rating(&conn);
    let (base_lo, base_hi) = match (min_rating, max_rating) {
        (Some(lo), Some(hi)) => (lo, hi),
        _ => (me - 75, me + 75),
    };

    let theme_filter = theme.filter(|t| !t.is_empty());
    // Fenster schrittweise weiten, bis etwas gefunden wird.
    for widen in [0i64, 150, 400, 1200, 4000] {
        let lo = base_lo - widen;
        let hi = base_hi + widen;
        let sql = format!(
            "SELECT id, fen, moves, rating, themes FROM puzzles
             WHERE rating BETWEEN ?1 AND ?2 {}
               AND id NOT IN (SELECT puzzle_id FROM puzzle_attempts WHERE solved = 1)
             ORDER BY RANDOM() LIMIT 1",
            if theme_filter.is_some() {
                "AND (' ' || themes || ' ') LIKE ?3"
            } else {
                ""
            }
        );
        let row = if let Some(t) = &theme_filter {
            conn.query_row(&sql, params![lo, hi, format!("% {t} %")], map_puzzle)
        } else {
            conn.query_row(&sql, params![lo, hi], map_puzzle)
        };
        match row {
            Ok(p) => return Ok(Some(p)),
            Err(rusqlite::Error::QueryReturnedNoRows) => continue,
            Err(e) => return Err(e.to_string()),
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
pub fn record_attempt(db: State<db::Db>, puzzle_id: String, solved: bool) -> Result<AttemptResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (puzzle_rating, themes): (i64, String) = conn
        .query_row(
            "SELECT rating, themes FROM puzzles WHERE id = ?1",
            params![puzzle_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Puzzle nicht gefunden".to_string())?;

    let before = personal_rating(&conn);
    let expected = 1.0 / (1.0 + 10f64.powf((puzzle_rating - before) as f64 / 400.0));
    let score = if solved { 1.0 } else { 0.0 };
    let after = (before as f64 + ELO_K * (score - expected)).round() as i64;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![puzzle_id, now, solved, before, after, themes],
    )
    .map_err(|e| e.to_string())?;
    db::meta_set(&conn, "puzzle_rating", &after.to_string())?;

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
pub fn puzzle_stats(
    db: State<db::Db>,
    import_state: State<PuzzleImportState>,
) -> Result<PuzzleStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let db_total: i64 = conn
        .query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
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
            .prepare("SELECT DISTINCT ts / 86400 FROM puzzle_attempts WHERE solved = 1 ORDER BY 1 DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let today = now / 86_400;
    let mut streak = 0i64;
    let mut expect = today;
    for d in days {
        if d == expect {
            streak += 1;
            expect -= 1;
        } else if d == expect - 1 && streak == 0 {
            // Heute noch nichts gelöst — Serie ab gestern zählen.
            streak = 1;
            expect = d - 1;
        } else {
            break;
        }
    }

    let history: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rating_after FROM puzzle_attempts ORDER BY id DESC LIMIT 30")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
        let mut v: Vec<i64> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        v.reverse();
        v
    };

    // Motiv-Statistik aus den Versuchen.
    let mut theme_map: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
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
        attempts,
        solved,
        today_solved,
        today_attempts,
        streak_days: streak,
        history,
        themes,
        importing: import_state.0.load(Ordering::SeqCst),
        imported_at: db::meta_get(&conn, "puzzle_imported_at").and_then(|v| v.parse().ok()),
    })
}
