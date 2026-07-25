//! Trainings-Erinnerungen.
//!
//! Zwei Wege führen zur Benachrichtigung:
//!   * Läuft die App, schickt das Frontend den fertigen Text an `notify_now`.
//!   * Läuft sie nicht, übernimmt das Betriebssystem: Windows startet die
//!     Anwendung per Aufgabenplanung mit `--reminder` (siehe `run_headless`),
//!     Android weckt die vom Frontend vorab geplante Notification per
//!     AlarmManager.
//!
//! Windows verwirft Toasts ohne registrierte AppUserModelID kommentarlos —
//! deshalb legt `register_windows_app_id` den passenden Registry-Eintrag an.

use crate::settings::Settings;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;

/// Offene Aufgaben des Tages.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct DueSummary {
    /// Geplante, noch offene Lerneinheiten von heute.
    pub study: i64,
    /// Fällige Repertoire-Wiederholungen (inkl. neuer Karten).
    pub repertoire: i64,
    /// Bis zum Puzzle-Tagesziel fehlende Versuche.
    pub puzzles_left: i64,
    /// Wurde heute schon ein Endspiel gespielt?
    pub endgame_done: bool,
    /// Partien ohne Auto-Analyse.
    pub unanalyzed: i64,
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Zählt zusammen, was heute noch aussteht.
pub fn collect_due(conn: &Connection, now: i64, puzzle_goal: i64) -> Result<DueSummary, String> {
    let day_start = now - now.rem_euclid(86_400);
    let day_end = day_start + 86_400;
    let one = |sql: &str, args: &[i64]| -> Result<i64, String> {
        conn.query_row(sql, rusqlite::params_from_iter(args.iter()), |r| r.get(0))
            .map_err(|e| e.to_string())
    };
    // my_move-Parität wie in repertoire.rs: Weiß trainiert ungerade Halbzüge.
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    let today = crate::study::iso_day(day_start);
    Ok(DueSummary {
        study: conn
            .query_row(
                "SELECT COUNT(*) FROM study_events WHERE day = ?1 AND completed = 0",
                rusqlite::params![today],
                |r| r.get(0),
            )
            .unwrap_or(0),
        repertoire: one(
            &format!("SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts < ?1)"),
            &[day_end],
        )?,
        puzzles_left: (puzzle_goal
            - one(
                "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
                &[day_start, day_end],
            )?)
        .max(0),
        endgame_done: one(
            "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
            &[day_start, day_end],
        )? > 0,
        unanalyzed: one(
            "SELECT COUNT(*) FROM games WHERE analyzed = 0 AND analysis_excluded = 0",
            &[],
        )
        .unwrap_or(0),
    })
}

/// Kurztexte der Erinnerung. Bewusst dupliziert statt aus dem Frontend geladen:
/// der Headless-Lauf hat kein WebView.
fn phrase(locale: &str, key: &str, n: i64) -> String {
    let english = locale == "en";
    match (key, english) {
        ("study", true) => format!("{n} planned units"),
        ("study", false) => format!("{n} geplante Einheiten"),
        ("repertoire", true) => format!("{n} reviews due"),
        ("repertoire", false) => format!("{n} Wiederholungen fällig"),
        ("puzzles", true) => format!("{n} puzzles to your daily goal"),
        ("puzzles", false) => format!("{n} Puzzles bis zum Tagesziel"),
        ("endgame", true) => "Endgame training pending".into(),
        ("endgame", false) => "Endspiel-Training offen".into(),
        ("analysis", true) => format!("{n} games unanalyzed"),
        ("analysis", false) => format!("{n} Partien unanalysiert"),
        _ => String::new(),
    }
}

pub fn title(locale: &str) -> String {
    if locale == "en" {
        "Kiebitz — training".into()
    } else {
        "Kiebitz — Training".into()
    }
}

/// Erinnerungstext aus den aktivierten Kategorien; None = nichts zu tun.
pub fn reminder_body(settings: &Settings, due: &DueSummary) -> Option<String> {
    let locale = settings.locale.as_str();
    let mut parts: Vec<String> = Vec::new();
    if settings.notify_study && due.study > 0 {
        parts.push(phrase(locale, "study", due.study));
    }
    if settings.notify_repertoire && due.repertoire > 0 {
        parts.push(phrase(locale, "repertoire", due.repertoire));
    }
    if settings.notify_puzzles && due.puzzles_left > 0 {
        parts.push(phrase(locale, "puzzles", due.puzzles_left));
    }
    if settings.notify_endgame && !due.endgame_done {
        parts.push(phrase(locale, "endgame", 0));
    }
    if settings.notify_analysis && due.unanalyzed > 0 {
        parts.push(phrase(locale, "analysis", due.unanalyzed));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" · "))
    }
}

// ── Zustellung ───────────────────────────────────────────────────────────────

