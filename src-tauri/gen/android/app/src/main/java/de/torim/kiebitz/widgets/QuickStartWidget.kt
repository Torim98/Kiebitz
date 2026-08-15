package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
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
    /** 4×1. */
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
  val size = LocalSize.current

  val actions = listOf(
    strings.getString(R.string.widget_quick_puzzles) to WidgetLinks.PUZZLES,
    strings.getString(R.string.widget_quick_repertoire) to WidgetLinks.REPERTOIRE,
    strings.getString(R.string.widget_quick_endgames) to WidgetLinks.ENDGAME,
    strings.getString(R.string.widget_quick_analysis) to WidgetLinks.ANALYSIS,
  )

  Column(modifier = widgetSurface()) {
    WidgetTitle(strings.getString(R.string.widget_quick_name))
    Spacer(modifier = GlanceModifier.height(6.dp))
    if (size.height < 90.dp) {
      Row(modifier = GlanceModifier.fillMaxWidth()) {
        actions.forEachIndexed { index, (label, link) ->
          if (index > 0) Spacer(modifier = GlanceModifier.width(6.dp))
          QuickAction(context, label, link, GlanceModifier.defaultWeight())
        }
      }
    } else {
      actions.chunked(2).forEachIndexed { rowIndex, pair ->
        if (rowIndex > 0) Spacer(modifier = GlanceModifier.height(6.dp))
        Row(modifier = GlanceModifier.fillMaxWidth()) {
          pair.forEachIndexed { index, (label, link) ->
            if (index > 0) Spacer(modifier = GlanceModifier.width(6.dp))
            QuickAction(context, label, link, GlanceModifier.defaultWeight())
          }
        }
      }
    }
  }
}

class QuickStartWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuickStartWidget()
}
