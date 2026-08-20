package de.torim.kiebitz.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import de.torim.kiebitz.MainActivity
import de.torim.kiebitz.R

/**
 * Gemeinsame Bausteine der drei Kiebitz-Widgets.
 *
 * Alles hier ist Darstellung. Sie folgt der App und nicht dem Gerät: dieselbe
 * warm-schwarze Karte mit haarfeinem Rand, dieselbe grüne Akzentfarbe,
 * dieselben Bereichsfarben des Lernplans, derselbe Vogel. Vorher nahmen die
 * Widgets die Systemfarben · das ist bequem und ergibt auf jedem Startbildschirm
 * ein anderes, graues Feld, das von Kiebitz nichts erkennen lässt.
 *
 * Die Flächen sind klein und die Schrift skaliert mit den Systemeinstellungen ·
 * jede Zeile muss deshalb in ihr Feld gerechnet werden, nicht geschätzt. Was
 * nicht sicher hineinpasst, gehört auf dieser Größe nicht ins Widget. Weil die
 * Widgets ihre Größe exakt kennen (`SizeMode.Exact`), ist „passt hinein" hier
 * eine Rechnung mit der wirklichen Kantenlänge und keine Annahme über ein
 * Raster, das jeder Startbildschirm anders auslegt.
 */

/** Deep Links der Widget-Aktionen · dieselben Ziele wie in der App-Navigation. */
object WidgetLinks {
  const val STUDY = "kiebitz://open?page=study"
  const val PUZZLES = "kiebitz://open?page=puzzles"
  const val REPERTOIRE = "kiebitz://open?page=repertoire"
  const val ENDGAME = "kiebitz://open?page=endgame"
  const val ANALYSIS = "kiebitz://open?page=analysis"
  const val PLUS = "kiebitz://open?page=settings&section=plus"
}

/**
 * Die Farben der App · als Ressourcen, damit Zeichnungen und Text dieselben
 * Werte verwenden (res/values/colors.xml).
 */
object WidgetColors {
  val ink = ColorProvider(R.color.widget_ink)
  val ink2 = ColorProvider(R.color.widget_ink2)
  val ink3 = ColorProvider(R.color.widget_ink3)
  val accent = ColorProvider(R.color.widget_accent)
}

/** Mindestgröße eines antippbaren Ziels. */
val TOUCH_TARGET = 48.dp

/**
 * Ab hier ist die Fläche nur noch ein Ziel hoch.
 *
 * Darunter passt keine Überschrift über einen Inhalt: 48 dp sind der Knopf
 * selbst. Die kleinen Größen bekommen deshalb kein gestauchtes großes Layout,
 * sondern ein eigenes.
 */
val COMPACT_HEIGHT = 72.dp

/** Ab hier ist Platz für eine erklärende Zeile unter der Kennzahl. */
val ROOMY_HEIGHT = 128.dp

/** Ab hier trägt die Kopfzeile neben dem Namen auch noch eine Kennzahl. */
val WIDE_WIDTH = 200.dp

/**
 * Ab hier trägt die einzeilige Fassung neben dem Zeichen noch etwas Zweites.
 *
 * Darunter ist die Zeile mit einer Angabe voll · zwei nebeneinander hieße, dass
 * eine davon abgeschnitten wird, und welche das ist, entscheidet dann die
 * Sprache.
 */
val COMPACT_TRAILING = 150.dp

/**
 * Womit die Kopfzeile in einer Rechnung veranschlagt wird.
 *
 * Sie darf höher bauen, wenn eine Schrift es verlangt · deshalb ist das hier
 * die reichliche Schätzung und keine gesetzte Höhe. Wer zu knapp veranschlagt,
 * verliert unten eine Zeile an den Rand.
 */
val HEADER_ROW = 22.dp

/** Polster der Fläche · knapper als in der App, die Karte ist hier winzig. */
val SURFACE_PADDING = 14.dp
val SURFACE_PADDING_TOP = 11.dp
val COMPACT_PADDING = 8.dp

