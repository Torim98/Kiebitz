package de.torim.kiebitz.widgets

import android.content.Context
import android.content.res.Configuration
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Der Datenstand, den die Widgets zeigen.
 *
 * Er entsteht in der App aus lokalen Daten und liegt als kleine JSON-Datei im
 * privaten Verzeichnis. Die Widgets lesen nur diese Datei: keine Datenbank,
 * kein Netz, keine Engine. Fehlt sie oder ist sie unlesbar, zeigen die Widgets
 * ihren Leerzustand statt einer Fehlermeldung.
 */
data class WidgetUnit(
  val title: String,
  val minutes: Int,
  val done: Boolean,
)

data class WidgetSnapshot(
  val generatedAt: Long,
  val day: String,
  val locale: String,
  val plus: Boolean,
  val units: List<WidgetUnit>,
  val openTasks: Int,
  val doneMinutes: Int,
  val plannedMinutes: Int,
  val trainedMinutes: Int,
  val budgetMinutes: Int,
  val remainingMinutes: Int,
  val trainedDays: Int,
  val targetDays: Int,
)

/** Zustand einer Widget-Anzeige · daraus folgt, was gezeichnet wird. */
sealed interface WidgetState {
  /** Noch kein Datenstand · die App war seit der Installation nicht offen. */
  data object Empty : WidgetState

  /** Die Datei ist da, aber nicht lesbar oder aus einer fremden Version. */
  data object Unreadable : WidgetState

  /** Gültiger Datenstand ohne Plus-Berechtigung · datensparsame Vorschau. */
  data class Locked(val snapshot: WidgetSnapshot) : WidgetState

  data class Ready(val snapshot: WidgetSnapshot) : WidgetState
}

object WidgetSnapshotStore {
  const val FILE_NAME = "kiebitz-widget.json"
  private const val SUPPORTED_VERSION = 1

  fun file(context: Context): File = File(context.filesDir, FILE_NAME)

  fun write(context: Context, json: String) {
    file(context).writeText(json, Charsets.UTF_8)
  }

  /** Liest den Datenstand; jeder Fehler endet in einem Anzeigezustand. */
  fun read(context: Context): WidgetState {
    val file = file(context)
    if (!file.exists()) return WidgetState.Empty
    val snapshot = try {
      parse(file.readText(Charsets.UTF_8))
    } catch (error: Exception) {
      null
    } ?: return WidgetState.Unreadable
    return if (snapshot.plus) WidgetState.Ready(snapshot) else WidgetState.Locked(snapshot)
  }

  fun parse(text: String): WidgetSnapshot? {
    val root = JSONObject(text)
    if (root.optInt("version", 0) != SUPPORTED_VERSION) return null
    val today = root.optJSONObject("today") ?: JSONObject()
    val week = root.optJSONObject("week") ?: JSONObject()
    val unitsJson = today.optJSONArray("units")
    val units = buildList {
      for (index in 0 until (unitsJson?.length() ?: 0)) {
        val unit = unitsJson?.optJSONObject(index) ?: continue
        add(
          WidgetUnit(
            title = unit.optString("title", ""),
            minutes = unit.optInt("minutes", 0),
            done = unit.optBoolean("done", false),
          )
        )
      }
    }
    return WidgetSnapshot(
      generatedAt = root.optLong("generatedAt", 0L),
      day = root.optString("day", ""),
      locale = root.optString("locale", "en"),
      plus = root.optBoolean("plus", false),
      units = units,
      openTasks = today.optInt("openTasks", 0),
      doneMinutes = today.optInt("doneMinutes", 0),
      plannedMinutes = today.optInt("plannedMinutes", 0),
      trainedMinutes = week.optInt("trainedMinutes", 0),
      budgetMinutes = week.optInt("budgetMinutes", 0),
      remainingMinutes = week.optInt("remainingMinutes", 0),
      trainedDays = week.optInt("trainedDays", 0),
      targetDays = week.optInt("targetDays", 0),
    )
  }
}

/**
 * Kontext in der Sprache der App.
 *
 * Die Sprache ist eine Einstellung von Kiebitz und nicht zwingend die des
 * Systems. Ein Widget, das plötzlich Englisch spricht, während die App
 * Arabisch steht, wäre schlicht falsch · deshalb kommt die Sprache aus dem
 * Datenstand, samt Schreibrichtung.
 */
fun localizedContext(context: Context, tag: String): Context {
  val locale = runCatching { Locale.forLanguageTag(tag) }.getOrNull()
    ?: return context
  if (locale.language.isEmpty()) return context
  val configuration = Configuration(context.resources.configuration)
  configuration.setLocale(locale)
  configuration.setLayoutDirection(locale)
  return context.createConfigurationContext(configuration)
}
