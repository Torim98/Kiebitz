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
 * „Wochenziel".
 *
 * Die Woche als eine Zahl: gemessene Minuten gegen das Budget, was noch offen
 * ist und an wie vielen Tagen trainiert wurde. Auf der breiten Fläche stehen
 * Rest und Tage nebeneinander statt untereinander.
 */
class WeekGoalWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Responsive(setOf(MEDIUM, LARGE))

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      GlanceTheme {
        WeekContent(context, state)
      }
    }
  }

  companion object {
    /** 2×2. */
    val MEDIUM = DpSize(160.dp, 110.dp)

    /** 4×2. */
    val LARGE = DpSize(280.dp, 110.dp)
  }
}

@Composable
private fun WeekContent(context: Context, state: WidgetState) {
  when (state) {
    is WidgetState.Empty -> WidgetPlaceholder(
      context,
      context.getString(R.string.widget_week_name),
      context.getString(R.string.widget_empty_no_data),
      WidgetLinks.STUDY,
    )

    is WidgetState.Unreadable -> WidgetPlaceholder(
      context,
      context.getString(R.string.widget_week_name),
      context.getString(R.string.widget_error_body),
      WidgetLinks.STUDY,
    )

    is WidgetState.Locked -> WidgetPlusPreview(context, localizedContext(context, state.snapshot.locale))
    is WidgetState.Ready -> WeekReady(context, state.snapshot)
  }
}

@Composable
private fun WeekReady(context: Context, snapshot: WidgetSnapshot) {
  val strings = localizedContext(context, snapshot.locale)
  val size = LocalSize.current
  val budget = snapshot.budgetMinutes
  val fraction = if (budget > 0) snapshot.trainedMinutes.toFloat() / budget else 0f

  Column(
    modifier = widgetSurface().clickable(
      actionStartActivity(openAppIntent(context, WidgetLinks.STUDY))
    ),
  ) {
    WidgetTitle(strings.getString(R.string.widget_week_name))
    Spacer(modifier = GlanceModifier.height(2.dp))
    WidgetHeadline(
      if (budget > 0) {
        strings.getString(R.string.widget_week_ratio, snapshot.trainedMinutes, budget)
      } else {
        strings.getString(R.string.widget_minutes, snapshot.trainedMinutes)
      }
    )
    Spacer(modifier = GlanceModifier.height(8.dp))
    WidgetProgress(fraction, width = if (size.width >= 240.dp) 240 else 130)
    Spacer(modifier = GlanceModifier.height(8.dp))

    val remaining = strings.getString(R.string.widget_week_remaining, snapshot.remainingMinutes)
    val days = if (snapshot.targetDays > 0) {
      strings.getString(R.string.widget_week_days, snapshot.trainedDays, snapshot.targetDays)
    } else {
      strings.getString(R.string.widget_week_days_open, snapshot.trainedDays)
    }

    if (size.width >= 240.dp) {
      Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.Vertical.CenterVertically,
      ) {
        WidgetCaption(remaining)
        Spacer(modifier = GlanceModifier.width(12.dp))
        WidgetCaption(days)
      }
    } else {
      WidgetCaption(remaining)
      Spacer(modifier = GlanceModifier.height(2.dp))
      WidgetCaption(days)
    }
  }
}

class WeekGoalWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = WeekGoalWidget()
}