/**
 * Auf flachen Karten wird das Polster knapper.
 *
 * Auf 110 dp sind 25 dp Rand fast ein Viertel der Höhe · und die Zeile, die
 * dadurch nicht mehr hineinpasst, ist die mit der Auskunft. Auf hohen Karten
 * bleibt es großzügig, dort kostet es nichts.
 */
fun surfaceTop(height: Dp): Dp = if (height < FLAT_HEIGHT) 9.dp else SURFACE_PADDING_TOP

fun surfaceBottom(height: Dp): Dp = if (height < FLAT_HEIGHT) 10.dp else SURFACE_PADDING

/** Bis hierher gilt eine Karte als flach · zwei Zellen sind gut 130 dp hoch. */
val FLAT_HEIGHT = 145.dp

@Composable
fun isCompact(): Boolean = LocalSize.current.height < COMPACT_HEIGHT

/**
 * Was innerhalb der Fläche wirklich zur Verfügung steht.
 *
 * Der Fortschrittsbalken braucht diese Zahl: Glance kann keine anteilige
 * Breite („60 % der Zeile"), also wird der gefüllte Teil in dp gerechnet.
 * Vorher stand dort ein fester Wert für „schmal" und einer für „breit" · auf
 * jeder anderen Kantenlänge zeigte der Balken damit etwas, das nicht stimmte.
 */
fun innerWidth(size: DpSize, padding: Dp): Dp =
  (size.width - padding * 2 - 2.dp).coerceAtLeast(24.dp)

fun openAppIntent(context: Context, link: String): Intent =
  Intent(context, MainActivity::class.java).apply {
    action = Intent.ACTION_VIEW
    data = Uri.parse(link)
    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
  }

/**
 * Die Karte selbst.
 *
 * Als Zeichnung und nicht als Farbe plus `cornerRadius()`: Glance rundet Ecken
 * erst ab Android 12, und einen Rand kennt es überhaupt nicht. Über die
 * Zeichnung sieht die Karte auf Android 7 aus wie auf Android 16.
 */
@Composable
fun widgetSurface(
  horizontal: Dp = SURFACE_PADDING,
  top: Dp = SURFACE_PADDING_TOP,
  bottom: Dp = SURFACE_PADDING,
): GlanceModifier =
  GlanceModifier
    .fillMaxSize()
    .background(ImageProvider(R.drawable.widget_surface))
    .padding(start = horizontal, end = horizontal, top = top, bottom = bottom)

/**
 * Der Name des Widgets in der Kopfzeile.
 *
 * Bewusst in normaler Stärke: Glance setzt `FontWeight.Medium` als *fett* um
 * (es kennt nur die drei Stile der Systemschrift). Neben einer fetten Kennzahl
 * gäbe das zwei gleich schwere Zeilen und damit keine Rangfolge mehr.
 */
@Composable
fun WidgetTitle(text: String, fontSize: TextUnit = 12.sp) {
  Text(
    text = text,
    style = TextStyle(color = WidgetColors.ink2, fontSize = fontSize),
    maxLines = 1,
  )
}

/** Die eine Zahl, für die das Widget dasteht. */
@Composable
fun WidgetHeadline(
  text: String,
  color: ColorProvider = WidgetColors.ink,
  fontSize: TextUnit = 22.sp,
) {
  Text(
    text = text,
    style = TextStyle(color = color, fontSize = fontSize, fontWeight = FontWeight.Bold),
    maxLines = 1,
  )
}

@Composable
fun WidgetBody(
  text: String,
  maxLines: Int = 2,
  fontSize: TextUnit = 13.sp,
  color: ColorProvider = WidgetColors.ink,
) {
  Text(
    text = text,
    style = TextStyle(color = color, fontSize = fontSize),
    maxLines = maxLines,
  )
}

@Composable
fun WidgetCaption(
  text: String,
  fontSize: TextUnit = 11.sp,
  color: ColorProvider = WidgetColors.ink3,
) {
  Text(
    text = text,
    style = TextStyle(color = color, fontSize = fontSize),
    maxLines = 1,
  )
}

/** Das Kiebitz-Zeichen · in jeder Kopfzeile, sonst nirgends. */
@Composable
fun WidgetMark(size: Dp = 15.dp) {
  Spacer(
    modifier = GlanceModifier
      .size(size)
      .background(ImageProvider(R.drawable.ic_widget_bird))
  )
}

