use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "de.torim.kiebitz";

/// Position des nativen Android-Banners in physischen Fensterpixeln.
///
/// Das React-Frontend reserviert den Platz im normalen Layout. Die native
/// Google-AdView wird exakt darüber gelegt; so bleibt die Tauri-WebView selbst
/// unangetastet und die Anzeige kann trotzdem das offizielle Mobile-Ads-SDK
/// verwenden.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdBannerRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub visible: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AdBannerResult {
    pub available: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrivacyOptionsResult {
    pub shown: bool,
}

#[cfg(target_os = "android")]
struct Ads<R: Runtime>(PluginHandle<R>);

/// Registriert die kleine native Android-Brücke zu Google Mobile Ads und UMP.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ads")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AdsPlugin")?;
            app.manage(Ads(handle));
            Ok(())
        })
        .build()
}

/// Zeigt, verschiebt oder entfernt das native Android-Banner. Auf Desktop ist
/// die Anzeige ein Frontend-Frame eines ausdrücklich zugelassenen Providers;
/// dort bleibt dieser Befehl ein harmloser No-op.
#[tauri::command]
pub async fn set_ad_banner(
    app: tauri::AppHandle,
    rect: AdBannerRect,
) -> Result<AdBannerResult, String> {
    #[cfg(target_os = "android")]
    {
        return app
            .state::<Ads<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("setBanner", rect)
            .await
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, rect);
        Ok(AdBannerResult { available: false })
    }
}

/// Öffnet die von Google UMP bereitgestellten Datenschutzoptionen erneut.
#[tauri::command]
pub async fn show_ad_privacy_options(
    app: tauri::AppHandle,
) -> Result<PrivacyOptionsResult, String> {
    #[cfg(target_os = "android")]
    {
        return app
            .state::<Ads<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("showPrivacyOptions", ())
            .await
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(PrivacyOptionsResult { shown: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_rect_uses_mobile_plugin_field_names() {
        let json = serde_json::to_value(AdBannerRect {
            left: 1,
            top: 2,
            width: 320,
            height: 50,
            visible: true,
        })
        .unwrap();
        assert_eq!(json["left"], 1);
        assert_eq!(json["height"], 50);
        assert_eq!(json["visible"], true);
    }
}
