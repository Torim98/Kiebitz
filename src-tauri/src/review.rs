use serde::{Deserialize, Serialize};

#[cfg(all(target_os = "android", feature = "play-store"))]
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(all(target_os = "android", feature = "play-store"))]
const PLUGIN_IDENTIFIER: &str = "de.torim.kiebitz";

#[derive(Serialize, Deserialize)]
pub struct ReviewRequestResult {
    requested: bool,
}

#[cfg(all(target_os = "android", feature = "play-store"))]
struct Review<R: Runtime>(PluginHandle<R>);

/// Registriert die kleine native Android-Brücke zur Play In-App-Review-API.
/// Sie wird nur in Play-Store-Builds kompiliert und besitzt absichtlich keinen
/// Start-Hook: wann ein Review passend ist, entscheidet die Erfolgsmoment-
/// Policy im Frontend.
#[cfg(all(target_os = "android", feature = "play-store"))]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("review")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ReviewPlugin")?;
            app.manage(Review(handle));
            Ok(())
        })
        .build()
}

/// App-eigener IPC-Befehl als schmale, ACL-sichere Brücke zum privaten
/// Android-Plugin. Außerhalb des Play-Builds bleibt er ein harmloses No-op.
#[tauri::command]
pub async fn request_play_review(app: tauri::AppHandle) -> Result<ReviewRequestResult, String> {
    #[cfg(all(target_os = "android", feature = "play-store"))]
    {
        return app
            .state::<Review<tauri::Wry>>()
            .0
            .run_mobile_plugin_async("requestReview", ())
            .await
            .map_err(|error| error.to_string());
    }

    #[cfg(not(all(target_os = "android", feature = "play-store")))]
    {
        let _ = app;
        Ok(ReviewRequestResult { requested: false })
    }
}