/**
 * Kopfzeile aus Zeichen, Kurznamen und einer Kennzahl.
 *
 * Alles in einer Zeile statt untereinander · auf 110 dp Höhe ist jede
 * eingesparte Zeile eine, die der Inhalt behalten darf. Der Kurzname („Heute",
 * „Woche") und nicht der volle: Der volle Name steht in der Auswahl beim
 * Ablegen, und „S'entraîner aujourd'hui" neben einer Kennzahl passt in keine
 * zwei Zellen. Die Kennzahl entfällt, wo sie nicht sicher danebenpasst.
 */
@Composable
fun WidgetHeader(
  title: String,
  trailing: String? = null,
  trailingContent: (@Composable () -> Unit)? = null,
) {
  Row(
    modifier = GlanceModifier.fillMaxWidth(),
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    WidgetMark()
    Spacer(modifier = GlanceModifier.width(7.dp))
    WidgetTitle(title)
    if (trailing != null || trailingContent != null) {
      Spacer(modifier = GlanceModifier.defaultWeight())
      if (trailingContent != null) trailingContent() else WidgetPill(trailing!!)
    }
  }
}

/** Eine Kennzahl im Chip · dieselbe Form wie die Filter-Chips der App. */
@Composable
fun WidgetPill(text: String) {
  Box(
    modifier = GlanceModifier
      .background(ImageProvider(R.drawable.widget_pill))
      .padding(horizontal = 8.dp, vertical = 3.dp),
    contentAlignment = Alignment.Center,
  ) {
    WidgetCaption(text, color = WidgetColors.ink2)
  }
}

/**
 * Schmaler Fortschrittsbalken.
 *
 * Glance kennt einen `LinearProgressIndicator` erst ab Android 12; zwei
 * gefärbte Flächen sehen überall gleich aus und kosten nichts. `width` ist die
 * gemessene Innenbreite · der gefüllte Teil wird daraus gerechnet.
 *
 * Ein Anteil über null bekommt mindestens eine sichtbare Kuppe: Ein Balken,
 * der bei 2 % rechnerisch 1 dp breit wäre, sähe aus wie „nichts getan", und
 * das wäre die falsche Auskunft.
 */
@Composable
fun WidgetProgress(fraction: Float, width: Dp, height: Dp = 8.dp) {
  val safe = fraction.coerceIn(0f, 1f)
  val filled = (width * safe).coerceAtLeast(if (safe > 0f) height else 0.dp).coerceAtMost(width)
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .height(height)
      .background(ImageProvider(R.drawable.widget_track))
  ) {
    if (safe > 0f) {
      Spacer(
        modifier = GlanceModifier
          .width(filled)
          .fillMaxHeight()
          .background(ImageProvider(R.drawable.widget_bar))
      )
    }
  }
}

/**
 * Die Trainingstage der Woche als Punkte.
 *
 * Sie zeigen genau das, was die Zeile daneben sagt · vier von fünf, nicht
 * welche vier. Der Datenstand kennt die einzelnen Tage nicht, und ein Punkt
 * unter „Mi" wäre erfunden.
 */
@Composable
fun WidgetDays(trained: Int, target: Int, dot: Dp = 7.dp) {
  val total = target.coerceIn(1, 7)
  val done = trained.coerceIn(0, total)
  Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
    repeat(total) { index ->
      if (index > 0) Spacer(modifier = GlanceModifier.width(4.dp))
      Spacer(
        modifier = GlanceModifier
          .size(dot)
          .background(
            ImageProvider(
              if (index < done) R.drawable.widget_dot_accent else R.drawable.widget_dot_open
            )
          )
      )
    }
  }
}

/** Balkensegment eines Lernbereichs · dieselben Farben wie die Punkte. */
fun areaSegment(area: String): Int = when (area) {
  "play" -> R.drawable.widget_seg_play
  "tactics" -> R.drawable.widget_seg_tactics
  "openings" -> R.drawable.widget_seg_openings
  "endgames" -> R.drawable.widget_seg_endgames
  "analysis" -> R.drawable.widget_seg_analysis
  else -> R.drawable.widget_bar
}

