package de.torim.kiebitz

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.play.core.review.ReviewManagerFactory

@TauriPlugin
class ReviewPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun requestReview(invoke: Invoke) {
    // Play Core erwartet eine sichtbare Activity. Tauri-Kommandos müssen nicht
    // auf dem UI-Thread eintreffen, daher wechseln wir explizit dorthin.
    activity.runOnUiThread {
      try {
        val manager = ReviewManagerFactory.create(activity)
        manager.requestReviewFlow().addOnCompleteListener { request ->
          if (!request.isSuccessful) {
            invoke.resolve(JSObject().put("requested", false))
            return@addOnCompleteListener
          }

          // Play entscheidet selbst, ob der Dialog innerhalb seines Kontingents
          // wirklich erscheint. Auch ein erfolgreich beendeter Task verrät
          // deshalb weder Anzeige noch abgegebene Bewertung.
          manager.launchReviewFlow(activity, request.result).addOnCompleteListener {
            invoke.resolve(JSObject().put("requested", true))
          }
        }
      } catch (_: Exception) {
        // Ein Review darf den Erfolgsmoment niemals mit einer Fehlermeldung
        // überschatten. Ein Fehlschlag bleibt für einen späteren Versuch offen.
        invoke.resolve(JSObject().put("requested", false))
      }
    }
  }
}
