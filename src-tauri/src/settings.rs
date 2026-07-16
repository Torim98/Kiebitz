//! Persistente App-Einstellungen: eine settings.json im Config-Verzeichnis.
//! Die Datei liegt bewusst NICHT in der SQLite-Datenbank, damit der
//! Datenbank-Pfad selbst konfigurierbar bleibt (Henne-Ei-Problem).

use crate::{analysis, db, endgame, live, puzzles};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    /// UI-Sprache: "de" oder "en".
    pub locale: String,
    /// Abweichender Speicherort der kiebitz.db (None = App-Datenverzeichnis).
    pub db_path: Option<String>,
    /// Eigene UCI-Engine (None = gebündelte Stockfish / KIEBITZ_ENGINE).
    pub engine_path: Option<String>,
    /// 0 = automatisch (Kerne − 2).
    pub engine_threads: u32,
    pub engine_hash_mb: u32,
    pub engine_multipv: u32,
    /// Zieltiefe der Live-Analyse.
    pub live_depth: u32,
    /// Tiefe der Hintergrund-Analyse (Auto-Analyse-Pipeline).
    pub batch_depth: u32,
    /// Ordner mit Syzygy-Tablebases (None = keine); Endspiel-Trainer und
    /// Engine nutzen sie für perfektes Endspiel.
    pub syzygy_path: Option<String>,
    /// Online-Eröffnungsbuch chessdb.cn (Cloud-Evals), cache-gestützt.
    pub chessdb_enabled: bool,
    pub cc_user: String,
    pub li_user: String,
    /// Anzeigename fürs Dashboard (leer = chess.com-/Lichess-Benutzername).
    pub display_name: String,
    /// Monatsfenster für den Schnell-Import ("Neueste importieren").
    pub import_months: u32,
    /// Beim Start im Hintergrund nach Updates suchen und sie installieren.
    pub auto_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            locale: "de".into(),
            db_path: None,
            engine_path: None,
            engine_threads: 0,
            engine_hash_mb: 256,
            engine_multipv: 3,
            live_depth: 24,
            batch_depth: 14,
            syzygy_path: None,
            chessdb_enabled: false,
            cc_user: "Torim98".into(),
            li_user: "Torim98".into(),
            display_name: String::new(),
            import_months: 3,
            auto_update: true,
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn normalize(mut s: Settings) -> Settings {
    if s.locale != "en" {
        s.locale = "de".into();
    }
    s.engine_hash_mb = s.engine_hash_mb.clamp(16, 4096);
    s.engine_multipv = s.engine_multipv.clamp(1, 5);
    s.live_depth = s.live_depth.clamp(8, 40);
    s.batch_depth = s.batch_depth.clamp(6, 30);
    s.engine_threads = s.engine_threads.min(128);
    s.import_months = s.import_months.clamp(1, 240);
    s.cc_user = s.cc_user.trim().to_string();
    s.li_user = s.li_user.trim().to_string();
    s.display_name = s.display_name.trim().to_string();
    s.engine_path = s.engine_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    s.db_path = s.db_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    s.syzygy_path = s.syzygy_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    s
}

fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Lädt die Einstellungen; fehlende/kaputte Datei ergibt Defaults.
pub fn load(app: &tauri::AppHandle) -> Settings {
    let Ok(path) = config_file(app) else {
        return Settings::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .map(normalize)
        .unwrap_or_default()
}

fn save(app: &tauri::AppHandle, s: &Settings) -> Result<(), String> {
    let path = config_file(app)?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Einstellungen nicht speicherbar: {e}"))
}

#[tauri::command]
pub fn get_settings(state: tauri::State<SettingsState>) -> Result<Settings, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

/// Speichert neue Einstellungen und wendet sie an. Die Live-Engine wird
/// beendet, damit sie beim nächsten Zug mit den neuen Optionen startet.
#[tauri::command]
pub fn set_settings(
    app: tauri::AppHandle,
    state: tauri::State<SettingsState>,
    new_settings: Settings,
) -> Result<Settings, String> {
    let normalized = normalize(new_settings);
    save(&app, &normalized)?;
    *state.0.lock().map_err(|e| e.to_string())? = normalized.clone();
    app.state::<live::LiveEngine>().shutdown();
    app.state::<endgame::EndgameEngine>().shutdown();
    Ok(normalized)
}

#[derive(Serialize)]
pub struct EngineTest {
    pub ok: bool,
    pub name: String,
    pub path: String,
}

/// Testet eine Engine (expliziter Pfad oder die aktuell aufgelöste).
#[tauri::command]
pub fn test_engine(app: tauri::AppHandle, path: Option<String>) -> EngineTest {
    let resolved = match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p.trim());
            if p.exists() {
                Some(p)
            } else {
                return EngineTest {
                    ok: false,
                    name: "Datei nicht gefunden".into(),
                    path: p.to_string_lossy().to_string(),
                };
            }
        }
        None => crate::resolve_engine(&app),
    };
    match resolved {
        Some(p) => match crate::engine::UciEngine::spawn(&p.to_string_lossy()) {
            Ok(uci) => EngineTest {
                ok: true,
                name: uci.name().to_string(),
                path: p.to_string_lossy().to_string(),
            },
            Err(e) => EngineTest {
                ok: false,
                name: e,
                path: p.to_string_lossy().to_string(),
            },
        },
        None => EngineTest {
            ok: false,
            name: "Keine Engine gefunden".into(),
            path: String::new(),
        },
    }
}