/// Registriert die AppUserModelID in HKCU. Ohne sie verwirft Windows Toasts
/// stillschweigend — auch die des Tauri-Plugins.
#[cfg(windows)]
pub fn register_windows_app_id(app_id: &str, display_name: &str, icon: Option<PathBuf>) {
    use std::process::Command;
    // `reg add` statt einer Registry-Crate: kein zusätzlicher Dependency-Baum,
    // und der Aufruf ist idempotent.
    let key = format!("HKCU\\Software\\Classes\\AppUserModelId\\{app_id}");
    let mut base = Command::new("reg");
    base.args([
        "add", &key, "/v", "DisplayName", "/t", "REG_SZ", "/d", display_name, "/f",
    ]);
    no_window(&mut base);
    let _ = base.output();
    if let Some(path) = icon.filter(|p| p.exists()) {
        let mut with_icon = Command::new("reg");
        with_icon.args([
            "add",
            &key,
            "/v",
            "IconUri",
            "/t",
            "REG_SZ",
            "/d",
            &path.to_string_lossy(),
            "/f",
        ]);
        no_window(&mut with_icon);
        let _ = with_icon.output();
    }
}

#[cfg(windows)]
fn no_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

/// Zeigt eine Systembenachrichtigung. Auf Windows direkt über WinRT, damit ein
/// Fehlschlag sichtbar wird (das Plugin verschluckt ihn).
#[cfg(windows)]
pub fn show(app_id: &str, title: &str, body: &str) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Toast};
    Toast::new(app_id)
        .title(title)
        .text1(body)
        .duration(Duration::Short)
        .show()
        .map_err(|e| format!("Windows lehnt die Benachrichtigung ab: {e}"))
}

#[cfg(not(windows))]
pub fn show(_app_id: &str, _title: &str, _body: &str) -> Result<(), String> {
    Err("Auf dieser Plattform verschickt das Frontend die Benachrichtigung.".into())
}

/// Sofortige Benachrichtigung aus dem Frontend (App läuft).
#[tauri::command]
pub fn notify_now(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = &app;
        return show(&app.config().identifier, &title, &body);
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())
    }
}

// ── Hintergrundplanung (Windows-Aufgabenplanung) ─────────────────────────────

#[cfg(windows)]
const TASK_NAME: &str = "Kiebitz Trainings-Erinnerung";

