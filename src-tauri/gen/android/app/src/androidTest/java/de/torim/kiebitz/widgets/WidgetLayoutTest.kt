package de.torim.kiebitz.widgets

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.text.Layout
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.ExperimentalGlanceRemoteViewsApi
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.compose
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import de.torim.kiebitz.R
import java.io.File
import java.util.Locale

/**
 * Passt, was die Widgets zeigen, in die Fläche, die sie bekommen?
 *
 * Auf dem Startbildschirm gibt es keine Rückmeldung: Was nicht hineinpasst,
 * verschwindet einfach · eine halbe Zeile, ein abgeschnittenes Wort, ein Knopf
 * unterhalb des Randes. Auf dem Bildschirm sieht das nach Absicht aus. Dieser
 * Test baut deshalb jede Kantenlänge wirklich auf, misst sie auf genau ihr Maß
 * und prüft drei Dinge, die man sonst übersieht:
 *
 *  · steht jeder Text vollständig da (senkrecht wie waagerecht),
 *  · liegt alles innerhalb der Fläche,
 *  · ist jedes antippbare Ziel mindestens 48 dp hoch.
 *
 * Gefahren wird das in vier Sprachen und drei Datenständen; nebenbei entstehen
 * PNGs zum Nachsehen.
 *
 * Die Größen sind nicht mehr die drei angemeldeten Rasterpunkte, sondern das,
 * was Startbildschirme wirklich zuteilen · seit `SizeMode.Exact` rechnen die
 * Widgets mit ihrer echten Kantenlänge, und geprüft gehören genau die
 * Zwischengrößen, auf denen das früher schiefging: die 4×1-Zeile etwa ist auf
 * einem fünfspaltigen Startbildschirm gut 40 dp schmaler als das Raster
 * verspricht, und dort passte „Repertoire" nicht mehr in seine Kachel.
 *
 * Hell und Dunkel fährt der Test nicht mehr getrennt: Die Widget-Palette liegt
 * in `values/colors.xml` und hat keine Nachtfassung · es gibt nichts zu
 * unterscheiden.
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

  /**
   * Die Zustände, die eine Fläche zeigen kann.
   *
   * `LEER` ist der, den ein neuer Nutzer am längsten sieht: Plus gilt, aber es
   * ist noch nichts geplant und noch keine Minute gemessen. `OHNE` ist der
   * allererste: Das Widget liegt auf dem Startbildschirm, die App war seit der
   * Installation nicht offen, es gibt noch gar keinen Datenstand. Beide haben
   * ein eigenes Layout · und deshalb gehören sie geprüft wie die anderen.
   */
  private enum class State { VOLL, LEER, GESPERRT, OHNE }

  @Test
  fun todayFitsEverySize() = checkAll(
    "today",
    TodayWidget(),
    mapOf(
      "2x1" to DpSize(110.dp, 48.dp),
      "2x1-breit" to DpSize(180.dp, 48.dp),
      "2x1-hoch" to DpSize(160.dp, 64.dp),
      "2x2" to DpSize(160.dp, 110.dp),
      "3x2" to DpSize(210.dp, 130.dp),
      "4x2" to DpSize(280.dp, 130.dp),
      "4x3" to DpSize(280.dp, 190.dp),
      "4x4" to DpSize(330.dp, 250.dp),
    ),
  )

  @Test
  fun quickStartFitsEverySize() = checkAll(
    "quick",
    QuickStartWidget(),
    mapOf(
      "4x1" to DpSize(280.dp, 48.dp),
      "4x1-schmal" to DpSize(240.dp, 60.dp),
      "4x1-hoch" to DpSize(240.dp, 90.dp),
      "3x1" to DpSize(180.dp, 56.dp),
      "2x2" to DpSize(140.dp, 110.dp),
      "4x2" to DpSize(280.dp, 110.dp),
      "4x3" to DpSize(300.dp, 180.dp),
    ),
  )

  @Test
  fun weekGoalFitsEverySize() = checkAll(
    "week",
    WeekGoalWidget(),
    mapOf(
      "2x1" to DpSize(140.dp, 48.dp),
      "2x1-breit" to DpSize(220.dp, 60.dp),
      "2x2" to DpSize(160.dp, 110.dp),
      "3x2" to DpSize(210.dp, 130.dp),
      "4x2" to DpSize(280.dp, 110.dp),
      "4x3" to DpSize(280.dp, 190.dp),
    ),
  )

  /**
   * Die Vorschauen im Auswahldialog.
   *
   * Sie sind gewöhnliche Layouts und nicht Glance · niemand sieht sie beim
   * Entwickeln, weil sie nur im Auswahldialog auftauchen, und genau dort
   * entscheidet sich, ob jemand das Widget überhaupt ablegt. Geprüft wird
   * dasselbe wie am laufenden Widget: dass jedes Wort ganz dasteht und
   * innerhalb der Fläche liegt.
   */
  @Test
  fun previewLayoutsFit() {
    val previews = mapOf(
      "preview-today" to Triple(R.layout.widget_preview_today, 280.dp, 130.dp),
      "preview-week" to Triple(R.layout.widget_preview_week, 280.dp, 110.dp),
      "preview-quick" to Triple(R.layout.widget_preview_quick, 280.dp, 48.dp),
      "preview-loading" to Triple(R.layout.widget_loading, 160.dp, 110.dp),
    )
    shots.listFiles()?.filter { it.name.startsWith("preview-") }?.forEach { it.delete() }
    val problems = mutableListOf<String>()
    for ((name, entry) in previews) {
      val (layout, width, height) = entry
      for (locale in listOf("de", "fr", "hi", "ar")) {
        val themed = themedContext(locale)
        val frame = FrameLayout(themed)
        frame.layoutDirection =
          if (locale == "ar") View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        LayoutInflater.from(themed).inflate(layout, frame, true)
        val pxWidth = (width.value * density).toInt()
        val pxHeight = (height.value * density).toInt()
        frame.measure(
          View.MeasureSpec.makeMeasureSpec(pxWidth, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(pxHeight, View.MeasureSpec.EXACTLY),
        )
        frame.layout(0, 0, pxWidth, pxHeight)
        val label = "$name-$locale"
        inspect(frame, frame, label, emptyList(), problems)
        save(frame, pxWidth, pxHeight, label)
      }
    }
    assertTrue(
      "${problems.size} Beanstandung(en) · Bilder unter ${shots.absolutePath}\n" +
        problems.joinToString("\n"),
      problems.isEmpty(),
    )
  }

  /**
   * Jede Größe in vier Sprachen und drei Zuständen.
   *
   * Die Sprachen sind mit Absicht die unbequemen: Französisch trägt die
   * längsten Wörter („Répertoire", „Objectif de la semaine"), Hindi baut in
   * Devanagari am höchsten, Arabisch läuft von rechts nach links. Deutsch ist
   * die Sprache, in der entwickelt wird.
   */
  private fun checkAll(name: String, widget: GlanceAppWidget, sizes: Map<String, DpSize>) {
    // Nur die eigenen Bilder wegräumen · die der anderen Widgets stammen aus
    // demselben Lauf und sollen nebeneinander liegen bleiben.
    shots.listFiles()?.filter { it.name.startsWith("$name-") }?.forEach { it.delete() }
    val problems = mutableListOf<String>()
    for ((sizeName, size) in sizes) {
      for (locale in listOf("de", "fr", "hi", "ar")) {
        for (state in State.values()) {
          val label = listOf(name, sizeName, locale, state.name.lowercase()).joinToString("-")
          problems += check(widget, size, locale, state, label)
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
    state: State,
    label: String,
  ): List<String> {
    if (state == State.OHNE) {
      WidgetSnapshotStore.file(context).delete()
    } else {
      WidgetSnapshotStore.write(context, snapshotJson(locale, state))
    }
    val themed = themedContext(locale)
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
    save(frame, width, height, label)
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

  private fun themedContext(locale: String): Context {
    val configuration = Configuration(context.resources.configuration)
    val chosen = Locale.forLanguageTag(locale)
    configuration.setLocale(chosen)
    configuration.setLayoutDirection(chosen)
    return context.createConfigurationContext(configuration)
  }

  /**
   * Der Grund unter dem Bild ist ein mittleres Grau.
   *
   * Die Karte ist dunkel und liegt am Gerät auf einem Hintergrundbild; auf
   * Weiß oder Schwarz wäre auf den PNGs nicht zu sehen, wo ihr Rand verläuft.
   */
  private fun save(view: View, width: Int, height: Int, label: String) {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.rgb(96, 100, 104))
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
  private fun titles(locale: String): List<String> = when (locale) {
    "ar" -> listOf("تكتيكات المرحلة الوسطى", "افتتاحية الملكة الهندية", "نهايات الأبراج")
    "hi" -> listOf("मध्य खेल की रणनीति", "क्वीन्स गैम्बिट रेपर्टवार", "रूक अंतिम-खेल")
    "fr" -> listOf("Tactique en milieu de partie", "Répertoire gambit dame", "Finales de tours")
    else -> listOf("Taktik im Mittelspiel", "Repertoire Damengambit", "Turmendspiele")
  }

  private fun snapshotJson(locale: String, state: State): String {
    // Der leere Zustand ist echt: Plus gilt, aber der Plan ist leer und die
    // Woche hat noch keine gemessene Minute.
    if (state == State.LEER) {
      return """
        {
          "version": 1,
          "generatedAt": 1750000000000,
          "day": "2026-08-15",
          "locale": "$locale",
          "plus": true,
          "today": { "units": [], "openTasks": 2, "doneMinutes": 0, "plannedMinutes": 0 },
          "week": {
            "trainedMinutes": 0,
            "budgetMinutes": 0,
            "remainingMinutes": 0,
            "trainedDays": 0,
            "targetDays": 0
          }
        }
      """.trimIndent()
    }
    // Offene Einheiten zuerst, erledigte danach · genau in dieser Reihenfolge
    // baut die App die Momentaufnahme, und das Widget zeigt die ersten drei.
    val areas = listOf("tactics", "openings", "endgames")
    val units = titles(locale).mapIndexed { index, title ->
      """{"title":"$title","minutes":${20 + index * 5},"done":${index == 2},""" +
        """"area":"${areas[index]}"}"""
    }.joinToString(",")
    return """
      {
        "version": 1,
        "generatedAt": 1750000000000,
        "day": "2026-08-15",
        "locale": "$locale",
        "plus": ${state == State.VOLL},
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
