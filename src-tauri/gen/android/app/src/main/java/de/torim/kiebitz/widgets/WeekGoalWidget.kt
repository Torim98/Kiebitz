package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
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
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import de.torim.kiebitz.R

/**
 * „Wochenziel".
 *
 * Die Woche als eine Zahl: gemessene Minuten gegen das Budget, darunter der
 * Balken und die Trainingstage als Punkte · gefüllt, was trainiert wurde, offen
 * der Rest. Das ist derselbe Blick wie im Wochenbudget der App, nur auf die
 * Größe einer Kachel gebracht.
 */
class WeekGoalWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      WeekContent(context, state)
    }
  }
}

@Composable
private fun WeekContent(context: Context, state: WidgetState) {
  when (state) {
    is WidgetState.Empty -> WidgetPlaceholder(
      context,
      context,
      context.getString(R.string.widget_week_name),
      context.getString(R.string.widget_week_short),
      context.getString(R.string.widget_empty_no_data),
      WidgetLinks.STUDY,
    )

    is WidgetState.Unreadable -> WidgetPlaceholder(
      context,
      context,
      context.getString(R.string.widget_week_name),
      context.getString(R.string.widget_week_short),
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
  val start = actionStartActivity(openAppIntent(context, WidgetLinks.STUDY))

  val budget = snapshot.budgetMinutes
  val fraction = if (budget > 0) snapshot.trainedMinutes.toFloat() / budget else 0f
  val metric = if (budget > 0) {
    strings.getString(R.string.widget_ratio, snapshot.trainedMinutes, budget)
  } else {
    strings.getString(R.string.widget_minutes, snapshot.trainedMinutes)
  }
  val name = strings.getString(R.string.widget_week_short)
  val remaining = strings.getString(R.string.widget_week_remaining, snapshot.remainingMinutes)
  val days = if (snapshot.targetDays > 0) {
    strings.getString(R.string.widget_week_days, snapshot.trainedDays, snapshot.targetDays)
  } else {
    strings.resources.getQuantityString(
      R.plurals.widget_week_days_open,
      snapshot.trainedDays,
      snapshot.trainedDays,
    )
  }

  // Eine Woche, in der noch keine Minute gemessen wurde, hat keine Kennzahl.
  val quiet = budget == 0 && snapshot.trainedMinutes == 0
  val areas = snapshot.byArea

  if (isCompact()) {
    Column(
      modifier = widgetSurface(horizontal = COMPACT_PADDING, top = 7.dp, bottom = 7.dp)
        .clickable(start)
        .semantics { contentDescription = "$name · $metric · $days" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.Vertical.CenterVertically,
      ) {
        WidgetMark(14.dp)
        Spacer(modifier = GlanceModifier.width(7.dp))
        WidgetHeadline(
          if (quiet) name else metric,
          fontSize = if (size.width >= COMPACT_TRAILING) 14.sp else 12.sp,
        )
        if (size.width >= 200.dp && snapshot.targetDays > 0) {
          Spacer(modifier = GlanceModifier.defaultWeight())
          WidgetDays(snapshot.trainedDays, snapshot.targetDays, dot = 6.dp)
        }
      }
      // Ohne Plan und ohne Minute gibt es nichts zu messen · dann steht dort
      // auch kein leerer Balken, der wie „null Prozent geschafft" aussieht.
      if (size.height >= 46.dp && !quiet) {
        Spacer(modifier = GlanceModifier.height(7.dp))
        WidgetAreaBar(
          areas,
          scale = budget,
          width = innerWidth(size, COMPACT_PADDING),
          height = 6.dp,
          fallback = fraction,
        )
      }
    }
    return
  }

  val inner = innerWidth(size, SURFACE_PADDING)
  val headline = headlineSize(size)

  // Die Trainingstage stehen oben neben dem Namen, sobald die Zeile sie trägt ·
  // dann bleibt unten Platz für den Rest der Woche. Auf schmalen Flächen
  // wandern sie nach unten, und der Rest entfällt: Er steht ohnehin im
  // Verhältnis darüber, die Tage stehen nirgends sonst.
  val daysAbove = size.width >= 240.dp && snapshot.targetDays > 0 && !quiet

  // Ob unter dem Balken noch eine Zeile bleibt · sonst endet die Karte mit ihm.
  val footRoom = size.height - surfaceTop(size.height) - surfaceBottom(size.height) -
    HEADER_ROW - 8.dp - (headline.value * lineFactor(snapshot.locale)).dp - 8.dp - 8.dp - 6.dp
  val foot = footRoom >= 19.dp

  // Was der Balken zeigt, steht darunter im Klartext · aber nur, wo wirklich
  // Platz dafür ist. Vorher endete die Karte hier mit einer Bildunterschrift
  // und darunter kam eine halbe Kachelhöhe Nichts; die Legende füllt sie mit
  // der einzigen Auskunft, die diese Woche sonst nirgends gibt: woraus sie
  // bestand. Eine Zeile bleibt für die Fußzeile reserviert.
  val legendRoom = footRoom - (if (foot) LEGEND_ROW else 0.dp)
  val legend = if (quiet) emptyList() else areas.take(
    (legendRoom / LEGEND_ROW).toInt().coerceIn(0, 4)
  )

  Column(
    modifier = widgetSurface(top = surfaceTop(size.height), bottom = surfaceBottom(size.height))
      .clickable(start)
  ) {
    WidgetHeader(
      name,
      trailingContent = if (daysAbove) {
        {
          Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
            WidgetDays(snapshot.trainedDays, snapshot.targetDays)
            Spacer(modifier = GlanceModifier.width(9.dp))
            WidgetCaption(days)
          }
        }
      } else {
        null
      },
    )

    if (quiet) {
      Spacer(modifier = GlanceModifier.defaultWeight())
      WidgetBody(
        strings.getString(R.string.widget_week_none),
        maxLines = 2,
        color = WidgetColors.ink2,
      )
      Spacer(modifier = GlanceModifier.defaultWeight())
      // Der Weg in die App gehört auch in den leeren Zustand · als Knopf, wo
      // einer hineinpasst, sonst als eine Zeile in der Akzentfarbe. Eine Karte,
      // die nur mitteilt, dass nichts da ist, ist der Grund, warum Widgets
      // nichtssagend wirken.
      if (size.height >= ROOMY_HEIGHT) {
        WidgetAccentAction(
          strings.getString(R.string.widget_open_app),
          height = actionHeight(size.height),
        )
      } else {
        WidgetCaption(strings.getString(R.string.widget_open_app), color = WidgetColors.accent)
      }
      return@Column
    }

    // Kennzahl, Balken und die Zeile darunter bleiben beieinander und stehen
    // zusammen in der Mitte dessen, was die Karte hergibt · auf einer hohen
    // Fläche klebte der Block sonst oben und die letzte Zeile ganz unten am
    // Rand, mit einem Loch dazwischen.
    Spacer(modifier = GlanceModifier.defaultWeight())
    WidgetHeadline(metric, fontSize = headline)
    Spacer(modifier = GlanceModifier.height(8.dp))
    WidgetAreaBar(areas, scale = budget, width = inner, fallback = fraction)
    if (foot) {
      Spacer(modifier = GlanceModifier.height(6.dp))
      WidgetCaption(if (daysAbove) remaining else days)
    }
    Spacer(modifier = GlanceModifier.defaultWeight())
    legend.forEach { entry ->
      WidgetAreaRow(entry, strings, modifier = GlanceModifier.fillMaxWidth().defaultWeight())
    }
  }
}

/**
 * Womit eine Legendenzeile veranschlagt wird.
 *
 * Reichlich, wie die Einheitszeile im Tages-Widget: In Devanagari und Arabisch
 * baut dieselbe Schriftgröße höher, und die Zeile, die dadurch nicht mehr
 * passt, ist immer die unterste.
 */
private val LEGEND_ROW = 22.dp

class WeekGoalWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = WeekGoalWidget()
}
