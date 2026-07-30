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
    /// Neue Partien beim Start und im Hintergrund nachladen.
    pub auto_import: bool,
    pub cc_user: String,
    pub li_user: String,
    /// Anzeigename fürs Dashboard (leer = chess.com-/Lichess-Benutzername).
    pub display_name: String,
    /// Monatsfenster für den Schnell-Import ("Neueste importieren").
    pub import_months: u32,
    /// Puzzle-Tagesziel (Versuche pro Tag) für Dashboard und Lernplan.
    pub puzzle_goal: u32,
    /// Zug- und Schlagklänge auf allen Brettern.
    pub sound_enabled: bool,
    /// Lautstärke der Brettklänge in Prozent.
    pub sound_volume: u32,
    /// Beim Start im Hintergrund nach Updates suchen und sie installieren.
    pub auto_update: bool,
    /// Sync-Server (Desktop als Hub) beim Start mitstarten.
    pub sync_enabled: bool,
    /// Pairing-Code für den Geräte-Sync (leer = noch nie aktiviert;
    /// wird beim ersten Aktivieren generiert).
    pub sync_code: String,
    /// Mobile: Adresse des Desktop-Hubs ("host:port").
    pub sync_host: String,
    /// SHA-256-Fingerprint des Hub-Zertifikats. Wird ausschließlich durch den
    /// QR-Pairing-Link gesetzt und pinnt den selbstsignierten HTTPS-Endpunkt.
    pub sync_fingerprint: String,
    /// Mobile: automatisch im Hintergrund synchronisieren (bei Änderungen,
    /// per Timer und bei App-Fokus), statt manuell in den Settings.
    pub sync_auto: bool,
    /// Tägliche Erinnerung an anstehendes Training (Desktop und Android).
    pub notify_enabled: bool,
    /// Uhrzeit der Erinnerung als lokale "HH:MM".
    pub notify_time: String,
    /// Welche Fälligkeiten die Erinnerung nennt.
    pub notify_study: bool,
    pub notify_repertoire: bool,
    pub notify_puzzles: bool,
    pub notify_endgame: bool,
    pub notify_analysis: bool,
    /// Wurde die Ersteinrichtung durchlaufen? Steuert das Onboarding.
    pub onboarded: bool,
}

/// "HH:MM" auf eine gültige Uhrzeit begrenzen; Unsinn fällt auf 18:00 zurück.
fn normalize_time(value: &str) -> String {
    let (Some(hours), Some(minutes)) = (
        value.get(0..2).and_then(|h| h.parse::<u32>().ok()),
        value.get(3..5).and_then(|m| m.parse::<u32>().ok()),
    ) else {
        return "18:00".into();
    };
    if value.as_bytes().get(2) != Some(&b':') || hours > 23 || minutes > 59 {
        return "18:00".into();
    }
    format!("{hours:02}:{minutes:02}")
}

