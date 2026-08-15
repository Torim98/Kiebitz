package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import de.torim.kiebitz.R

/**
 * „Heute trainieren".
 *
 * Klein: was als Nächstes ansteht und wie viel offen ist. Mittel: dazu der
 * Tagesfortschritt. Groß: bis zu drei Einheiten des Tages. Alle Angaben kommen
 * aus der lokalen Momentaufnahme; gerechnet wird im Widget nichts.
 */
class TodayWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(
    setOf(SMALL, MEDIUM, LARGE)
  )

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      GlanceTheme {
        TodayContent(context, state)
      }
    }
  }

  companion object {
    /** 2×1 · nur die nächste Einheit. */
    val SMALL = DpSize(110.dp, 48.dp)

    /** 2×2 · zusätzlich der Tagesfortschritt. */
    val MEDIUM = DpSize(160.dp, 110.dp)

    /** 4×2 · bis zu drei Einheiten. */
    val LARGE = DpSize(280.dp, 110.dp)
  }
}

@Composable
private fun TodayContent(context: Context, state: WidgetState) {
  when (state) {
    is WidgetState.Empty -> WidgetPlaceholder(
      context,
      context.getString(R.string.widget_today_name),
      context.getString(R.string.widget_empty_no_data),
      WidgetLinks.STUDY,
    )

    is WidgetState.Unreadable -> WidgetPlaceholder(
      context,
      context.getString(R.string.widget_today_name),
      context.getString(R.string.widget_error_body),
      WidgetLinks.STUDY,
    )

    is WidgetState.Locked -> WidgetPlusPreview(context, localizedContext(context, state.snapshot.locale))
    is WidgetState.Ready -> TodayReady(context, state.snapshot)
  }
}

@Composable
private fun TodayReady(context: Context, snapshot: WidgetSnapshot) {
  val strings = localizedContext(context, snapshot.locale)
  val size = LocalSize.current
  val next = snapshot.units.firstOrNull { !it.done }
  val headline = next?.title ?: strings.getString(R.string.widget_today_clear)
  val open = strings.getString(R.string.widget_open_tasks, snapshot.openTasks)

  Column(
    modifier = widgetSurface().clickable(
      actionStartActivity(openAppIntent(context, WidgetLinks.STUDY))
    ),
  ) {
    WidgetTitle(strings.getString(R.string.widget_today_name))
    Spacer(modifier = GlanceModifier.height(2.dp))
    WidgetBody(headline, maxLines = if (size.height < 100.dp) 1 else 2)
    Spacer(modifier = GlanceModifier.height(4.dp))
    WidgetCaption(open)

    if (size.height >= 100.dp) {
      Spacer(modifier = GlanceModifier.height(8.dp))
      val planned = snapshot.plannedMinutes
      val fraction = if (planned > 0) snapshot.doneMinutes.toFloat() / planned else 0f
      WidgetProgress(fraction, width = if (size.width >= 240.dp) 240 else 130)
      Spacer(modifier = GlanceModifier.height(4.dp))
      WidgetCaption(
        strings.getString(R.string.widget_progress, snapshot.doneMinutes, planned)
      )
    }

    // Erst ab der großen Fläche steht der ganze Tag da · darunter wäre die
    // Liste nicht kürzer, sondern nur unleserlich.
    if (size.width >= 240.dp && size.height >= 100.dp) {
      Spacer(modifier = GlanceModifier.height(8.dp))
      snapshot.units.take(3).forEach { unit ->
        Row(
          modifier = GlanceModifier.fillMaxWidth(),
          verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
          WidgetCaption(if (unit.done) "✓" else "•")
          Spacer(modifier = GlanceModifier.width(6.dp))
          WidgetCaption(unit.title)
        }
      }
    }
  }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
