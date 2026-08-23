package de.torim.kiebitz

import android.app.Activity
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/**
 * Das Systemblatt von Android.
 *
 * Die WebView kennt `navigator.share` nicht, anders als ein Browser auf
 * demselben Gerät. Ohne diese Brücke bliebe vom Teilen nur „Link kopieren",
 * und genau der Weg über WhatsApp, Signal und Telegram ist der, um den es hier
 * geht.
 *
 * Das Bild geht als Datei über den FileProvider hinaus, nicht als Datenstrom im
 * Intent: Ein Intent hat ein knappes Größenlimit, eine 1080er PNG-Karte reißt
 * es. Die Datei liegt im Cache; Android räumt ihn selbst auf, und die
 * Empfänger-App bekommt nur für diesen einen Vorgang Leserecht.
 */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun share(invoke: Invoke) {
    val args = invoke.getArgs()
    val title = args.getString("title", "") ?: ""
    val text = args.getString("text", "") ?: ""
    val image = args.getString("image", "") ?: ""
    try {
      val intent = Intent(Intent.ACTION_SEND)
      if (text.isNotEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text)
      if (title.isNotEmpty()) intent.putExtra(Intent.EXTRA_SUBJECT, title)

      val uri = image.takeIf { it.isNotEmpty() }?.let { writeCardToCache(it) }
      if (uri != null) {
        intent.type = "image/png"
        intent.putExtra(Intent.EXTRA_STREAM, uri)
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        // Manche Ziele lesen die Vorschau nur aus dem ClipData.
        intent.clipData = android.content.ClipData.newRawUri(title, uri)
      } else {
        intent.type = "text/plain"
      }

      val chooser = Intent.createChooser(intent, title.ifEmpty { null })
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // Das Blatt gehört auf den UI-Thread; das Schreiben der Datei davor
      // ausdrücklich nicht · Tauri ruft dieses Kommando ohnehin von einem
      // Arbeitsthread aus auf.
      activity.runOnUiThread { activity.startActivity(chooser) }
      invoke.resolve(JSObject().put("shared", true))
    } catch (error: Exception) {
      // Wer teilen wollte und es nicht kann, braucht keinen Absturz, sondern
      // die Ersatzwege der Oberfläche.
      invoke.reject(error.message ?: "Teilen fehlgeschlagen.")
    }
  }

  /**
   * Legt die Karte unter einem stabilen Namen im Cache ab. Ein fester Name
   * statt eines Zeitstempels: So sammeln sich nicht mit jedem Teilen weitere
   * Bilder an, und das zuletzt geteilte bleibt so lange lesbar, wie die
   * Empfänger-App braucht.
   */
  private fun writeCardToCache(base64: String): android.net.Uri {
    val folder = File(activity.cacheDir, "share").apply { mkdirs() }
    val file = File(folder, "kiebitz-position.png")
    file.outputStream().use { it.write(Base64.decode(base64, Base64.DEFAULT)) }
    return FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
  }
}
