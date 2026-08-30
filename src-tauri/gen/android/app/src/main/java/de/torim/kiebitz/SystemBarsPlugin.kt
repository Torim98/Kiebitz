package de.torim.kiebitz

import android.app.Activity
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Status- und Navigationsleiste im Thema der App.
 *
 * Kiebitz zeichnet randlos (`enableEdgeToEdge` in MainActivity), der Grund der
 * Seite steht also hinter beiden Leisten. Offen bleibt nur, ob Uhrzeit und
 * Symbole dunkel oder hell gezeichnet werden — das richtet sich sonst nach dem
 * Nachtmodus des Geräts und nicht nach dem gewählten Thema. Ein helles Thema
 * auf einem dunkel gestellten Gerät hatte deshalb weiße Symbole auf hellem
 * Grund, also nichts Lesbares.
 *
 * Farben nimmt diese Seite bewusst keine entgegen: Ab Android 15 ignoriert das
 * System `statusBarColor` im randlosen Betrieb, die Fläche kommt ohnehin aus
 * dem Webview.
 */
@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setAppearance(invoke: Invoke) {
    val dark = invoke.getArgs().getBoolean("dark", true)
    // Der Insets-Controller gehört dem UI-Thread. Tauri-Kommandos müssen dort
    // nicht eintreffen, also wechseln wir ausdrücklich hinüber.
    activity.runOnUiThread {
      val applied = try {
        val window = activity.window
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        // "Hell" meint hier die Leiste, nicht die Schrift: dunkle Symbole auf
        // heller Fläche.
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
        true
      } catch (_: Exception) {
        // Ohne Fenster gibt es nichts zu färben · ein Themenwechsel ist kein
        // Anlass für eine Fehlermeldung auf dem Bildschirm.
        false
      }
      invoke.resolve(JSObject().put("applied", applied))
    }
  }
}