/// Legt die tägliche Aufgabe an bzw. entfernt sie. Die Aufgabe startet Kiebitz
/// mit `--reminder`; der Lauf zeigt die Benachrichtigung und beendet sich.
#[cfg(windows)]
fn apply_windows_schedule(enabled: bool, time: &str) -> Result<String, String> {
    use std::process::Command;
    let mut remove = Command::new("schtasks");
    remove.args(["/Delete", "/TN", TASK_NAME, "/F"]);
    no_window(&mut remove);
    let _ = remove.output();
    if !enabled {
        return Ok(String::new());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut create = Command::new("schtasks");
    create.args([
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        &format!("\"{}\" --reminder", exe.display()),
        "/SC",
        "DAILY",
        "/ST",
        time,
        "/F",
    ]);
    no_window(&mut create);
    let output = create.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(TASK_NAME.to_string())
    } else {
        Err(format!(
            "Aufgabenplanung meldet: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// Bringt die Betriebssystem-Planung mit den Einstellungen in Einklang.
/// Rückgabe: Name der Aufgabe (leer = keine Planung nötig/möglich).
#[tauri::command]
pub fn sync_reminder_schedule(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let settings = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    #[cfg(windows)]
    {
        return apply_windows_schedule(settings.notify_enabled, &settings.notify_time);
    }
    #[cfg(not(windows))]
    {
        // Android plant über den AlarmManager im Frontend, andere Desktops
        // haben keinen einheitlichen Weg.
        let _ = settings;
        Ok(String::new())
    }
}

// ── Headless-Lauf (`--reminder`) ─────────────────────────────────────────────

/// Vorberechneter Erinnerungstext der laufenden App. Der Hintergrundlauf nutzt
/// ihn, wenn die Datenbank gerade nicht zweitgeöffnet werden kann (WAL-Zustand,
/// Sperren, verschobener Speicherort).
#[derive(Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Snapshot {
    pub title: String,
    pub body: String,
    /// Unix-Sekunden der Berechnung.
    pub ts: i64,
}

/// Hinterlegt den zuletzt bekannten Stand für den Hintergrundlauf.
#[tauri::command]
pub fn save_reminder_snapshot(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let snapshot = Snapshot {
        title,
        body,
        ts: now_ts(),
    };
    std::fs::write(
        dir.join("reminder.json"),
        serde_json::to_string(&snapshot).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn read_snapshot(dir: &std::path::Path) -> Option<Snapshot> {
    let text = std::fs::read_to_string(dir.join("reminder.json")).ok()?;
    let snapshot: Snapshot = serde_json::from_str(&text).ok()?;
    // Älter als eine Woche: lieber schweigen als grob falsch erinnern.
    if snapshot.body.trim().is_empty() || now_ts() - snapshot.ts > 7 * 86_400 {
        return None;
    }
    Some(snapshot)
}

/// Konfig-/Datenverzeichnis ohne Tauri-Handle: Tauri legt beides unter
/// `%APPDATA%\<identifier>` bzw. `$XDG_CONFIG_HOME/<identifier>` ab.
fn app_dir(identifier: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|dir| dir.join(identifier))
}

/// Wurde die App nur zum Erinnern gestartet? Dann Benachrichtigung zeigen und
/// `true` zurückgeben, damit `run()` ohne Fenster endet.
pub fn run_headless(identifier: &str) -> bool {
    if !std::env::args().any(|arg| arg == "--reminder") {
        return false;
    }
    #[cfg(windows)]
    register_windows_app_id(identifier, "Kiebitz", None);
    let Some(dir) = app_dir(identifier) else {
        return true;
    };
    let settings: Settings = std::fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    if !settings.notify_enabled {
        return true;
    }
    let db_file = settings
        .db_path
        .clone()
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("kiebitz.db"));
    // Erste Wahl: frisch aus der Datenbank. Normal öffnen (WAL braucht
    // Schreibzugriff auf die -shm-Datei), aber ohne `db::init` — der
    // Erinnerungslauf migriert nichts.
    let fresh = Connection::open(&db_file)
        .map_err(|e| format!("Datenbank {}: {e}", db_file.display()))
        .and_then(|conn| collect_due(&conn, now_ts(), settings.puzzle_goal as i64))
        .map(|due| reminder_body(&settings, &due));
    let result = match fresh {
        Ok(None) => Ok("nichts fällig".to_string()),
        Ok(Some(body)) => show(identifier, &title(&settings.locale), &body).map(|()| body),
        // Zweite Wahl: der Stand, den die App zuletzt hinterlegt hat. Die
        // Datenbank ist aus einem zweiten Prozess nicht immer lesbar.
        Err(error) => match read_snapshot(&dir) {
            Some(snapshot) => show(identifier, &snapshot.title, &snapshot.body)
                .map(|()| format!("{} (Stand der App)", snapshot.body)),
            None => Err(error),
        },
    };
    // Der Lauf hat keine Konsole; die Zeile hilft beim Prüfen von Hand
    // (`kiebitz.exe --reminder`) und in den Logs der Aufgabenplanung.
    match result {
        Ok(text) => println!("Kiebitz-Erinnerung: {text}"),
        Err(error) => eprintln!("Kiebitz-Erinnerung fehlgeschlagen: {error}"),
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const TODAY: i64 = 20_000;
    const NOW: i64 = TODAY * 86_400 + 12 * 3_600;

    fn settings() -> Settings {
        Settings {
            locale: "de".into(),
            ..Settings::default()
        }
    }

    #[test]
    fn collects_open_work_of_the_day() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
             VALUES (0, 'white', 'e4', 'fen-e4', 1, 0, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed) VALUES ('manual', 'open', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
            rusqlite::params![TODAY * 86_400 + 60],
        )
        .unwrap();

        let due = collect_due(&conn, NOW, 20).unwrap();
        assert_eq!(due.repertoire, 1);
        assert_eq!(due.unanalyzed, 1);
        assert_eq!(due.puzzles_left, 19);
        assert!(!due.endgame_done);
    }

    #[test]
    fn body_lists_enabled_categories_only() {
        let due = DueSummary {
            study: 2,
            repertoire: 14,
            puzzles_left: 8,
            endgame_done: false,
            unanalyzed: 3,
        };
        assert_eq!(
            reminder_body(&settings(), &due).unwrap(),
            "2 geplante Einheiten · 14 Wiederholungen fällig · 8 Puzzles bis zum Tagesziel · Endspiel-Training offen · 3 Partien unanalysiert"
        );

        let quiet = Settings {
            notify_repertoire: false,
            notify_endgame: false,
            notify_analysis: false,
            notify_study: false,
            ..settings()
        };
        assert_eq!(
            reminder_body(&quiet, &due).unwrap(),
            "8 Puzzles bis zum Tagesziel"
        );
    }

    #[test]
    fn body_is_empty_when_nothing_is_due() {
        let due = DueSummary {
            endgame_done: true,
            ..DueSummary::default()
        };
        assert!(reminder_body(&settings(), &due).is_none());
    }

    #[test]
    fn snapshot_is_used_only_while_it_is_fresh() {
        let dir = std::env::temp_dir().join(format!("kiebitz-reminder-{}", now_ts()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |ts: i64| {
            std::fs::write(
                dir.join("reminder.json"),
                serde_json::to_string(&Snapshot {
                    title: "Kiebitz".into(),
                    body: "14 Wiederholungen fällig".into(),
                    ts,
                })
                .unwrap(),
            )
            .unwrap();
        };

        write(now_ts());
        assert_eq!(
            read_snapshot(&dir).unwrap().body,
            "14 Wiederholungen fällig"
        );

        // Älter als eine Woche: lieber nichts sagen als etwas Falsches.
        write(now_ts() - 8 * 86_400);
        assert!(read_snapshot(&dir).is_none());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn english_settings_produce_english_text() {
        let english = Settings {
            locale: "en".into(),
            ..settings()
        };
        let due = DueSummary {
            repertoire: 5,
            endgame_done: true,
            ..DueSummary::default()
        };
        assert_eq!(reminder_body(&english, &due).unwrap(), "5 reviews due");
        assert_eq!(title("en"), "Kiebitz — training");
    }
}