/**
 * Der Wochenbalken, nach Bereichen eingefärbt.
 *
 * Dasselbe Bild wie im Wochenbudget der App: Ein Balken, dessen Abschnitte
 * zeigen, *woraus* die Woche bestand. Vorher war er eine einfarbige Fläche, die
 * nur „so viel Prozent" sagte — und ohne gesetztes Wochenbudget nicht einmal
 * das, denn dann gibt es kein Prozent. Die Zusammensetzung gibt es immer,
 * sobald eine Minute gemessen wurde.
 *
 * `width` ist die gemessene Innenbreite; die Abschnitte werden daraus
 * gerechnet, weil Glance keine anteiligen Breiten kennt. `scale` ist die
 * Bezugsgröße: das Wochenziel, wo eines gesetzt ist, sonst die Summe selbst ·
 * dann füllt der Balken sich ganz und zeigt reine Zusammensetzung.
 */
@Composable
fun WidgetAreaBar(
  areas: List<WidgetArea>,
  scale: Int,
  width: Dp,
  height: Dp = 8.dp,
  /** Anteil für den Fall, dass die Aufteilung fehlt · dann bleibt der Balken einfarbig. */
  fallback: Float = 0f,
) {
  val total = areas.sumOf { it.minutes }
  if (total <= 0 || areas.isEmpty()) {
    // Aus einem älteren Datenstand oder wenn die Tageslasten nicht zu holen
    // waren · der Balken sagt dann weniger, aber nichts Falsches.
    WidgetProgress(fallback, width, height)
    return
  }
  val basis = if (scale > 0) maxOf(scale, total) else total
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .height(height)
      .background(ImageProvider(R.drawable.widget_track))
  ) {
    areas.forEachIndexed { index, entry ->
      // Jeder Abschnitt behält eine sichtbare Kuppe · fünf Minuten Endspiel in
      // einer langen Woche wären sonst rechnerisch unter einem dp breit und
      // damit unsichtbar, obwohl sie stattgefunden haben.
      val share = entry.minutes.toFloat() / basis
      val segment = (width * share).coerceIn(height, width)
      if (index > 0) Spacer(modifier = GlanceModifier.width(SEGMENT_GAP).fillMaxHeight())
      Spacer(
        modifier = GlanceModifier
          .width(segment)
          .fillMaxHeight()
          .background(ImageProvider(areaSegment(entry.area)))
      )
    }
  }
}

/** Luft zwischen zwei Abschnitten · gerade so viel, dass die Grenze zu sehen ist. */
private val SEGMENT_GAP = 2.dp

/**
 * Eine Zeile der Legende: Farbpunkt, Name des Bereichs, gemessene Minuten.
 *
 * Sie erscheint nur, wo die Kachel sie trägt · auf zwei Zellen ist der Balken
 * die ganze Aussage, auf vier steht darunter, welche Farbe was war.
 */
@Composable
fun WidgetAreaRow(entry: WidgetArea, strings: Context, modifier: GlanceModifier) {
  Row(modifier = modifier, verticalAlignment = Alignment.Vertical.CenterVertically) {
    Spacer(
      modifier = GlanceModifier.size(7.dp).background(ImageProvider(areaDot(entry.area, false)))
    )
    Spacer(modifier = GlanceModifier.width(8.dp))
    Text(
      text = strings.getString(areaLabel(entry.area)),
      style = TextStyle(color = WidgetColors.ink2, fontSize = 12.sp),
      maxLines = 1,
      modifier = GlanceModifier.defaultWeight(),
    )
    Spacer(modifier = GlanceModifier.width(8.dp))
    WidgetCaption(strings.getString(R.string.widget_minutes, entry.minutes))
  }
}

/** Name eines Lernbereichs · dieselben fünf wie im Wochenbudget der App. */
fun areaLabel(area: String): Int = when (area) {
  "play" -> R.string.widget_area_play
  "tactics" -> R.string.widget_area_tactics
  "openings" -> R.string.widget_area_openings
  "endgames" -> R.string.widget_area_endgames
  else -> R.string.widget_area_analysis
}

