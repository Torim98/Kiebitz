//! Auto-Update über signierte GitHub-Releases (tauri-plugin-updater).
//!
//! Beim Start wird immer geprüft: ist die Einstellung aktiv, wird das Update
//! direkt geladen und installiert; ist sie aus, meldet ein
//! `update://available`-Event dem Frontend nur, dass eine neue Version
//! bereitsteht (Toast unten rechts mit „Jetzt aktualisieren“). Daneben gibt es
//! den manuellen Check auf der Settings-Seite. Fortschritt läuft als
//! `update://state`-Events ans Frontend; nach der Installation startet die App
//! neu (unter Windows beendet der Installer die App selbst).

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
pub struct UpdateCheck {
    pub current: String,
    /// None = bereits aktuell.
    pub available: Option<String>,
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct UpdateState {
    /// "downloading" | "installing" | "error"
    pub phase: String,
    pub version: String,
    pub received: u64,
    /// Gesamtgröße, falls der Server sie mitschickt.
    pub total: Option<u64>,
    pub error: Option<String>,
}

/// Meldung „neue Version verfügbar“ an das Frontend (Toggle aus).
#[derive(Serialize, Clone)]
pub struct UpdateAvailable {
    pub version: String,
    pub notes: Option<String>,
}

fn emit_state(app: &AppHandle, state: UpdateState) {
    let _ = app.emit("update://state", state);
}

/// Fragt den Update-Endpoint ab, ohne etwas herunterzuladen.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    // App-Version aus tauri.conf.json (nicht CARGO_PKG_VERSION) — genau die
    // Version, gegen die auch der Updater vergleicht.
    let current = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(UpdateCheck {
        current,
        available: update.as_ref().map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body),
    })
}

/// Lädt das verfügbare Update herunter, installiert es und startet neu.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    match download_and_install(&app).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Kein Update verfügbar.".into()),
        Err(e) => Err(e),
    }
}

/// Check beim App-Start. Ist `auto` gesetzt, wird das Update direkt geladen,
/// installiert und die App neu gestartet; sonst wird nur geprüft und bei einer
/// neuen Version das Frontend über `update://available` benachrichtigt.
/// Fehler (z. B. offline, noch kein Release) werden nur geloggt.
pub fn spawn_startup_check(app: &AppHandle, auto: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if auto {
            if let Err(e) = download_and_install(&app).await {
                log::warn!("Auto-Update übersprungen: {e}");
            }
            return;
        }
        // Toggle aus: nur prüfen und ggf. das Frontend benachrichtigen.
        let found = async {
            let updater = app.updater().map_err(|e| e.to_string())?;
            updater.check().await.map_err(|e| e.to_string())
        }
        .await;
        match found {
            Ok(Some(update)) => {
                let _ = app.emit(
                    "update://available",
                    UpdateAvailable {
                        version: update.version.clone(),
                        notes: update.body.clone(),
                    },
                );
            }
            Ok(None) => {}
            Err(e) => log::warn!("Update-Check übersprungen: {e}"),
        }
    });
}

/// Gemeinsamer Kern: liefert Ok(false), wenn kein Update ansteht. Bei Erfolg
/// kehrt die Funktion in der Regel nicht zurück (App-Neustart).
async fn download_and_install(app: &AppHandle) -> Result<bool, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    let version = update.version.clone();
    log::info!("Update {version} gefunden, lade herunter …");

    let progress_app = app.clone();
    let progress_version = version.clone();
    let mut received: u64 = 0;
    let mut last_emitted: u64 = 0;
    let install_app = app.clone();
    let install_version = version.clone();
    let result = update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                // Nicht jeden Chunk melden — alle 256 KB reichen fürs UI.
                if received - last_emitted >= 256 * 1024 || Some(received) == total {
                    last_emitted = received;
                    emit_state(
                        &progress_app,
                        UpdateState {
                            phase: "downloading".into(),
                            version: progress_version.clone(),
                            received,
                            total,
                            error: None,
                        },
                    );
                }
            },
            move || {
                emit_state(
                    &install_app,
                    UpdateState {
                        phase: "installing".into(),
                        version: install_version.clone(),
                        received: 0,
                        total: None,
                        error: None,
                    },
                );
            },
        )
        .await;

    if let Err(e) = result {
        let msg = e.to_string();
        emit_state(
            app,
            UpdateState {
                phase: "error".into(),
                version,
                received: 0,
                total: None,
                error: Some(msg.clone()),
            },
        );
        return Err(msg);
    }

    log::info!("Update {version} installiert, starte neu …");
    app.restart();
}
