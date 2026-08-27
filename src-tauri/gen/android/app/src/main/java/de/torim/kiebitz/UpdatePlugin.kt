package de.torim.kiebitz

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Play In-App-Updates.
 *
 * Play-Apps dürfen sich ausschließlich über Play aktualisieren, also kann diese
 * Brücke nicht selbst herunterladen · sie fragt, ob im Store eine neuere
 * Version steht, und übergibt das Aktualisieren an Play.
 *
 * Zwei Wege, in dieser Reihenfolge: Erlaubt Play den sofortigen Ablauf, führt
 * er ganz durch (Play lädt, installiert und startet Kiebitz neu). Wo er nicht
 * erlaubt ist, öffnet der Eintrag im Play Store · dort steht derselbe Knopf.
 * Der halbautomatische Weg („flexible") bleibt bewusst außen vor: Er lädt
 * unsichtbar im Hintergrund und braucht danach eine eigene Aufforderung zum
 * Neustart, also einen zweiten Zustand in der Oberfläche für dasselbe Ziel.
 *
 * Nichts davon darf den Start stören. Jeder Fehlschlag endet in
 * „kein Update bekannt"; die App läuft weiter, und beim nächsten Start wird
 * erneut gefragt.
 */
@TauriPlugin
class UpdatePlugin(private val activity: Activity) : Plugin(activity) {
  /** Anfragecode des Update-Ablaufs · das Ergebnis wertet Kiebitz nicht aus. */
  private val requestCode = 4711

  private fun unavailable(): JSObject =
    JSObject().put("available", false).put("versionCode", 0).put("immediate", false)

  /**
   * Steht im Play Store eine neuere Version?
   *
   * Play kennt nur den Versionscode der neuen Version, nicht ihren Namen ·
   * deshalb reicht die Brücke ihn durch, und die Oberfläche spricht auf
   * Play-Geräten von „einem Update", nicht von einer Versionsnummer.
   */
  @Command
  fun checkUpdate(invoke: Invoke) {
    try {
      val manager = AppUpdateManagerFactory.create(activity)
      manager.appUpdateInfo
        .addOnSuccessListener { info ->
          invoke.resolve(
            JSObject()
              .put("available", isAvailable(info))
              .put("versionCode", info.availableVersionCode())
              .put("immediate", info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
          )
        }
        // Ohne Play-Installation, ohne Netz oder im Testtrack ohne Freigabe
        // scheitert die Abfrage. Das ist kein Fehler, den jemand sehen müsste.
        .addOnFailureListener { invoke.resolve(unavailable()) }
    } catch (_: Exception) {
      invoke.resolve(unavailable())
    }
  }

  /** Übergibt an Play · sofortiger Ablauf, sonst der Eintrag im Store. */
  @Command
  fun startUpdate(invoke: Invoke) {
    try {
      val manager = AppUpdateManagerFactory.create(activity)
      manager.appUpdateInfo
        .addOnSuccessListener { info ->
          val immediate = isAvailable(info) && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
          if (!immediate) {
            invoke.resolve(JSObject().put("started", openStoreListing()))
            return@addOnSuccessListener
          }
          // Play verlangt eine sichtbare Activity, und Tauri-Kommandos treffen
          // nicht zwingend auf dem UI-Thread ein.
          activity.runOnUiThread {
            val started =
              try {
                manager.startUpdateFlowForResult(
                  info,
                  activity,
                  AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                  requestCode,
                )
                true
              } catch (_: Exception) {
                openStoreListing()
              }
            invoke.resolve(JSObject().put("started", started))
          }
        }
        .addOnFailureListener { invoke.resolve(JSObject().put("started", openStoreListing())) }
    } catch (_: Exception) {
      invoke.resolve(JSObject().put("started", openStoreListing()))
    }
  }

  private fun isAvailable(info: AppUpdateInfo): Boolean =
    info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
      // Ein sofortiger Ablauf, der beim letzten Mal unterbrochen wurde, gilt
      // weiter als verfügbares Update · sonst bliebe er für immer halb fertig.
      info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS

  /**
   * Öffnet den Kiebitz-Eintrag im Play Store.
   *
   * `market://` landet direkt in der Play-App. Fehlt sie (Emulator ohne
   * Play-Dienste), bleibt die Web-Adresse.
   */
  private fun openStoreListing(): Boolean {
    val packageName = activity.packageName
    val targets =
      listOf(
        "market://details?id=$packageName",
        "https://play.google.com/store/apps/details?id=$packageName",
      )
    for (target in targets) {
      try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        return true
      } catch (_: ActivityNotFoundException) {
        continue
      } catch (_: Exception) {
        return false
      }
    }
    return false
  }
}
