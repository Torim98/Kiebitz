//! Brücke zu den Android-Homescreen-Widgets.
//!
//! Die Widgets laufen in einem eigenen Prozess und oft dann, wenn Kiebitz gar
//! nicht offen ist. Sie lesen deshalb keine Datenbank, sondern eine kleine
//! Momentaufnahme, die die App in ihr eigenes Datenverzeichnis schreibt · den
//! Ort kennt die native Seite selbst, damit hier nichts geraten werden muss.
//!
//! Auf Desktop-Systemen ist das ein bewusster No-op: Windows-Systemwidgets und
//! ein Desktop-Kompaktmodus sind nicht geplant.

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

/// Obergrenze für die Momentaufnahme. Sie beschreibt einen Tag und eine Woche;
/// alles Größere wäre ein Fehler im Aufrufer, kein Datenstand.
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024;

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct SnapshotRequest {
    json: String,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct SnapshotResponse {
    /// Zahl der aktualisierten Widgets · 0 heißt schlicht: keins liegt auf dem
    /// Startbildschirm.
    #[serde(default)]
    updated: i32,
}

#[cfg(target_os = "android")]
struct Widgets<R: Runtime>(PluginHandle<R>);

/// Registriert die native Android-Brücke zu den App-Widgets.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("widgets")
        .setup(|app, api| {
            let handle = api.register_android_plugin("de.torim.kiebitz", "WidgetsPlugin")?;
            app.manage(Widgets(handle));
            Ok(())
        })
        .build()
}

/// Prüft, was ans Widget gehen soll.
///
/// Kein gültiges JSON hieße: Das Widget bekäme etwas, das es nicht lesen kann.
/// Lieber hier abbrechen als dort einen Fehlerzustand zeigen.
fn validate_snapshot(json: &str) -> Result<(), String> {
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err("Widget-Momentaufnahme ist zu groß.".into());
    }
    serde_json::from_str::<serde_json::Value>(json)
        .map(|_| ())
        .map_err(|error| format!("Widget-Momentaufnahme ist kein gültiges JSON: {error}"))
}

/// Legt die Momentaufnahme ab und stößt ein Neuzeichnen an.
#[tauri::command]
pub async fn widget_snapshot_write(app: tauri::AppHandle, json: String) -> Result<i32, String> {
    validate_snapshot(&json)?;

    #[cfg(target_os = "android")]
    {
        let response: SnapshotResponse = app
            .state::<Widgets<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("writeSnapshot", SnapshotRequest { json })
            .await
            .map_err(|error| error.to_string())?;
        return Ok(response.updated);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plausible_snapshot() {
        let snapshot = r#"{"version":1,"day":"2026-08-15","plus":true,"today":{"units":[]}}"#;
        assert!(validate_snapshot(snapshot).is_ok());
    }

    #[test]
    fn rejects_anything_the_widget_could_not_read() {
        assert!(validate_snapshot("").is_err());
        assert!(validate_snapshot("{not json").is_err());
        let oversized = format!("\"{}\"", "x".repeat(MAX_SNAPSHOT_BYTES));
        assert!(validate_snapshot(&oversized).is_err());
    }
}