/**
 * Eine offene Aufgabe als Zeile.
 *
 * Das ist die Antwort auf die leere Kachel: Wer keine geplanten Einheiten hat,
 * hat trotzdem fällige Wiederholungen, fehlende Puzzles und ein Endspiel · die
 * Zahl „5 offen" stand vorher allein in der Kopfzeile, während darunter nichts
 * war.
 *
 * Bewusst nicht einzeln antippbar, so wie die Einheitszeilen daneben: Die
 * Zeilen teilen sich, was die Karte übrig lässt, und kommen dabei je nach
 * Größe auf 26 bis 46 dp — also nie auf die 48 dp, die ein Ziel braucht. Ein
 * Link, den man auf keiner Kachelgröße zuverlässig trifft, ist schlechter als
 * keiner; angetippt wird die ganze Karte, und die führt in den Lernplan, wo
 * alle diese Aufgaben nebeneinander stehen.
 */
@Composable
fun WidgetTaskRow(task: WidgetTask, strings: Context, modifier: GlanceModifier) {
  Row(modifier = modifier, verticalAlignment = Alignment.Vertical.CenterVertically) {
    Spacer(
      modifier = GlanceModifier.size(7.dp).background(ImageProvider(areaDot(task.area, false)))
    )
    Spacer(modifier = GlanceModifier.width(8.dp))
    Text(
      text = taskLabel(task, strings),
      style = TextStyle(color = WidgetColors.ink, fontSize = 12.sp),
      maxLines = 1,
      modifier = GlanceModifier.defaultWeight(),
    )
  }
}

/** Beschriftung einer offenen Aufgabe · mit Anzahl, wo es eine gibt. */
fun taskLabel(task: WidgetTask, strings: Context): String = when (task.kind) {
  "units" -> strings.getString(R.string.widget_task_units, task.count)
  "repertoire" -> strings.getString(R.string.widget_task_repertoire, task.count)
  "puzzles" -> strings.getString(R.string.widget_task_puzzles, task.count)
  "endgame" -> strings.getString(R.string.widget_task_endgame)
  else -> strings.getString(R.string.widget_task_analysis, task.count)
}

/** Farbpunkt eines Lernbereichs · dieselbe Zuordnung wie im Wochenbudget. */
fun areaDot(area: String, done: Boolean): Int = when {
  done -> R.drawable.widget_dot_muted
  area == "play" -> R.drawable.widget_dot_accent
  area == "tactics" -> R.drawable.widget_dot_tactics
  area == "openings" -> R.drawable.widget_dot_openings
  area == "endgames" -> R.drawable.widget_dot_endgames
  area == "analysis" -> R.drawable.widget_dot_analysis
  else -> R.drawable.widget_dot_muted
}

/**
 * Ein hervorgehobenes Ziel über die ganze Breite.
 *
 * Das ist die Antwort auf einen leeren Zustand: keine Fläche, die nur mitteilt,
 * dass nichts da ist, sondern eine, die den Weg dahin anbietet, wo etwas
 * entsteht.
 */
@Composable
fun WidgetAccentAction(label: String, height: Dp = TOUCH_TARGET) {
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .height(height)
      .background(ImageProvider(R.drawable.widget_tile_accent))
      .padding(horizontal = 10.dp),
    verticalAlignment = Alignment.Vertical.CenterVertically,
    horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
  ) {
    Text(
      text = label,
      style = TextStyle(
        color = WidgetColors.accent,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
      ),
      maxLines = 1,
    )
  }
}

/**
 * Was ein Widget zeigt, solange es nichts zu zeigen gibt.
 *
 * Kein leeres Rechteck und keine Fehlernummer · eine Zeile, die sagt, was
 * fehlt, und ein Ziel, das die App öffnet. Auf 48 dp bleibt für den Unterschied
 * zwischen „noch kein Stand" und „Stand unlesbar" kein Platz und auch kein
 * Nutzen: Beides führt zur selben Handlung.
 */
