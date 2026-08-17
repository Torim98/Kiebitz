package de.torim.kiebitz.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import de.torim.kiebitz.R

/**
 * „Heute trainieren".
 *
 * Der Tag als eine Zahl: gemessene Minuten gegen die geplanten, darunter der
 * Balken und, sobald die Fläche es hergibt, die Einheiten selbst · jede mit dem
 * Farbpunkt ihres Lernbereichs, wie im Wochenbudget der App.
 *
 * `SizeMode.Exact` statt einer Handvoll fester Größen: Was ein Startbildschirm
 * als „4×2" ausgibt, ist von Gerät zu Gerät verschieden breit. Mit der wirklich
 * zugeteilten Kantenlänge lässt sich rechnen, wie viele Zeilen hineinpassen und
 * wie breit der gefüllte Teil des Balkens ist · geraten wurde beides vorher.
 */
class TodayWidget : GlanceAppWidget() {
  override val sizeMode = SizeMode.Exact

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val state = WidgetSnapshotStore.read(context)
    provideContent {
      TodayContent(context, state)
    }
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
  val start = actionStartActivity(openAppIntent(context, WidgetLinks.STUDY))

  val planned = snapshot.plannedMinutes
  val fraction = if (planned > 0) snapshot.doneMinutes.toFloat() / planned else 0f
  val metric = if (planned > 0) {
    strings.getString(R.string.widget_ratio, snapshot.doneMinutes, planned)
  } else {
    strings.getString(R.string.widget_minutes, snapshot.doneMinutes)
  }
  val name = strings.getString(R.string.widget_today_short)
  val open = strings.getString(R.string.widget_open_tasks, snapshot.openTasks)
  val next = snapshot.units.firstOrNull { !it.done }
  val clear = strings.getString(R.string.widget_today_clear)

  // Ein Tag ohne Plan und ohne gemessene Minute hat keine Kennzahl · „0 min"
  // groß hinzuschreiben ist die aufwendigste Art, nichts zu sagen. Dann steht
  // dort der Satz, der zutrifft, und darunter der Weg in die App.
  val quiet = planned == 0 && snapshot.doneMinutes == 0

  // 2×1 · 48 dp sind ein Ziel, keine Karte mit Überschrift darüber. Hier stehen
  // nur Angaben, deren Länge feststeht: Der Titel einer Einheit ist frei
  // gewählt und wäre auf 110 dp nach zwei Wörtern zu Ende. Wer ihn braucht,
  // bekommt ihn vorgelesen und mit einem Tippen ganz.
  if (isCompact()) {
    Column(
      modifier = widgetSurface(horizontal = COMPACT_PADDING, top = 7.dp, bottom = 7.dp)
        .clickable(start)
        .semantics { contentDescription = "$name · ${if (quiet) clear else metric} · $open" },
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
        if (size.width >= 175.dp) {
          Spacer(modifier = GlanceModifier.defaultWeight())
          WidgetCaption(open)
        }
      }
      // Ohne Plan und ohne Minute gibt es nichts zu messen · dann steht dort
      // auch kein leerer Balken, der wie „null Prozent geschafft" aussieht.
      if (size.height >= 46.dp && !quiet) {
        Spacer(modifier = GlanceModifier.height(6.dp))
        WidgetProgress(
          fraction,
          width = innerWidth(size, COMPACT_PADDING),
          height = 6.dp,
        )
      }
    }
    return
  }

  val inner = innerWidth(size, SURFACE_PADDING)
  val headline = headlineSize(size)

  // Was nach Kopfzeile, Kennzahl und Balken übrig bleibt · daraus folgt, ob
  // darunter noch Einheiten stehen, nur die nächste, oder nichts. Gerechnet,
  // nicht geschätzt: Eine Zeile baut höher als ihre Schriftgröße, und in
  // Devanagari und Arabisch noch einmal höher als in lateinischer Schrift.
  val room = size.height - surfaceTop(size.height) - surfaceBottom(size.height) -
    HEADER_ROW - 8.dp - (headline.value * lineFactor(snapshot.locale)).dp - 8.dp - 8.dp
  val rows = if (quiet) 0 else ((room - 10.dp) / UNIT_ROW).toInt().coerceIn(0, 3)
  val units = snapshot.units.take(rows)
  val foot = room - 6.dp >= 19.dp

  Column(
    modifier = widgetSurface(top = surfaceTop(size.height), bottom = surfaceBottom(size.height))
      .clickable(start)
  ) {
    WidgetHeader(name, if (size.width >= WIDE_WIDTH) open else null)

    if (quiet) {
      Spacer(modifier = GlanceModifier.defaultWeight())
      WidgetBody(clear, maxLines = 2, color = WidgetColors.ink2)
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

    Spacer(modifier = GlanceModifier.height(8.dp))
    WidgetHeadline(metric, fontSize = headline)
    Spacer(modifier = GlanceModifier.height(8.dp))
    WidgetProgress(fraction, width = inner)
    if (units.isEmpty()) {
      // Ohne Liste bleibt die nächste Einheit unter dem Balken · und der Block
      // steht zusammen, statt dass die letzte Zeile allein am unteren Rand
      // klebt. Der Titel ist selbst gewählt und darf mit Auslassung enden.
      if (foot) {
        Spacer(modifier = GlanceModifier.height(6.dp))
        WidgetCaption(next?.title ?: clear, color = WidgetColors.ink2)
      }
      Spacer(modifier = GlanceModifier.defaultWeight())
      return@Column
    }

    // Die Einheiten teilen sich, was übrig bleibt · auf einer hohen Fläche
    // stehen sie dann gleichmäßig verteilt statt zusammengedrängt oben, mit
    // einem Loch darunter. Genau das ließ die Widgets vorher leer aussehen.
    Spacer(modifier = GlanceModifier.height(10.dp))
    units.forEach { unit ->
      UnitRow(
        unit,
        strings,
        showMinutes = size.width >= 230.dp,
        modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
      )
    }
  }
}

/**
 * Womit eine Einheitszeile veranschlagt wird.
 *
 * Reichlich: In Devanagari und Arabisch baut dieselbe Schriftgröße gut zwei dp
 * höher als in lateinischer Schrift, und die Zeile, die dadurch nicht mehr
 * passt, ist immer die unterste.
 */
private val UNIT_ROW = 23.dp

@Composable
private fun UnitRow(
  unit: WidgetUnit,
  strings: Context,
  showMinutes: Boolean,
  modifier: GlanceModifier,
) {
  Row(
    modifier = modifier,
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    Spacer(
      modifier = GlanceModifier
        .size(7.dp)
        .background(ImageProvider(areaDot(unit.area, unit.done)))
    )
    Spacer(modifier = GlanceModifier.width(8.dp))
    Text(
      text = unit.title,
      style = TextStyle(
        color = if (unit.done) WidgetColors.ink3 else WidgetColors.ink,
        fontSize = 12.sp,
        fontWeight = FontWeight.Normal,
      ),
      maxLines = 1,
      modifier = GlanceModifier.defaultWeight(),
    )
    if (showMinutes && unit.minutes > 0) {
      Spacer(modifier = GlanceModifier.width(8.dp))
      WidgetCaption(strings.getString(R.string.widget_minutes, unit.minutes))
    }
  }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
