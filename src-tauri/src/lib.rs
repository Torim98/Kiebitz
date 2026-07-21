mod analysis;
mod chess;
mod chessdb;
mod db;
mod endgame;
mod engine;
mod live;
mod puzzles;
mod repertoire;
mod settings;
mod study;
mod sync;
mod updater;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
struct AppInfo {
    version: String,
    backend: String,
    /// Betriebssystem ("windows", "android", …) — steuert u. a. die Sync-UI.
    platform: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        // Version aus tauri.conf.json (das Feld, das beim Release erhöht wird),
        // nicht aus Cargo.toml — sonst driften Anzeige und Release auseinander.
        version: app.package_info().version.to_string(),
        backend: "tauri".to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[derive(Serialize)]
struct EngineInfo {
    available: bool,
    name: String,
    path: String,
}

/// Sucht die Engine: konfigurierter Pfad aus den Einstellungen zuerst,
/// dann `KIEBITZ_ENGINE`, dann die gebündelte Stockfish (Dev-Ordner
/// `src-tauri/binaries/` bzw. App-Ressourcen im Release).
pub(crate) fn resolve_engine(app: &tauri::AppHandle) -> Option<PathBuf> {
    let configured = app
        .state::<settings::SettingsState>()
        .0
        .lock()
        .ok()
        .and_then(|s| s.engine_path.clone());
    if let Some(custom) = configured {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(custom) = std::env::var("KIEBITZ_ENGINE") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }
    // Android: Stockfish liegt als libstockfish.so im nativeLibraryDir der
    // App — dem einzigen Ort, aus dem Android das Ausführen erlaubt. Den
    // Ordner liefert der Ladepfad unserer eigenen Bibliothek (libapp_lib.so)
    // in /proc/self/maps.
    #[cfg(target_os = "android")]
    if let Ok(maps) = std::fs::read_to_string("/proc/self/maps") {
        for line in maps.lines() {
            let Some(idx) = line.find('/') else { continue };
            let path = line[idx..].trim();
            if path.ends_with("/libapp_lib.so") {
                if let Some(p) = std::path::Path::new(path)
                    .parent()
                    .map(|dir| dir.join("libstockfish.so"))
                    .filter(|p| p.exists())
                {
                    return Some(p);
                }
                break;
            }
        }
    }

    let exe = if cfg!(windows) {
        "stockfish.exe"
    } else {
        "stockfish"
    };

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
fn set_game_tags(
    db: tauri::State<db::Db>,
    id: i64,
    tags: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::set_tags(&conn, id, &tags)
}

#[tauri::command]
fn read_pgn_file(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein PGN-Pfad angegeben.".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("PGN nicht lesbar: {e}"))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("PGN-Datei ist größer als 64 MB.".into());
    }
    std::fs::read_to_string(path).map_err(|e| format!("PGN nicht lesbar: {e}"))
}

#[tauri::command]
fn write_pgn_file(path: String, contents: String) -> Result<usize, String> {
    use std::io::Write;
    let path = std::path::PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Exportpfad angegeben.".into());
    }
    if path.exists() {
        return Err("Die Zieldatei existiert bereits.".into());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("PGN nicht speicherbar: {e}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("PGN nicht speicherbar: {e}"))?;
    Ok(contents.len())
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
    let live_depth = app
        .state::<settings::SettingsState>()
        .0
        .lock()
        .map(|s| s.live_depth)
        .unwrap_or(24);
    state.analyze(
        &app,
        &path.to_string_lossy(),
        &fen,
        depth.unwrap_or(live_depth).clamp(6, 40),
    )
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
            app.handle().plugin(tauri_plugin_opener::init())?;

            // QR-Scanner (nur Mobile): das Handy liest den Pairing-QR des Desktops.
            #[cfg(mobile)]
            app.handle().plugin(tauri_plugin_barcode_scanner::init())?;

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let loaded = settings::load(app.handle());
            // Konfigurierter DB-Pfad, mit Fallback auf den Standardort, falls
            // er nicht erreichbar ist (z. B. Nextcloud-Ordner nicht gemountet).
            let mut db_file = loaded
                .db_path
                .as_ref()
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("kiebitz.db"));
            let conn = match rusqlite::Connection::open(&db_file) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "Datenbank unter {db_file:?} nicht erreichbar ({e}); nutze Standardort"
                    );
                    db_file = data_dir.join("kiebitz.db");
                    rusqlite::Connection::open(&db_file)?
                }
            };
            db::init(&conn).map_err(std::io::Error::other)?;
            app.manage(settings::SettingsState(std::sync::Mutex::new(loaded)));
            app.manage(db::Db(std::sync::Mutex::new(conn)));
            app.manage(analysis::DbPath(std::sync::Mutex::new(db_file)));
            app.manage(analysis::AnalysisState::default());
            app.manage(live::LiveEngine::default());
            app.manage(endgame::EndgameEngine::default());
            app.manage(puzzles::PuzzleImportState::default());
            app.manage(sync::SyncServer::default());

            // Sync-Server (Desktop-Hub) automatisch starten, wenn aktiviert.
            // Nur auf dem Desktop sinnvoll — das Handy ist im v1-Modell Client.
            #[cfg(desktop)]
            {
                let sync_enabled = app
                    .state::<settings::SettingsState>()
                    .0
                    .lock()
                    .map(|s| s.sync_enabled)
                    .unwrap_or(false);
                if sync_enabled {
                    if let Err(e) = sync::start_server(app.handle()) {
                        log::warn!("Sync-Server nicht gestartet: {e}");
                    }
                }
            }

            // Auto-Update (nur Desktop): Plugin registrieren und beim Start
            // prüfen; ist die Einstellung aktiv, wird direkt installiert, sonst
            // nur eine Benachrichtigung ans Frontend geschickt. Mobile
            // aktualisiert über Store/Sideload (Stubs in updater.rs).
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                let auto_update = app
                    .state::<settings::SettingsState>()
                    .0
                    .lock()
                    .map(|s| s.auto_update)
                    .unwrap_or(false);
                updater::spawn_startup_check(app.handle(), auto_update);
            }
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
            set_game_tags,
            read_pgn_file,
            write_pgn_file,
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
            puzzles::puzzle_stats,
            settings::get_settings,
            settings::set_settings,
            settings::test_engine,
            settings::move_database,
            settings::use_database,
            settings::backup_database,
            settings::restore_database,
            settings::db_info,
            chessdb::chessdb_query,
            endgame::endgame_move,
            endgame::endgame_record,
            endgame::endgame_stats,
            study::study_data,
            sync::sync_info,
            sync::sync_server_start,
            sync::sync_now,
            sync::sync_discover,
            sync::sync_pair,
            updater::check_update,
            updater::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
