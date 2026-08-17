package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import de.torim.kiebitz.R

/**
 * „Schnellstart".
 *
 * Vier Ziele: Puzzles, Repertoire, Endspiele, Analyse. Jedes trägt sein Symbol
 * aus der App-Navigation in der Farbe seines Lernbereichs · dieselbe Zuordnung
 * wie im Wochenbudget. In der Zeile (4×1) nebeneinander, im Quadrat (2×2) als
 * Zweierraster. Jedes Ziel ist mindestens 48 dp hoch und öffnet die Seite per
 * Deep Link · gespielt wird in der App.
 *
 * Eine Überschrift trägt dieses Widget nicht: Sie kostet auf beiden Größen
 * genau die Zeile, die den vier Zielen ihre 48 dp gibt, und benennt nur, was
 * die vier Beschriftungen ohnehin sagen. Der Name steht in der Auswahl beim
 * Ablegen.
 */
class QuickStartWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      QuickContent(context, state)
    }
  }

  companion object {
    /** Ab hier stehen Symbol und Wort übereinander statt nebeneinander. */
    val STACK_HEIGHT = 50.dp

    /**
     * Was von einer Kachel für die Beschriftung übrig bleibt.
     *
     * Übereinander bleibt die ganze Breite ohne Polster; nebeneinander gehen
     * Symbol und Abstand ab.
     */
    fun labelRoom(tile: Dp, stacked: Boolean): Dp =
      tile - 8.dp - (if (stacked) 0.dp else 25.dp)

    /**
     * Die Schriftgröße, in der das längste Wort noch ganz dasteht · oder
     * nichts.
     *
     * Gemessen am längsten Wort, das eine der sieben Sprachen für diese vier
     * Ziele hat („Repertoire", „Répertoire", „अंतिम-खेल"). Wo auch die kleinere
     * Stufe nicht reicht, steht das Symbol allein und wird dafür größer:
     * „Repertoi…" ist keine Beschriftung, sondern ein Fehler, den man auf dem
     * Startbildschirm für Absicht hält. Vorlesen lässt sich der ganze Name
     * weiterhin.
     */
    fun labelSize(room: Dp): TextUnit? = when {
      room >= 58.dp -> 11.sp
      room >= 52.dp -> 10.sp
      else -> null
    }
  }
}

@Composable
private fun QuickContent(context: Context, state: WidgetState) {
  // Der Schnellstart zeigt keine Trainingsdaten · ohne Datenstand ist er
  // trotzdem vollständig benutzbar, sobald Plus gilt.
  val snapshot = when (state) {
    is WidgetState.Ready -> state.snapshot
    is WidgetState.Locked -> {
      WidgetPlusPreview(context, localizedContext(context, state.snapshot.locale))
      return
    }

    else -> null
  }
  val strings = snapshot?.let { localizedContext(context, it.locale) } ?: context
  val size = LocalSize.current

  val actions = listOf(
    Triple(R.drawable.ic_widget_puzzles, R.string.widget_quick_puzzles, WidgetLinks.PUZZLES),
    Triple(R.drawable.ic_widget_repertoire, R.string.widget_quick_repertoire, WidgetLinks.REPERTOIRE),
    Triple(R.drawable.ic_widget_endgames, R.string.widget_quick_endgames, WidgetLinks.ENDGAME),
    Triple(R.drawable.ic_widget_analysis, R.string.widget_quick_analysis, WidgetLinks.ANALYSIS),
  )

  // Keine Fläche um die Ziele herum · sie sind selbst die Karten und nehmen die
  // ganze Fläche ein. Eine Karte darum kostete auf jeder Größe genau die
  // Millimeter, die den vier Zielen ihre 48 dp geben, und trüge nichts.
  val gap = 5.dp

  // Eine Zeile oder zwei · entschieden daran, ob zwei Reihen zu 48 dp
  // überhaupt hineinpassen. Der Startbildschirm gibt Höhen aus, die zwischen
  // den Rasterstufen liegen; vorher rutschte auf ihnen die zweite Reihe unter
  // den Rand, weil das Layout an der Zahl „zwei Zellen" hing statt an der Höhe.
  if (size.height < TOUCH_TARGET * 2 + gap) {
    val tile = (size.width - gap * 3) / 4
    val stacked = size.height >= QuickStartWidget.STACK_HEIGHT
    val font = QuickStartWidget.labelSize(QuickStartWidget.labelRoom(tile, stacked))
    Row(modifier = GlanceModifier.fillMaxSize()) {
      actions.forEachIndexed { index, (icon, label, link) ->
        if (index > 0) Spacer(modifier = GlanceModifier.width(gap))
        QuickAction(
          context,
          icon,
          strings.getString(label),
          link,
          GlanceModifier.defaultWeight().fillMaxHeight(),
          fontSize = font,
          stacked = stacked,
          iconSize = iconSize(font, tile, size.height),
        )
      }
    }
    return
  }

  val tile = (size.width - gap) / 2
  val rowHeight = (size.height - gap) / 2
  val stacked = rowHeight >= QuickStartWidget.STACK_HEIGHT
  val font = QuickStartWidget.labelSize(QuickStartWidget.labelRoom(tile, stacked))
  Column(modifier = GlanceModifier.fillMaxSize()) {
    actions.chunked(2).forEachIndexed { rowIndex, pair ->
      if (rowIndex > 0) Spacer(modifier = GlanceModifier.height(gap))
      Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
        pair.forEachIndexed { index, (icon, label, link) ->
          if (index > 0) Spacer(modifier = GlanceModifier.width(gap))
          QuickAction(
            context,
            icon,
            strings.getString(label),
            link,
            GlanceModifier.defaultWeight().fillMaxHeight(),
            fontSize = font,
            stacked = stacked,
            iconSize = iconSize(font, tile, rowHeight),
          )
        }
      }
    }
  }
}

/**
 * Wie groß das Symbol wird.
 *
 * Ohne Beschriftung ist es das Einzige auf der Kachel und darf mehr Fläche
 * nehmen · eine kleine Marke in der Mitte einer leeren Kachel sieht aus wie ein
 * Rest, nicht wie ein Ziel. Nach oben begrenzt es die kürzere Kante.
 */
private fun iconSize(font: TextUnit?, tile: Dp, height: Dp): Dp {
  if (font != null) return if (height >= 70.dp) 22.dp else 18.dp
  val shorter = if (tile.value < height.value) tile else height
  return (shorter * 0.5f).coerceIn(18.dp, 28.dp)
}

class QuickStartWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickStartWidget()
}
