package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
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
 * Vier Ziele: Puzzles, Repertoire, Endspiele, Analyse. In der Zeile (4×1)
 * nebeneinander, im Quadrat (2×2) als Zweierraster. Jedes Ziel ist mindestens
 * 48 dp hoch und öffnet die Seite per Deep Link · gespielt wird in der App.
 *
 * Eine Überschrift trägt dieses Widget nicht: Sie kostet auf beiden Größen
 * genau die Zeile, die den vier Zielen ihre 48 dp gibt, und benennt nur, was
 * die vier Beschriftungen ohnehin sagen. Der Name steht in der Auswahl beim
 * Ablegen.
 */
class QuickStartWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(ROW, SQUARE))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      GlanceTheme {
        QuickContent(context, state)
      }
    }
  }

  companion object {
    /** 4×1 · vier Ziele nebeneinander, die ganze Höhe ist Zielfläche. */
    val ROW = DpSize(280.dp, 48.dp)

    /** 2×2. */
    val SQUARE = DpSize(140.dp, 110.dp)
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

  val actions = listOf(
    strings.getString(R.string.widget_quick_puzzles) to WidgetLinks.PUZZLES,
    strings.getString(R.string.widget_quick_repertoire) to WidgetLinks.REPERTOIRE,
    strings.getString(R.string.widget_quick_endgames) to WidgetLinks.ENDGAME,
    strings.getString(R.string.widget_quick_analysis) to WidgetLinks.ANALYSIS,
  )

  // 4×1 · keine Fläche darum herum. Die vier Ziele sind selbst die Karten und
  // nehmen die volle Höhe, damit auf 48 dp auch 48 dp antippbar sind.
  if (isCompact()) {
    Row(modifier = GlanceModifier.fillMaxSize()) {
      actions.forEachIndexed { index, (label, link) ->
        if (index > 0) Spacer(modifier = GlanceModifier.width(4.dp))
        QuickAction(
          context,
          label,
          link,
          GlanceModifier.defaultWeight().fillMaxHeight(),
          fontSize = 11.sp,
          horizontalPadding = 4.dp,
        )
      }
    }
    return
  }

  // 2×2 · zwei Reihen zu je 48 dp passen genau, wenn die Fläche darum herum
  // schmal bleibt. Auf 140 dp Breite entscheidet jeder Punkt darüber, ob
  // „Repertoire" noch ganz dasteht.
  Column(modifier = widgetSurface(horizontal = 6.dp, vertical = 4.dp)) {
    actions.chunked(2).forEachIndexed { rowIndex, pair ->
      if (rowIndex > 0) Spacer(modifier = GlanceModifier.height(4.dp))
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        pair.forEachIndexed { index, (label, link) ->
          if (index > 0) Spacer(modifier = GlanceModifier.width(4.dp))
          QuickAction(
            context,
            label,
            link,
            GlanceModifier.defaultWeight().height(TOUCH_TARGET),
            fontSize = 11.sp,
            horizontalPadding = 3.dp,
          )
        }
      }
    }
  }
}

class QuickStartWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickStartWidget()
}
