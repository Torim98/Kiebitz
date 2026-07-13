mod analysis;
mod chess;
mod db;
mod engine;
mod live;
mod puzzles;
mod repertoire;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct AppInfo {
    version: String,
    backend: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        backend: "tauri".to_string(),
    }
}

#[derive(Serialize)]
struct EngineInfo {
    available: bool,
    name: String,
    path: String,
}

/// Sucht die gebündelte Stockfish-Engine. Im Dev-Modus liegt sie unter
/// `src-tauri/binaries/`, im Release neben den App-Ressourcen.
/// Eine Umgebungsvariable `KIEBITZ_ENGINE` hat Vorrang.
pub(crate) fn resolve_engine(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("KIEBITZ_ENGINE") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    let exe = if cfg!(windows) { "stockfish.exe" } else { "stockfish" };

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(exe);
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("binaries").join(exe);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
fn engine_info(app: tauri::AppHandle) -> EngineInfo {
    match resolve_engine(&app) {
        Some(path) => match engine::UciEngine::spawn(&path.to_string_lossy()) {
            Ok(uci) => EngineInfo {
                available: true,
                name: uci.name().to_string(),
                path: path.to_string_lossy().to_string(),
            },
            Err(err) => EngineInfo {
                available: false,
                name: err,
                path: path.to_string_lossy().to_string(),
            },
        },
        None => EngineInfo {
            available: false,
            name: "Keine Engine gefunden".to_string(),
            path: String::new(),
        },
    }
}

#[tauri::command]
fn list_games(db: tauri::State<db::Db>) -> Result<Vec<db::GameRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::list_games(&conn)
}

#[tauri::command]
fn upsert_games(
    db: tauri::State<db::Db>,
    games: Vec<db::GameRecord>,
) -> Result<db::UpsertResult, String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db::upsert_games(&mut conn, &games)
}

#[tauri::command]
fn set_game_note(db: tauri::State<db::Db>, id: i64, note: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_note(&conn, id, &note)
}

#[tauri::command]
fn db_stats(db: tauri::State<db::Db>) -> Result<db::DbStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::stats(&conn)
}

/// Einmalige Analyse: startet die Engine, analysiert die Stellung, beendet sie.
/// (Bleibt als Fallback; die Live-Analyse läuft über `analyze_live`.)
#[tauri::command]
fn analyze_position(
    app: tauri::AppHandle,
    fen: String,
    depth: u32,
) -> Result<engine::AnalysisResult, String> {
    let path = resolve_engine(&app).ok_or("Keine Engine gefunden")?;
    let mut uci = engine::UciEngine::spawn(&path.to_string_lossy())?;
    uci.analyze(&fen, depth.clamp(1, 40))
}

/// Dauer-Analyse über die persistente Engine: `info`-Zeilen kommen als
/// `engine://info`-Events. Liefert die Generation dieser Anfrage.
#[tauri::command]
fn analyze_live(
    app: tauri::AppHandle,
    state: tauri::State<live::LiveEngine>,
    fen: String,
    depth: Option<u32>,
) -> Result<u64, String> {
    let path = resolve_engine(&app).ok_or("Keine Engine gefunden")?;
    state.analyze(&app, &path.to_string_lossy(), &fen, depth.unwrap_or(24).clamp(6, 40))
}

#[tauri::command]
fn stop_live(state: tauri::State<live::LiveEngine>) {
    state.stop();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_file = data_dir.join("kiebitz.db");
            let conn = rusqlite::Connection::open(&db_file)?;
            db::init(&conn).map_err(std::io::Error::other)?;
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            app.manage(analysis::DbPath(db_file));
            app.manage(analysis::AnalysisState::default());
            app.manage(live::LiveEngine::default());
            app.manage(puzzles::PuzzleImportState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            engine_info,
            analyze_position,
            analyze_live,
            stop_live,
            list_games,
            upsert_games,
            set_game_note,
            db_stats,
            analysis::start_analysis,
            analysis::cancel_analysis,
            analysis::analysis_running,
            analysis::index_positions,
            analysis::game_analysis,
            analysis::error_stats,
            analysis::search_position,
            repertoire::rep_list,
            repertoire::rep_add_line,
            repertoire::rep_delete,
            repertoire::rep_due,
            repertoire::rep_review,
            repertoire::rep_stats,
            repertoire::rep_node_games,
            puzzles::import_puzzles,
            puzzles::next_puzzle,
            puzzles::record_attempt,
            puzzles::puzzle_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
