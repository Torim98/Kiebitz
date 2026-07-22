//! Updates über signierte GitHub-Releases.
//!
//! Auf dem Desktop wird beim Start immer geprüft: ist die Einstellung aktiv,
//! wird das Update direkt geladen und installiert; ist sie aus, meldet ein
//! `update://available`-Event dem Frontend nur, dass eine neue Version
//! bereitsteht (Toast unten rechts mit „Jetzt aktualisieren“). Daneben gibt es
//! den manuellen Check auf der Settings-Seite. Fortschritt läuft als
//! `update://state`-Events ans Frontend; nach der Installation startet die App
//! neu (unter Windows beendet der Installer die App selbst).
//!
//! Android liest beim manuellen Check dieselbe `latest.json`, vergleicht deren
//! Version und öffnet die passende signierte GitHub-APK im Systembrowser. Die
//! eigentliche Installation muss Android aus Sicherheitsgründen bestätigen.

use serde::Serialize;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri_plugin_opener::OpenerExt;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "android")]
const RELEASE_MANIFEST_URL: &str =
    "https://github.com/Torim98/Kiebitz/releases/latest/download/latest.json";

#[cfg(any(target_os = "android", test))]
fn parse_release_version(raw: &str) -> Result<semver::Version, String> {
    semver::Version::parse(raw.trim().trim_start_matches('v'))
        .map_err(|e| format!("Ungültige Release-Version '{raw}': {e}"))
}

#[cfg(any(target_os = "android", test))]
fn is_newer_release(current: &str, candidate: &str) -> Result<bool, String> {
    Ok(parse_release_version(candidate)? > parse_release_version(current)?)
}

#[cfg(any(target_os = "android", test))]
fn android_apk_url(version: &str) -> Result<String, String> {
    let version = parse_release_version(version)?.to_string();
    Ok(format!(
        "https://github.com/Torim98/Kiebitz/releases/download/v{version}/Kiebitz_{version}_arm64.apk"
    ))
}

#[derive(Serialize)]
pub struct UpdateCheck {
    pub current: String,
    /// None = bereits aktuell.
    pub available: Option<String>,
    pub notes: Option<String>,
}

#[cfg(desktop)]
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
#[cfg(desktop)]
#[derive(Serialize, Clone)]
pub struct UpdateAvailable {
    pub version: String,
    pub notes: Option<String>,
}

#[cfg(desktop)]
const PROGRESS_EVENT_STEP: u64 = 256 * 1024;

#[cfg(desktop)]
fn should_emit_progress(received: u64, last_emitted: u64, total: Option<u64>) -> bool {
    received.saturating_sub(last_emitted) >= PROGRESS_EVENT_STEP || total == Some(received)
}

#[cfg(desktop)]
fn emit_state(app: &AppHandle, state: UpdateState) {
    let _ = app.emit("update://state", state);
}

/// Fragt den Update-Endpoint ab, ohne etwas herunterzuladen.
#[cfg(desktop)]
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
#[cfg(desktop)]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    match download_and_install(&app).await {
        Ok(true) => Ok(()),
        Ok(false) => Err("Kein Update verfügbar.".into()),
        Err(e) => Err(e),
    }
}

// ── Mobile-Updates ───────────────────────────────────────────────────────────
// Android prüft den Desktop-Release-Feed, installiert aber nicht still: der
// Systembrowser lädt die APK, anschließend bestätigt der Nutzer die Installation.

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct AndroidReleaseManifest {
    version: String,
}

#[cfg(target_os = "android")]
fn fetch_android_release() -> Result<AndroidReleaseManifest, String> {
    let response = ureq::get(RELEASE_MANIFEST_URL)
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| format!("Release-Feed nicht erreichbar: {e}"))?;
    serde_json::from_reader(response.into_reader())
        .map_err(|e| format!("Release-Feed ist ungültig: {e}"))
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    let manifest = tauri::async_runtime::spawn_blocking(fetch_android_release)
        .await
        .map_err(|e| format!("Update-Check abgebrochen: {e}"))??;
    let available = if is_newer_release(&current, &manifest.version)? {
        Some(parse_release_version(&manifest.version)?.to_string())
    } else {
        None
    };
    Ok(UpdateCheck {
        current,
        available,
        notes: None,
    })
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let check = check_update(app.clone()).await?;
    let version = check
        .available
        .ok_or_else(|| "Kein Update verfügbar.".to_string())?;
    let url = android_apk_url(&version)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("APK-Download konnte nicht geöffnet werden: {e}"))
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    Ok(UpdateCheck {
        current: app.package_info().version.to_string(),
        available: None,
        notes: None,
    })
}

#[cfg(target_os = "ios")]
#[tauri::command]
pub async fn install_update(_app: AppHandle) -> Result<(), String> {
    Err("In-App-Updates sind auf iOS nicht verfügbar.".into())
}

/// Check beim App-Start. Ist `auto` gesetzt, wird das Update direkt geladen,
/// installiert und die App neu gestartet; sonst wird nur geprüft und bei einer
/// neuen Version das Frontend über `update://available` benachrichtigt.
/// Fehler (z. B. offline, noch kein Release) werden nur geloggt.
#[cfg(desktop)]
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
#[cfg(desktop)]
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
                if should_emit_progress(received, last_emitted, total) {
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

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn progress_is_throttled_to_256_kib_steps() {
        assert!(!should_emit_progress(1, 0, None));
        assert!(!should_emit_progress(PROGRESS_EVENT_STEP - 1, 0, None));
        assert!(should_emit_progress(PROGRESS_EVENT_STEP, 0, None));
        assert!(!should_emit_progress(
            PROGRESS_EVENT_STEP + 100,
            PROGRESS_EVENT_STEP,
            None,
        ));
    }

    #[test]
    fn final_short_chunk_is_always_emitted() {
        assert!(should_emit_progress(42_000, 0, Some(42_000)));
        assert!(!should_emit_progress(41_999, 0, Some(42_000)));
    }

    #[test]
    fn progress_difference_cannot_underflow() {
        assert!(!should_emit_progress(100, 200, None));
    }

    #[test]
    fn release_versions_are_compared_semantically() {
        assert!(is_newer_release("0.4.4", "0.5.0").unwrap());
        assert!(is_newer_release("0.9.9", "v0.10.0").unwrap());
        assert!(!is_newer_release("0.5.0", "0.5.0").unwrap());
        assert!(!is_newer_release("0.5.1", "0.5.0").unwrap());
    }

    #[test]
    fn android_apk_link_matches_release_asset_name() {
        assert_eq!(
            android_apk_url("v0.5.0").unwrap(),
            "https://github.com/Torim98/Kiebitz/releases/download/v0.5.0/Kiebitz_0.5.0_arm64.apk"
        );
    }
}