// ── Datenbank-Speicherort ────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub games: i64,
    pub puzzles: i64,
    pub is_default: bool,
}

fn default_db_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kiebitz.db"))
}

fn ensure_workers_idle(app: &tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<analysis::AnalysisState>()
        .running
        .load(Ordering::SeqCst)
    {
        return Err("Bitte zuerst die laufende Analyse stoppen.".into());
    }
    if app
        .state::<puzzles::PuzzleImportState>()
        .0
        .load(Ordering::SeqCst)
    {
        return Err("Bitte warten, bis der Puzzle-Import abgeschlossen ist.".into());
    }
    Ok(())
}

/// Öffnet die Datenbank am neuen Ort und tauscht alle States aus.
fn switch_to(app: &tauri::AppHandle, path: PathBuf) -> Result<DbInfo, String> {
    let conn = Connection::open(&path).map_err(|e| format!("Öffnen fehlgeschlagen: {e}"))?;
    db::init(&conn)?;
    *app.state::<db::Db>().0.lock().map_err(|e| e.to_string())? = conn;
    *app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = path.clone();

    let settings_state = app.state::<SettingsState>();
    let mut settings = settings_state.0.lock().map_err(|e| e.to_string())?.clone();
    let is_default = default_db_file(app).map(|d| d == path).unwrap_or(false);
    settings.db_path = if is_default {
        None
    } else {
        Some(path.to_string_lossy().to_string())
    };
    save(app, &settings)?;
    *settings_state.0.lock().map_err(|e| e.to_string())? = settings;
    drop(settings_state);
    db_info(app.clone(), app.state())
}

/// Verschiebt die Datenbank: konsistente Kopie per VACUUM INTO, dann Umschalten.
/// Die alte Datei bleibt als Sicherung liegen.
#[tauri::command]
pub fn move_database(app: tauri::AppHandle, target: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let target = PathBuf::from(target.trim());
    if target.as_os_str().is_empty() {
        return Err("Kein Zielpfad angegeben.".into());
    }
    if target.exists() {
        return Err("Die Zieldatei existiert bereits — nutze „Vorhandene Datenbank verwenden“.".into());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("VACUUM INTO ?1", rusqlite::params![target.to_string_lossy()])
            .map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;
    }
    switch_to(&app, target)
}

/// Nutzt eine Datenbank an einem anderen Ort (z. B. im Nextcloud-Ordner eines
/// zweiten Geräts). Existiert die Datei nicht, wird dort eine neue angelegt.
#[tauri::command]
pub fn use_database(app: tauri::AppHandle, path: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Kein Pfad angegeben.".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Ordner nicht anlegbar: {e}"))?;
    }
    switch_to(&app, path)
}

#[tauri::command]
pub fn db_info(app: tauri::AppHandle, db: tauri::State<db::Db>) -> Result<DbInfo, String> {
    let path = app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let games: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let puzzles: i64 = conn
        .query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let is_default = default_db_file(&app).map(|d| d == path).unwrap_or(false);
    Ok(DbInfo {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        games,
        puzzles,
        is_default,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_clamps_and_trims() {
        let s = normalize(Settings {
            locale: "fr".into(),
            engine_hash_mb: 999_999,
            engine_multipv: 0,
            live_depth: 99,
            batch_depth: 1,
            cc_user: "  Torim98  ".into(),
            engine_path: Some("   ".into()),
            ..Settings::default()
        });
        assert_eq!(s.locale, "de");
        assert_eq!(s.engine_hash_mb, 4096);
        assert_eq!(s.engine_multipv, 1);
        assert_eq!(s.live_depth, 40);
        assert_eq!(s.batch_depth, 6);
        assert_eq!(s.cc_user, "Torim98");
        assert_eq!(s.engine_path, None);
    }

    #[test]
    fn settings_roundtrip_json() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.locale, "de");
        assert_eq!(back.engine_hash_mb, 256);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let back: Settings = serde_json::from_str(r#"{"locale":"en"}"#).unwrap();
        assert_eq!(back.locale, "en");
        assert_eq!(back.engine_multipv, 3);
        assert_eq!(back.import_months, 3);
        assert!(back.auto_update);
        assert_eq!(back.display_name, "");
    }
}
