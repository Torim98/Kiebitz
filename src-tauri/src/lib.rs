mod engine;

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
fn resolve_engine(app: &tauri::AppHandle) -> Option<PathBuf> {
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

/// Einmalige Analyse: startet die Engine, analysiert die Stellung, beendet sie.
/// Für die spätere Dauer-Analyse (Eval-Bar live) wird die Engine als
/// gemanagter State im Speicher gehalten — dieser Command ist der erste Schritt.
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            engine_info,
            analyze_position
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