@Composable
fun WidgetPlaceholder(
  context: Context,
  strings: Context,
  title: String,
  shortTitle: String,
  body: String,
  link: String,
) {
  val open = actionStartActivity(openAppIntent(context, link))
  val size = LocalSize.current

  if (isCompact()) {
    Row(
      modifier = widgetSurface(horizontal = COMPACT_PADDING, top = 6.dp, bottom = 6.dp)
        .clickable(open)
        .semantics { contentDescription = "$title · $body" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      WidgetMark()
      Spacer(modifier = GlanceModifier.width(7.dp))
      WidgetTitle(shortTitle)
      if (size.width >= COMPACT_TRAILING) {
        Spacer(modifier = GlanceModifier.defaultWeight())
        WidgetCaption(strings.getString(R.string.widget_open_app), color = WidgetColors.accent)
      }
    }
    return
  }

  Column(
    modifier = widgetSurface(top = surfaceTop(size.height), bottom = surfaceBottom(size.height))
      .clickable(open)
      .semantics { contentDescription = "$title · $body" },
  ) {
    // Auch hier der Kurzname · der volle steht in der Auswahl beim Ablegen und
    // wäre neben dem Zeichen auf zwei Zellen in mehreren Sprachen zu lang.
    WidgetHeader(shortTitle)
    val roomy = size.height >= ROOMY_HEIGHT
    // Ohne Knopf steht der Satz in der Mitte der Karte statt oben unter dem
    // Namen · sonst klebt die einzige Zeile am Rand und der Rest ist Loch.
    Spacer(modifier = GlanceModifier.defaultWeight())
    WidgetBody(body, color = WidgetColors.ink2)
    Spacer(modifier = GlanceModifier.defaultWeight())
    if (roomy) {
      WidgetAccentAction(
        strings.getString(R.string.widget_open_app),
        height = actionHeight(size.height),
      )
    } else {
      WidgetCaption(strings.getString(R.string.widget_open_app), color = WidgetColors.accent)
    }
  }
}

/**
 * Wie hoch eine Zeile über ihrer Schriftgröße baut.
 *
 * Arabisch und Devanagari brauchen für dieselbe Schriftgröße rund die doppelte
 * Zeilenhöhe · Ober- und Unterlängen sitzen dort weiter auseinander. Wer mit
 * einem Wert für alle rechnet, verliert entweder in diesen Sprachen die
 * unterste Zeile hinter dem Rand oder verschenkt in den lateinischen eine.
 */
fun lineFactor(locale: String): Float =
  if (locale.startsWith("ar") || locale.startsWith("hi")) 2.0f else 1.4f

/**
 * Größe der Kennzahl.
 *
 * Sie hängt an beiden Kanten: Auf einer schmalen Fläche wäre die große Zahl
 * länger als die Zeile, auf einer flachen nähme sie den Platz der Auskunft
 * darunter. Die größte Stufe steht deshalb erst da, wo beides reicht.
 */
fun headlineSize(size: DpSize): TextUnit = when {
  size.height < 100.dp -> 17.sp
  size.width >= 240.dp && size.height >= 140.dp -> 24.sp
  size.width >= 190.dp -> 20.sp
  else -> 17.sp
}

/**
 * Höhe des hervorgehobenen Ziels.
 *
 * 48 dp, wo die Karte sie hergibt · auf einer flachen Fläche lieber ein
 * niedrigerer Knopf als einer, der unten hinausragt. Angetippt wird ohnehin die
 * ganze Karte, und die ist immer höher als 48 dp.
 */
fun actionHeight(height: Dp): Dp = if (height < 108.dp) 38.dp else TOUCH_TARGET

/**
 * Plus-Vorschau.
 *
 * Ohne gültiges Plus bleibt die Widget-Konfiguration erhalten · gezeigt wird
 * aber nichts aus den Trainingsdaten, sondern nur der Hinweis samt Einstieg in
 * den kostenlosen Test.
 *
 * Drei Fassungen, damit der Einstieg nie abgeschnitten wird: Auf 48 dp ist die
 * ganze Fläche der Knopf und trägt seinen Namen selbst; darüber kommt ein
 * eigenes 48-dp-Ziel dazu; erst auf der hohen Fläche auch die Begründung.
 */
@Composable
fun WidgetPlusPreview(context: Context, strings: Context) {
  val open = actionStartActivity(openAppIntent(context, WidgetLinks.PLUS))
  val title = strings.getString(R.string.widget_plus_title)
  val cta = strings.getString(R.string.widget_plus_cta)
  val short = strings.getString(R.string.widget_plus_cta_short)
  val size = LocalSize.current

  if (isCompact()) {
    Row(
      modifier = widgetSurface(horizontal = COMPACT_PADDING, top = 6.dp, bottom = 6.dp)
        .clickable(open)
        .semantics { contentDescription = "$title · $cta" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      WidgetMark()
      Spacer(modifier = GlanceModifier.width(7.dp))
      WidgetTitle(title)
      if (size.width >= COMPACT_TRAILING) {
        Spacer(modifier = GlanceModifier.defaultWeight())
        WidgetCaption(short, color = WidgetColors.accent)
      }
    }
    return
  }

  // Auf zwei Spalten Breite passt „7 Tage kostenlos testen" nicht in einen
  // Knopf · dort steht die kurze Fassung. Ein halber Satz mit Auslassung wäre
  // an genau der Stelle, an der jemand sich entscheidet, das falsche Angebot.
  val wide = size.width >= 240.dp

  Column(modifier = widgetSurface().clickable(open)) {
    WidgetHeader(title)
    if (size.height >= ROOMY_HEIGHT) {
      Spacer(modifier = GlanceModifier.height(6.dp))
      WidgetBody(strings.getString(R.string.widget_plus_body), fontSize = 11.5.sp, color = WidgetColors.ink2)
    }
    Spacer(modifier = GlanceModifier.defaultWeight())
    WidgetAccentAction(if (wide) cta else short, height = actionHeight(size.height))
  }
}

/**
 * Ziel des Schnellstarts · Symbol und Beschriftung auf mindestens 48 dp.
 *
 * Das Symbol trägt die Farbe seines Lernbereichs · dieselbe wie im
 * Wochenbudget der App. Die Beschriftung entfällt, wo die Kachel zu schmal für
 * das längste Wort der Sprache ist: „Repertoi…" ist keine Beschriftung,
 * sondern ein Fehler, den man auf dem Startbildschirm für Absicht hält. Das
 * Symbol allein bleibt eindeutig, und der Vorlesedienst bekommt weiterhin den
 * ganzen Namen.
 */
@Composable
fun QuickAction(
  context: Context,
  icon: Int,
  label: String,
  link: String,
  modifier: GlanceModifier,
  /** Schriftgröße der Beschriftung · `null` heißt: nur das Symbol. */
  fontSize: TextUnit?,
  stacked: Boolean,
  iconSize: Dp = 20.dp,
) {
  val tile = modifier
    .background(ImageProvider(R.drawable.widget_tile))
    .padding(horizontal = 4.dp)
    .clickable(actionStartActivity(openAppIntent(context, link)))
    .semantics { contentDescription = label }

  if (fontSize == null) {
    Box(modifier = tile, contentAlignment = Alignment.Center) {
      Spacer(modifier = GlanceModifier.size(iconSize).background(ImageProvider(icon)))
    }
    return
  }

  if (stacked) {
    Column(
      modifier = tile,
      verticalAlignment = Alignment.Vertical.CenterVertically,
      horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
      Spacer(modifier = GlanceModifier.size(iconSize).background(ImageProvider(icon)))
      Spacer(modifier = GlanceModifier.height(5.dp))
      QuickLabel(label, fontSize)
    }
    return
  }

  Row(
    modifier = tile,
    verticalAlignment = Alignment.Vertical.CenterVertically,
    horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
  ) {
    Spacer(modifier = GlanceModifier.size(iconSize).background(ImageProvider(icon)))
    Spacer(modifier = GlanceModifier.width(7.dp))
    QuickLabel(label, fontSize)
  }
}

@Composable
private fun QuickLabel(label: String, fontSize: TextUnit) {
  Text(
    text = label,
    style = TextStyle(
      color = WidgetColors.ink,
      fontSize = fontSize,
      fontWeight = FontWeight.Medium,
    ),
    maxLines = 1,
  )
}
