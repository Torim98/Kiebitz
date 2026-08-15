package de.torim.kiebitz.widgets

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.text.Layout
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.glance.appwidget.ExperimentalGlanceRemoteViewsApi
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.compose
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Locale

/**
 * Passt, was die Widgets zeigen, in die Fläche, die sie bekommen?
 *
 * Auf dem Startbildschirm gibt es keine Rückmeldung: Was nicht hineinpasst,
 * verschwindet einfach · eine halbe Zeile, ein abgeschnittenes Wort, ein Knopf
 * unterhalb des Randes. Auf dem Bildschirm sieht das nach Absicht aus. Dieser
 * Test baut deshalb jede angemeldete Größe wirklich auf, misst sie auf genau
 * ihre Kantenlänge und prüft drei Dinge, die man sonst übersieht:
 *
 *  · steht jeder Text vollständig da (senkrecht wie waagerecht),
 *  · liegt alles innerhalb der Fläche,
 *  · ist jedes antippbare Ziel mindestens 48 dp hoch.
 *
 * Gefahren wird das in zwei Sprachen mit gegenläufiger Schreibrichtung und in
 * Hell wie Dunkel; nebenbei entstehen PNGs zum Nachsehen.
 */
@RunWith(AndroidJUnit4::class)
class WidgetLayoutTest {

  private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
  private val density = context.resources.displayMetrics.density
  private val touchTarget = (48 * density).toInt()

  /** Alles, was gemeldet wird, landet auch als Bild · zum Nachsehen von Hand. */
  private val shots: File by lazy {
    File(context.getExternalFilesDir(null), "widget-shots").apply { mkdirs() }
  }

  @Test
  fun todayFitsEverySize() = checkAll(
    "today",
    TodayWidget(),
    mapOf(
      "2x1" to TodayWidget.SMALL,
      "2x2" to TodayWidget.MEDIUM,
      "4x2" to TodayWidget.LARGE,
    ),
  )

  @Test
  fun quickStartFitsEverySize() = checkAll(
    "quick",
    QuickStartWidget(),
    mapOf(
      "4x1" to QuickStartWidget.ROW,
      "2x2" to QuickStartWidget.SQUARE,
    ),
  )

  @Test
  fun weekGoalFitsEverySize() = checkAll(
    "week",
    WeekGoalWidget(),
    mapOf(
      "2x2" to WeekGoalWidget.MEDIUM,
      "4x2" to WeekGoalWidget.LARGE,
    ),
  )

  /**
   * Jede Größe in beiden Sprachen, beiden Themen und beiden Plus-Zuständen.
   *
   * Der gesperrte Zustand ist kein Sonderfall, sondern der, den ein neuer Nutzer
   * zuerst sieht · seine Vorschau muss genauso vollständig hineinpassen wie die
   * freigeschaltete Anzeige.
   */
  private fun checkAll(name: String, widget: GlanceAppWidget, sizes: Map<String, DpSize>) {
    // Nur die eigenen Bilder wegräumen · die der anderen Widgets stammen aus
    // demselben Lauf und sollen nebeneinander liegen bleiben.
    shots.listFiles()?.filter { it.name.startsWith("$name-") }?.forEach { it.delete() }
    val problems = mutableListOf<String>()
    for ((sizeName, size) in sizes) {
      for (locale in listOf("de", "ar")) {
        for (night in listOf(false, true)) {
          for (plus in listOf(true, false)) {
            val label = listOf(
              name,
              sizeName,
              locale,
              if (night) "dark" else "light",
              if (plus) "plus" else "locked",
            ).joinToString("-")
            problems += check(widget, size, locale, night, plus, label)
          }
        }
      }
    }
    assertTrue(
      "${problems.size} Beanstandung(en) · Bilder unter ${shots.absolutePath}\n" +
        problems.joinToString("\n"),
      problems.isEmpty(),
    )
  }

  @OptIn(ExperimentalGlanceRemoteViewsApi::class)
  private fun check(
    widget: GlanceAppWidget,
    size: DpSize,
    locale: String,
    night: Boolean,
    plus: Boolean,
    label: String,
  ): List<String> {
    WidgetSnapshotStore.write(context, snapshotJson(locale, plus))
    val themed = themedContext(locale, night)
    val rightToLeft = locale == "ar"

    val remoteViews = runBlocking { widget.compose(context = themed, size = size) }
    val width = (size.width.value * density).toInt()
    val height = (size.height.value * density).toInt()

    // Ohne Elternteil bleibt die Schreibrichtung auf „von links“ stehen, auch
    // in arabischem Kontext · dann liefe der arabische Durchgang durch ein
    // lateinisches Layout und prüfte genau das nicht, wofür er da ist. Am Gerät
    // gibt der Startbildschirm die Richtung vor, hier also von Hand.
    val direction = if (rightToLeft) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
    val frame = FrameLayout(themed)
    frame.layoutDirection = direction
    val inflated = remoteViews.apply(themed, frame)
    inflated.layoutDirection = direction
    frame.addView(inflated)
    frame.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
    )
    frame.layout(0, 0, width, height)