impl Default for Settings {
    fn default() -> Self {
        // Mobile: konservative Engine-Defaults (Akku/Thermik) · weniger
        // Threads, kleiner Hash, geringere Tiefe als auf dem Desktop.
        #[cfg(target_os = "android")]
        let (threads, hash, live, batch) = (2, 64, 14, 10);
        #[cfg(not(target_os = "android"))]
        let (threads, hash, live, batch) = (0, 256, 24, 14);
        Self {
            // Englisch ist die kleinste gemeinsame Basis; umstellbar bleibt es.
            locale: "en".into(),
            db_path: None,
            engine_path: None,
            engine_threads: threads,
            engine_hash_mb: hash,
            engine_multipv: 3,
            live_depth: live,
            batch_depth: batch,
            syzygy_path: None,
            // Beide Komfortfunktionen sind ab Werk an; abschaltbar bleiben sie.
            chessdb_enabled: true,
            auto_import: true,
            cc_user: String::new(),
            li_user: String::new(),
            display_name: String::new(),
            import_months: 3,
            puzzle_goal: 20,
            sound_enabled: true,
            sound_volume: 70,
            auto_update: true,
            sync_enabled: false,
            sync_code: String::new(),
            sync_host: String::new(),
            sync_fingerprint: String::new(),
            sync_auto: false,
            notify_enabled: false,
            notify_time: "18:00".into(),
            notify_study: true,
            notify_repertoire: true,
            notify_puzzles: true,
            notify_endgame: true,
            notify_analysis: true,
            onboarded: false,
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
    s.puzzle_goal = s.puzzle_goal.clamp(1, 200);
    s.sound_volume = s.sound_volume.min(100);
    s.cc_user = s.cc_user.trim().to_string();
    s.li_user = s.li_user.trim().to_string();
    s.display_name = s.display_name.trim().to_string();
    s.engine_path = s
        .engine_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.db_path = s
        .db_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.syzygy_path = s
        .syzygy_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    s.notify_time = normalize_time(&s.notify_time);
    s.sync_fingerprint = s
        .sync_fingerprint
        .trim()
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_lowercase();
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

pub(crate) fn save(app: &tauri::AppHandle, s: &Settings) -> Result<(), String> {
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
    *app.state::<analysis::DbPath>()
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
    collect_db_info(app)
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
        return Err(
            "Die Zieldatei existiert bereits · nutze „Vorhandene Datenbank verwenden“.".into(),
        );
    }
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "VACUUM INTO ?1",
            rusqlite::params![target.to_string_lossy()],
        )
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

/// Erstellt über die SQLite Online Backup API einen konsistenten Snapshot.
fn backup_to(source: &Connection, target: &std::path::Path) -> Result<(), String> {
    if target.exists() {
        return Err("Die Sicherungsdatei existiert bereits.".into());
    }
    if let Some(parent) = target.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|e| format!("Zielordner nicht anlegbar: {e}"))?;
    }
    let mut destination =
        Connection::open(target).map_err(|e| format!("Sicherungsdatei nicht anlegbar: {e}"))?;
    let result = (|| {
        let backup = rusqlite::backup::Backup::new(source, &mut destination)
            .map_err(|e| format!("Backup nicht startbar: {e}"))?;
        backup
            .run_to_completion(128, std::time::Duration::from_millis(10), None)
            .map_err(|e| format!("Backup fehlgeschlagen: {e}"))
    })();
    drop(destination);
    if let Err(e) = result {
        let _ = std::fs::remove_file(target);
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub fn backup_database(app: tauri::AppHandle, target: String) -> Result<String, String> {
    ensure_workers_idle(&app)?;
    let target = PathBuf::from(target.trim());
    if target.as_os_str().is_empty() {
        return Err("Kein Sicherungspfad angegeben.".into());
    }
    let source = app.state::<db::Db>();
    let source = source.0.lock().map_err(|e| e.to_string())?;
    backup_to(&source, &target)?;
    Ok(target.to_string_lossy().to_string())
}

/// Validiert einen Snapshot und spielt ihn über die SQLite Backup API in die
/// aktuell geöffnete Datenbank ein. Der Connection-Handle bleibt dabei stabil.
fn restore_from(source_path: &std::path::Path, destination: &mut Connection) -> Result<(), String> {
    let source =
        Connection::open_with_flags(source_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Sicherung nicht lesbar: {e}"))?;
    let check: String = source
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("Sicherung ungültig: {e}"))?;
    if check != "ok" {
        return Err(format!("Sicherung beschädigt: {check}"));
    }
    let has_games: i64 = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='games'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("Sicherung ungültig: {e}"))?;
    if has_games != 1 {
        return Err("Die Datei ist keine Kiebitz-Datenbank.".into());
    }
    let backup = rusqlite::backup::Backup::new(&source, destination)
        .map_err(|e| format!("Wiederherstellung nicht startbar: {e}"))?;
    backup
        .run_to_completion(128, std::time::Duration::from_millis(10), None)
        .map_err(|e| format!("Wiederherstellung fehlgeschlagen: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn restore_database(app: tauri::AppHandle, source: String) -> Result<DbInfo, String> {
    ensure_workers_idle(&app)?;
    let source_path = PathBuf::from(source.trim());
    if !source_path.is_file() {
        return Err("Sicherungsdatei nicht gefunden.".into());
    }
    let current_path = app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if source_path.canonicalize().ok() == current_path.canonicalize().ok() {
        return Err("Die Sicherung darf nicht die aktuell geöffnete Datenbank sein.".into());
    }
    {
        let state = app.state::<db::Db>();
        let mut destination = state.0.lock().map_err(|e| e.to_string())?;
        restore_from(&source_path, &mut destination)?;
        db::init(&destination)?;
    }
    collect_db_info(&app)
}

/// Setzt die App auf Werkseinstellungen zurück: Datenbankinhalt leeren,
/// Einstellungen verwerfen, Hilfsdateien löschen. Die Datenbankdatei selbst
/// bleibt bestehen (der Connection-Handle wird weiterverwendet), aber sie ist
/// danach leer und frisch migriert.
#[tauri::command]
pub fn factory_reset(app: tauri::AppHandle) -> Result<(), String> {
    ensure_workers_idle(&app)?;
    {
        let state = app.state::<db::Db>();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN")
            .map_err(|e| e.to_string())?;
        for table in &tables {
            conn.execute(&format!("DELETE FROM \"{table}\""), [])
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        // Schema und Startvorlagen neu anlegen, dann die Datei schrumpfen.
        db::init(&conn)?;
        let _ = conn.execute_batch("VACUUM");
        db::checkpoint(&conn);
    }

    // Einstellungen auf Werk zurück (inkl. Sync-Kopplung und Onboarding).
    let defaults = Settings::default();
    save(&app, &defaults)?;
    *app.state::<SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = defaults;

    // Abgeleitete Dateien: Sync-Zertifikat, Pairing und Erinnerungs-Snapshot.
    if let Ok(dir) = app.path().app_config_dir() {
        for name in ["reminder.json", "sync-cert.pem", "sync-key.pem"] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
    app.state::<live::LiveEngine>().shutdown();
    app.state::<endgame::EndgameEngine>().shutdown();
    Ok(())
}

/// Zustand der Datenbank für die Einstellungen.
///
/// Die beiden Zählabfragen laufen über Tabellen, die nach einem Puzzle-Import
/// Millionen Zeilen haben · deshalb nicht im Hauptthread, sonst steht auf
/// Android die Oberfläche, bis SQLite fertig gezählt hat.
#[tauri::command]
pub async fn db_info(app: tauri::AppHandle) -> Result<DbInfo, String> {
    tauri::async_runtime::spawn_blocking(move || collect_db_info(&app))
        .await
        .map_err(|e| format!("Datenbankinfo fehlgeschlagen: {e}"))?
}

fn collect_db_info(app: &tauri::AppHandle) -> Result<DbInfo, String> {
    let path = app
        .state::<analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let db = app.state::<db::Db>();
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
    fn normalize_repairs_reminder_times() {
        assert_eq!(normalize_time("7:5"), "18:00");
        assert_eq!(normalize_time("24:00"), "18:00");
        assert_eq!(normalize_time("09:30"), "09:30");
        assert_eq!(normalize_time("23:59"), "23:59");
        assert_eq!(
            normalize(Settings {
                notify_time: "".into(),
                ..Settings::default()
            })
            .notify_time,
            "18:00"
        );
    }

    #[test]
    fn settings_roundtrip_json() {
        let s = Settings::default();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.locale, "en");
        assert_eq!(back.engine_hash_mb, 256);
    }

    #[test]
    fn fresh_installs_start_empty_and_in_english() {
        let s = Settings::default();
        assert_eq!(s.locale, "en");
        // Keine fremden Konten, keine Pfade eines anderen Rechners.
        assert_eq!(s.cc_user, "");
        assert_eq!(s.li_user, "");
        assert_eq!(s.engine_path, None);
        assert_eq!(s.db_path, None);
        assert_eq!(s.syzygy_path, None);
        // Komfortfunktionen an, Ersteinrichtung offen.
        assert!(s.chessdb_enabled);
        assert!(s.auto_import);
        assert!(!s.onboarded);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let back: Settings = serde_json::from_str(r#"{"locale":"de"}"#).unwrap();
        assert_eq!(back.locale, "de");
        assert_eq!(back.engine_multipv, 3);
        assert_eq!(back.import_months, 3);
        assert!(back.auto_update);
        assert_eq!(back.display_name, "");
    }

    #[test]
    fn database_backup_and_restore_roundtrip() {
        let source = Connection::open_in_memory().unwrap();
        db::init(&source).unwrap();
        source
            .execute_batch(
                "CREATE TABLE backup_marker (value TEXT); INSERT INTO backup_marker VALUES ('ok');",
            )
            .unwrap();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("kiebitz-backup-{unique}.db"));

        backup_to(&source, &path).unwrap();
        assert!(path.is_file());

        let mut destination = Connection::open_in_memory().unwrap();
        restore_from(&path, &mut destination).unwrap();
        let value: String = destination
            .query_row("SELECT value FROM backup_marker", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "ok");

        std::fs::remove_file(path).unwrap();
    }
}
