//! Sichere Ablage der Konto- und Berechtigungstoken.
//!
//! Zwei Werte, mehr nicht: die Bearer-Sitzung des Kontos und der zuletzt
//! geprüfte, signierte Entitlement-Token samt öffentlichem Schlüsselsatz.
//! Keine Schachdaten, keine Einstellungen, keine Analysen.
//!
//! Abgelegt wird dort, wo das jeweilige System Geheimnisse hinlegt: Windows
//! Credential Manager, macOS-Schlüsselbund, Secret Service unter Linux und der
//! Android Keystore auf dem Telefon. Eine Klartextdatei im App-Verzeichnis wäre
//! für jedes andere Programm desselben Benutzerkontos lesbar und kommt deshalb
//! nicht in Frage.

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};

/// Dienstname im Schlüsselspeicher · identisch mit der App-Kennung.
#[cfg(not(target_os = "android"))]
const SERVICE: &str = "de.torim.kiebitz";

/// Erlaubte Schlüssel. Die Liste ist bewusst geschlossen: Der Aufruf kommt aus
/// der WebView, und ein freier Name machte daraus einen allgemeinen
/// Geheimnisspeicher für beliebigen Frontend-Code.
///
/// `lichess_token` ist der persönliche API-Token für den Eröffnungs-Explorer.
/// Lichess verlangt für dessen Abfragen seit Anfang 2026 eine Anmeldung; der
/// Token gehört damit in dieselbe Ablage wie die übrigen Zugangsdaten und nicht
/// in die settings.json.
///
/// Auf Android führt das Keystore-Plugin dieselbe Liste ein zweites Mal (siehe
/// `ALLOWED_KEYS` in gen/android/…/SecureStorePlugin.kt). Wer hier einen Namen
/// hinzufügt, muss ihn auch dort eintragen · sonst lehnt das Plugin ihn ab, und
/// der Wert kommt auf dem Telefon nie im Keystore an.
const KEYS: [&str; 3] = ["session", "entitlement", "lichess_token"];

fn check_key(key: &str) -> Result<(), String> {
    if KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("Unbekannter Schlüssel: {key}"))
    }
}

#[cfg(not(target_os = "android"))]
fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|error| error.to_string())
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretRequest {
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct SecretResponse {
    value: Option<String>,
}

#[cfg(target_os = "android")]
struct SecureStore<R: Runtime>(PluginHandle<R>);

/// Registriert die native Android-Brücke zum Android Keystore.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-store")
        .setup(|app, api| {
            let handle = api.register_android_plugin("de.torim.kiebitz", "SecureStorePlugin")?;
            app.manage(SecureStore(handle));
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
async fn android_call(
    app: &tauri::AppHandle,
    command: &str,
    request: SecretRequest,
) -> Result<Option<String>, String> {
    let response: SecretResponse = app
        .state::<SecureStore<tauri::Wry>>()
        .0
        .run_mobile_plugin_async(command, request)
        .await
        .map_err(|error| error.to_string())?;
    Ok(response.value)
}

/// Liest ein Geheimnis; `None`, wenn keines abgelegt ist.
#[tauri::command]
pub async fn plus_secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    check_key(&key)?;

    #[cfg(target_os = "android")]
    {
        return android_call(&app, "getSecret", SecretRequest { key, value: None }).await;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || match entry(&key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

/// Legt ein Geheimnis ab und ersetzt ein vorhandenes.
#[tauri::command]
pub async fn plus_secret_set(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    check_key(&key)?;

    #[cfg(target_os = "android")]
    {
        android_call(
            &app,
            "setSecret",
            SecretRequest {
                key,
                value: Some(value),
            },
        )
        .await?;
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || {
            entry(&key)?
                .set_password(&value)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

/// Entfernt ein Geheimnis. Ein fehlender Eintrag ist kein Fehler · das Abmelden
/// soll auch dann durchlaufen, wenn schon nichts mehr da ist.
#[tauri::command]
pub async fn plus_secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    check_key(&key)?;

    #[cfg(target_os = "android")]
    {
        android_call(&app, "deleteSecret", SecretRequest { key, value: None }).await?;
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || match entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_known_keys_are_accepted() {
        assert!(check_key("session").is_ok());
        assert!(check_key("entitlement").is_ok());
        assert!(check_key("lichess_token").is_ok());
        assert!(check_key("../../settings.json").is_err());
        assert!(check_key("").is_err());
    }
}
