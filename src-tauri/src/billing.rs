//! Brücke zu Google Play Billing.
//!
//! Google verlangt für digitale Inhalte innerhalb der App seinen eigenen
//! Bezahlweg. Auf Android läuft der Kauf von Kiebitz Plus deshalb über Play
//! Billing; Stripe bleibt Desktop und Website vorbehalten.
//!
//! Diese Seite reicht nur durch. Der Kauf liefert ein Token, mehr nicht · ob
//! daraus eine Berechtigung wird, entscheidet die API, indem sie das Token
//! gegen Google prüft und in das signierte Entitlement schreibt.
//!
//! Auf allen anderen Plattformen meldet `billing_available` schlicht `false`,
//! und die Oberfläche zeigt dort den Stripe-Weg.

#[cfg(target_os = "android")]
use serde::Deserialize;
use serde::Serialize;

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

/// Obergrenze für ein Play-Kauftoken · die API weist längere ohnehin zurück.
const MAX_PURCHASE_TOKEN_BYTES: usize = 4096;

/// Ausgang eines Kaufversuchs.
#[derive(Serialize)]
#[cfg_attr(target_os = "android", derive(Deserialize))]
pub struct PurchaseOutcome {
    /// `purchased`, `pending` oder `cancelled`.
    pub state: String,
    /// Nur bei `purchased` und `pending` gesetzt.
    #[serde(default)]
    pub purchase_token: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct PurchaseRequest {
    #[serde(rename = "productId")]
    product_id: String,
    #[serde(rename = "accountId")]
    account_id: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct TokenRequest {
    #[serde(rename = "purchaseToken")]
    purchase_token: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct EmptyRequest {}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct AvailableResponse {
    #[serde(default)]
    available: bool,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct RawPurchaseResponse {
    state: String,
    #[serde(rename = "purchaseToken", default)]
    purchase_token: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct RestoreResponse {
    #[serde(default)]
    tokens: Vec<String>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
struct AcknowledgeResponse {
    #[serde(default)]
    acknowledged: bool,
}

#[cfg(target_os = "android")]
struct Billing<R: Runtime>(PluginHandle<R>);

/// Registriert die native Android-Brücke zu Google Play Billing.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("billing")
        .setup(|app, api| {
            let handle = api.register_android_plugin("de.torim.kiebitz", "BillingPlugin")?;
            app.manage(Billing(handle));
            Ok(())
        })
        .build()
}

/// Prüft ein Kauftoken, bevor es weitergereicht wird.
fn validate_token(token: &str) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("Kein Kauf angegeben.".into());
    }
    if token.len() > MAX_PURCHASE_TOKEN_BYTES {
        return Err("Kauftoken ist zu lang.".into());
    }
    Ok(())
}

/// Steht Google Play Billing bereit?
#[tauri::command]
pub async fn billing_available(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let response: AvailableResponse = app
            .state::<Billing<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("isAvailable", EmptyRequest {})
            .await
            .map_err(|error| error.to_string())?;
        return Ok(response.available);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(false)
    }
}

/// Öffnet den Play-Kaufdialog für Kiebitz Plus.
#[tauri::command]
pub async fn billing_purchase(
    app: tauri::AppHandle,
    product_id: String,
    account_id: String,
) -> Result<PurchaseOutcome, String> {
    #[cfg(target_os = "android")]
    {
        let response: RawPurchaseResponse = app
            .state::<Billing<tauri::Wry>>()
            .0
            .run_mobile_plugin_async(
                "purchase",
                PurchaseRequest {
                    product_id,
                    account_id,
                },
            )
            .await
            .map_err(|error| error.to_string())?;
        return Ok(PurchaseOutcome {
            state: response.state,
            purchase_token: response.purchase_token,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, product_id, account_id);
        Err("Google Play Billing gibt es nur auf Android.".into())
    }
}

/// Liefert die Kauftoken der Abos dieses Play-Kontos.
#[tauri::command]
pub async fn billing_restore(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "android")]
    {
        let response: RestoreResponse = app
            .state::<Billing<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("restore", EmptyRequest {})
            .await
            .map_err(|error| error.to_string())?;
        return Ok(response.tokens);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Bestätigt einen Kauf, den die API bereits geprüft hat.
#[tauri::command]
pub async fn billing_acknowledge(
    app: tauri::AppHandle,
    purchase_token: String,
) -> Result<bool, String> {
    validate_token(&purchase_token)?;

    #[cfg(target_os = "android")]
    {
        let response: AcknowledgeResponse = app
            .state::<Billing<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("acknowledge", TokenRequest { purchase_token })
            .await
            .map_err(|error| error.to_string())?;
        return Ok(response.acknowledged);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Google Play Billing gibt es nur auf Android.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plausible_token() {
        assert!(validate_token("dGVzdC1wdXJjaGFzZS10b2tlbg").is_ok());
    }

    #[test]
    fn rejects_what_google_would_reject_anyway() {
        assert!(validate_token("").is_err());
        assert!(validate_token("   ").is_err());
        assert!(validate_token(&"x".repeat(MAX_PURCHASE_TOKEN_BYTES + 1)).is_err());
    }
}
