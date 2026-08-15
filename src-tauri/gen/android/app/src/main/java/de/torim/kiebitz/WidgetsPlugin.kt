package de.torim.kiebitz

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import de.torim.kiebitz.widgets.QuickStartWidget
import de.torim.kiebitz.widgets.TodayWidget
import de.torim.kiebitz.widgets.WeekGoalWidget
import de.torim.kiebitz.widgets.WidgetSnapshotStore
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Brücke zwischen App und Homescreen-Widgets.
 *
 * Die App legt ihren Datenstand ab und lässt die Widgets neu zeichnen. Der Ort
 * der Datei bestimmt diese Seite selbst · so muss der Rust-Teil ihn nicht
 * erraten, und beide lesen garantiert dasselbe Verzeichnis.
 *
 * Aktualisiert wird nur auf Anforderung: nach einer relevanten App-Aktion,
 * beim Tageswechsel und von Hand. Es läuft kein Takt im Hintergrund.
 */
@TauriPlugin
class WidgetsPlugin(private val activity: Activity) : Plugin(activity) {
  private val scope = CoroutineScope(Dispatchers.IO)

  @Command
  fun writeSnapshot(invoke: Invoke) {
    val json = invoke.getArgs().getString("json", "")
    if (json.isNullOrBlank()) {
      invoke.reject("Kein Datenstand übergeben.")
      return
    }
    val context = activity.applicationContext
    scope.launch {
      val updated = try {
        WidgetSnapshotStore.write(context, json)
        val manager = GlanceAppWidgetManager(context)
        val count = manager.getGlanceIds(TodayWidget::class.java).size +
          manager.getGlanceIds(WeekGoalWidget::class.java).size +
          manager.getGlanceIds(QuickStartWidget::class.java).size
        TodayWidget().updateAll(context)
        WeekGoalWidget().updateAll(context)
        QuickStartWidget().updateAll(context)
        count
      } catch (error: Exception) {
        invoke.reject("Der Widget-Datenstand konnte nicht abgelegt werden.")
        return@launch
      }
      invoke.resolve(JSObject().apply { put("updated", updated) })
    }
  }
}