    val problems = mutableListOf<String>()
    inspect(frame, frame, label, titles(locale), problems)
    save(frame, width, height, night, label)
    return problems
  }

  /** Läuft den Baum ab und sammelt, was nicht hineinpasst. */
  private fun inspect(
    view: View,
    root: View,
    label: String,
    titles: List<String>,
    problems: MutableList<String>,
  ) {
    val bounds = boundsIn(view, root)
    if (view.hasOnClickListeners() && view.height in 1 until touchTarget) {
      problems += "$label: Ziel nur ${px(view.height)} dp hoch (mindestens 48 dp)"
    }
    if (view is TextView && view.text.isNotEmpty()) {
      problems += textProblems(view, root, bounds, label, titles)
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        inspect(view.getChildAt(index), root, label, titles, problems)
      }
    }
  }

  /**
   * Selbst gewählte Titel dürfen mit Auslassung enden.
   *
   * Wie eine Einheit heißt, bestimmt der Nutzer · dafür gibt es keine Breite,
   * die immer reicht, und die Auslassung ist die richtige Antwort darauf. Für
   * alles, was Kiebitz selbst schreibt, gilt das nicht: Dort ist ein
   * abgeschnittenes Wort ein Fehler im Layout, kein Zeichen an den Leser.
   */
  private fun mayShorten(text: String, titles: List<String>): Boolean {
    val stem = text.trimEnd('…', '.', ' ')
    return stem.isNotEmpty() && titles.any { it.startsWith(stem) }
  }

  private fun textProblems(
    view: TextView,
    root: View,
    bounds: IntArray,
    label: String,
    titles: List<String>,
  ): List<String> {
    val text = view.text.toString()
    val layout = view.layout ?: return listOf("$label: „$text\" wurde nicht gesetzt")
    val problems = mutableListOf<String>()
    val innerHeight = view.height - view.paddingTop - view.paddingBottom
    val innerWidth = view.width - view.paddingLeft - view.paddingRight
    val free = mayShorten(text, titles)

    if (layout.height > innerHeight) {
      problems += "$label: „$text\" ist ${px(layout.height)} dp hoch, hat aber ${px(innerHeight)} dp"
    }
    if (!free) {
      if (view.maxLines <= 1) {
        val desired = Layout.getDesiredWidth(view.text, view.paint)
        if (desired > innerWidth + 0.5f) {
          problems +=
            "$label: „$text\" braucht ${px(desired.toInt())} dp, hat aber ${px(innerWidth)} dp"
        }
      } else {
        val laidOut = layout.getLineEnd(layout.lineCount - 1)
        if (laidOut < text.length) problems += "$label: „$text\" bricht nach $laidOut Zeichen ab"
      }
      for (line in 0 until layout.lineCount) {
        if (layout.getEllipsisCount(line) > 0) problems += "$label: „$text\" wird gekürzt"
      }
    }
    if (bounds[1] < 0 || bounds[1] + view.height > root.height) {
      problems += "$label: „$text\" liegt senkrecht außerhalb der Fläche"
    }
    if (bounds[0] < 0 || bounds[0] + view.width > root.width) {
      problems += "$label: „$text\" liegt waagerecht außerhalb der Fläche"
    }
    return problems
  }

  private fun boundsIn(view: View, root: View): IntArray {
    var left = 0
    var top = 0
    var current: View? = view
    while (current != null && current !== root) {
      left += current.left
      top += current.top
      current = current.parent as? View
    }
    return intArrayOf(left, top)
  }

  private fun px(value: Int): Int = (value / density).toInt()

  private fun themedContext(locale: String, night: Boolean): Context {
    val configuration = Configuration(context.resources.configuration)
    val chosen = Locale.forLanguageTag(locale)
    configuration.setLocale(chosen)
    configuration.setLayoutDirection(chosen)
    configuration.uiMode = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
      if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
    return context.createConfigurationContext(configuration)
  }

  private fun save(view: View, width: Int, height: Int, night: Boolean, label: String) {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(if (night) Color.rgb(20, 20, 22) else Color.rgb(236, 238, 240))
    view.draw(Canvas(bitmap))
    File(shots, "$label.png").outputStream().use {
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
    }
  }

  /**
   * Ein Datenstand mit den längsten Angaben, die realistisch vorkommen.
   *
   * Kurze Beispielwerte würden überall passen und nichts beweisen · geprüft
   * gehört der ungünstige Fall.
   */
  private fun titles(locale: String): List<String> = if (locale == "ar") {
    listOf("تكتيكات المرحلة الوسطى", "افتتاحية الملكة الهندية", "نهايات الأبراج")
  } else {
    listOf("Taktik im Mittelspiel", "Repertoire Damengambit", "Turmendspiele")
  }

  private fun snapshotJson(locale: String, plus: Boolean): String {
    val units = titles(locale).mapIndexed { index, title ->
      """{"title":"$title","minutes":${20 + index * 5},"done":${index == 0}}"""
    }.joinToString(",")
    return """
      {
        "version": 1,
        "generatedAt": 1750000000000,
        "day": "2026-08-15",
        "locale": "$locale",
        "plus": $plus,
        "today": {
          "units": [$units],
          "openTasks": 2,
          "doneMinutes": 20,
          "plannedMinutes": 65
        },
        "week": {
          "trainedMinutes": 185,
          "budgetMinutes": 240,
          "remainingMinutes": 55,
          "trainedDays": 4,
          "targetDays": 5
        }
      }
    """.trimIndent()
  }
}
