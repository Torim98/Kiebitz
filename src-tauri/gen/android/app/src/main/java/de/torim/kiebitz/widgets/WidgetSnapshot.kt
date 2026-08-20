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
  /**
   * Lernbereich der Einheit · „tactics", „openings", „endgames", „analysis",
   * „play" oder leer. Er entscheidet nur über die Farbe des Punktes vor der
   * Zeile; ein unbekannter Wert ist deshalb kein Fehler, sondern grau.
   */
  val area: String,
)

/**
 * Ein offener Posten des Tages.
 *
 * `kind` ist der Schlüssel, nach dem das Widget beschriftet und verlinkt · ein
 * unbekannter Wert ist kein Fehler, sondern eine Zeile, die übersprungen wird.
 * `count` ist 0, wo es nichts zu zählen gibt (Endspiel steht an oder nicht).
 */
data class WidgetTask(
  val kind: String,
  val count: Int,
  val area: String,
)

/** Gemessene Minuten eines Lernbereichs in der laufenden Woche. */
data class WidgetArea(
  val area: String,
  val minutes: Int,
)

data class WidgetSnapshot(
  val generatedAt: Long,
  val day: String,
  val locale: String,
  val plus: Boolean,
  val units: List<WidgetUnit>,
  val openTasks: Int,
  val tasks: List<WidgetTask>,
  val doneMinutes: Int,
  val plannedMinutes: Int,
  val streakDays: Int,
  val trainedMinutes: Int,
  val budgetMinutes: Int,
  val remainingMinutes: Int,
  val trainedDays: Int,
  val targetDays: Int,
  val byArea: List<WidgetArea>,
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
  /**
   * Formate, die dieses Widget lesen kann.
   *
   * Version 1 bleibt dabei, obwohl die App längst 2 schreibt: Nach einem
   * Update liegt bis zum ersten Start noch die alte Datei da, und ein Widget,
   * das dafür „Datenstand nicht lesbar" anzeigt, sieht kaputt aus — dabei
   * fehlen nur die neuen Felder. Der Leser setzt sie leer, und die Kacheln
   * zeigen so viel, wie in der alten Datei steht.
   */
  private val SUPPORTED_VERSIONS = setOf(1, 2)

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
    if (root.optInt("version", 0) !in SUPPORTED_VERSIONS) return null
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
            area = unit.optString("area", ""),
          )
        )
      }
    }
    val tasksJson = today.optJSONArray("tasks")
    val tasks = buildList {
      for (index in 0 until (tasksJson?.length() ?: 0)) {
        val task = tasksJson?.optJSONObject(index) ?: continue
        add(
          WidgetTask(
            kind = task.optString("kind", ""),
            count = task.optInt("count", 0),
            area = task.optString("area", ""),
          )
        )
      }
    }
    val areasJson = week.optJSONArray("byArea")
    val byArea = buildList {
      for (index in 0 until (areasJson?.length() ?: 0)) {
        val area = areasJson?.optJSONObject(index) ?: continue
        val minutes = area.optInt("minutes", 0)
        if (minutes > 0) add(WidgetArea(area = area.optString("area", ""), minutes = minutes))
      }
    }
    return WidgetSnapshot(
      generatedAt = root.optLong("generatedAt", 0L),
      day = root.optString("day", ""),
      locale = root.optString("locale", "en"),
      plus = root.optBoolean("plus", false),
      units = units,
      openTasks = today.optInt("openTasks", 0),
      tasks = tasks,
      doneMinutes = today.optInt("doneMinutes", 0),
      plannedMinutes = today.optInt("plannedMinutes", 0),
      streakDays = today.optInt("streakDays", 0),
      trainedMinutes = week.optInt("trainedMinutes", 0),
      budgetMinutes = week.optInt("budgetMinutes", 0),
      remainingMinutes = week.optInt("remainingMinutes", 0),
      trainedDays = week.optInt("trainedDays", 0),
      targetDays = week.optInt("targetDays", 0),
      byArea = byArea,
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
