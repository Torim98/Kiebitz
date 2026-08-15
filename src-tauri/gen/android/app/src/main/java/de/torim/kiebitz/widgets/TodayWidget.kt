package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
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
    /** 2×1 · die ganze Fläche ist ein Ziel und trägt nur die nächste Einheit. */
    val SMALL = DpSize(110.dp, 48.dp)

    /** 2×2 · zusätzlich der Tagesfortschritt. */
    val MEDIUM = DpSize(160.dp, 110.dp)

    /**
     * 4×2 · bis zu drei Einheiten.
     *
     * Drei Zeilen brauchen mehr als 110 dp, sobald die Schrift höher baut als
     * im Deutschen · in arabischer Schrift etwa. Die Schwelle liegt deshalb
     * über der Höhe von 2×2, aber unter der eines echten 4×2-Feldes.
     */
    val LARGE = DpSize(280.dp, 130.dp)
  }
}

@Composable
private fun TodayContent(context: Context, state: WidgetState) {
  when (state) {
    is WidgetState.Empty -> WidgetPlaceholder(
      context,
      context,
      context.getString(R.string.widget_today_name),
      context.getString(R.string.widget_today_short),
      context.getString(R.string.widget_empty_no_data),
      WidgetLinks.STUDY,
    )

    is WidgetState.Unreadable -> WidgetPlaceholder(
      context,
      context,
      context.getString(R.string.widget_today_name),
      context.getString(R.string.widget_today_short),
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
  val name = strings.getString(R.string.widget_today_name)
  val open = strings.getString(R.string.widget_open_tasks, snapshot.openTasks)
  val start = actionStartActivity(openAppIntent(context, WidgetLinks.STUDY))

  val planned = snapshot.plannedMinutes
  val fraction = if (planned > 0) snapshot.doneMinutes.toFloat() / planned else 0f
  val minutes = if (planned > 0) {
    strings.getString(R.string.widget_progress, snapshot.doneMinutes, planned)
  } else {
    strings.getString(R.string.widget_minutes, snapshot.doneMinutes)
  }

  // 2×1 · 48 dp sind ein Ziel, keine Karte mit Überschrift darüber. Hier stehen
  // nur Angaben, deren Länge feststeht: Der Titel einer Einheit ist frei
  // gewählt und wäre auf 110 dp nach zwei Wörtern zu Ende. Wer ihn braucht,
  // bekommt ihn vorgelesen und mit einem Tippen ganz.
  if (isCompact()) {
    Column(
      modifier = widgetSurface(horizontal = 8.dp, vertical = 5.dp)
        .clickable(start)
        .semantics { contentDescription = "$name · $headline · $open · $minutes" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      WidgetBody(minutes, maxLines = 1, fontSize = 12.sp)
      Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
        WidgetCaption(strings.getString(R.string.widget_today_short), fontSize = 10.sp)
        Spacer(modifier = GlanceModifier.width(6.dp))
        WidgetCaption(open, fontSize = 10.sp)
      }
    }
    return
  }

  val wide = size.width >= 240.dp

  Column(modifier = widgetSurface().clickable(start)) {
    WidgetHeader(name, open)
    Spacer(modifier = GlanceModifier.height(2.dp))

    // Auf der breiten Fläche steht der ganze Tag darunter · dann wäre die
    // nächste Einheit doppelt genannt und die Liste dafür eine Zeile kürzer.
    if (!wide) {
      WidgetBody(headline, maxLines = 1)
      Spacer(modifier = GlanceModifier.height(6.dp))
    }

    WidgetProgress(fraction, width = if (wide) 240 else 130)

    // Auf der schmalen Fläche steht die Minutenzahl unter dem Balken; auf der
    // breiten nimmt die Liste den Platz, und die Zahlen stehen ohnehin in den
    // Einheiten.
    if (!wide) {
      Spacer(modifier = GlanceModifier.height(4.dp))
      WidgetCaption(minutes)
    }

    if (wide) {
      Spacer(modifier = GlanceModifier.height(6.dp))
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
