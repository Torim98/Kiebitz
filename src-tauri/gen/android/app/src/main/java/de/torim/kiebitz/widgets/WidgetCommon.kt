package de.torim.kiebitz.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.torim.kiebitz.MainActivity
import de.torim.kiebitz.R

/**
 * Gemeinsame Bausteine der drei Kiebitz-Widgets.
 *
 * Alles hier ist Darstellung: Farben aus dem Systemthema (dynamisch ab
 * Android 12, sonst das mitgelieferte Schema), Ziele mit mindestens 48 dp und
 * Aktionen, die per Deep Link die passende App-Seite öffnen.
 *
 * Die Flächen sind klein und die Schrift skaliert mit den Systemeinstellungen ·
 * jede Zeile muss deshalb in ihr Feld gerechnet werden, nicht geschätzt. Was
 * nicht sicher hineinpasst, gehört auf dieser Größe nicht ins Widget.
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

/** Ab hier ist Platz für einen erklärenden Fließtext neben dem Ziel. */
private val ROOMY_HEIGHT = 130.dp

/** Ab hier trägt eine Zeile auch einen längeren Satz · darunter nur ein Wortpaar. */
private val WIDE_WIDTH = 200.dp

@Composable
fun isCompact(): Boolean = LocalSize.current.height < COMPACT_HEIGHT

fun openAppIntent(context: Context, link: String): Intent =
  Intent(context, MainActivity::class.java).apply {
    action = Intent.ACTION_VIEW
    data = Uri.parse(link)
    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
  }

@Composable
fun widgetSurface(horizontal: Dp = 12.dp, vertical: Dp = 8.dp): GlanceModifier =
  GlanceModifier
    .fillMaxSize()
    .background(GlanceTheme.colors.widgetBackground)
    .cornerRadius(16.dp)
    .padding(horizontal = horizontal, vertical = vertical)

@Composable
fun WidgetTitle(text: String, fontSize: TextUnit = 12.sp) {
  Text(
    text = text,
    style = TextStyle(
      color = GlanceTheme.colors.onSurfaceVariant,
      fontSize = fontSize,
      fontWeight = FontWeight.Medium,
    ),
    maxLines = 1,
  )
}

@Composable
fun WidgetHeadline(
  text: String,
  color: ColorProvider = GlanceTheme.colors.onSurface,
  fontSize: TextUnit = 20.sp,
) {
  Text(
    text = text,
    style = TextStyle(color = color, fontSize = fontSize, fontWeight = FontWeight.Bold),
    maxLines = 1,
  )
}

@Composable
fun WidgetBody(text: String, maxLines: Int = 2, fontSize: TextUnit = 13.sp) {
  Text(
    text = text,
    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = fontSize),
    maxLines = maxLines,
  )
}

@Composable
fun WidgetCaption(text: String, fontSize: TextUnit = 11.sp) {
  Text(
    text = text,
    style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = fontSize),
    maxLines = 1,
  )
}

/**
 * Kopfzeile aus Name und einer kurzen Kennzahl.
 *
 * Beides in einer Zeile statt untereinander · auf 110 dp Höhe ist jede
 * eingesparte Zeile eine, die der Inhalt behalten darf.
 */
@Composable
fun WidgetHeader(title: String, trailing: String? = null) {
  Row(
    modifier = GlanceModifier.fillMaxWidth(),
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    WidgetTitle(title)
    if (trailing != null) {
      Spacer(modifier = GlanceModifier.defaultWeight())
      WidgetCaption(trailing)
    }
  }
}

/**
 * Schmaler Fortschrittsbalken.
 *
 * Glance kennt einen `LinearProgressIndicator` erst ab Android 12; zwei
 * gefärbte Flächen sehen überall gleich aus und kosten nichts.
 */
@Composable
fun WidgetProgress(fraction: Float, width: Int) {
  val safe = fraction.coerceIn(0f, 1f)
  val filled = (width * safe).toInt().coerceAtLeast(if (safe > 0f) 4 else 0)
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .height(6.dp)
      .background(GlanceTheme.colors.secondaryContainer)
      .cornerRadius(3.dp)
  ) {
    if (filled > 0) {
      Spacer(
        modifier = GlanceModifier
          .width(filled.dp)
          .height(6.dp)
          .background(GlanceTheme.colors.primary)
          .cornerRadius(3.dp)
      )
    }
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
  if (isCompact()) {
    Column(
      modifier = widgetSurface(horizontal = 8.dp, vertical = 5.dp)
        .clickable(open)
        .semantics { contentDescription = "$title · $body" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      WidgetTitle(shortTitle)
      WidgetCaption(strings.getString(R.string.widget_open_app), fontSize = 10.sp)
    }
    return
  }
  Column(
    modifier = widgetSurface().clickable(open),
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    WidgetTitle(title)
    Spacer(modifier = GlanceModifier.height(4.dp))
    WidgetBody(body)
  }
}

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

  if (isCompact()) {
    Column(
      modifier = GlanceModifier
        .fillMaxSize()
        .background(GlanceTheme.colors.primaryContainer)
        .cornerRadius(16.dp)
        .padding(horizontal = 8.dp, vertical = 5.dp)
        .clickable(open)
        .semantics { contentDescription = "$title · $cta" },
      verticalAlignment = Alignment.Vertical.CenterVertically,
      horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
      Text(
        text = title,
        style = TextStyle(
          color = GlanceTheme.colors.onPrimaryContainer,
          fontSize = 12.sp,
          fontWeight = FontWeight.Medium,
        ),
        maxLines = 1,
      )
      Text(
        text = strings.getString(R.string.widget_plus_cta_short),
        style = TextStyle(color = GlanceTheme.colors.onPrimaryContainer, fontSize = 10.sp),
        maxLines = 1,
      )
    }
    return
  }

  // Auf zwei Spalten Breite passt „7 Tage kostenlos testen" nicht in einen
  // Knopf · dort steht die kurze Fassung. Ein halber Satz mit Auslassung wäre
  // an genau der Stelle, an der jemand sich entscheidet, das falsche Angebot.
  val wide = LocalSize.current.width >= WIDE_WIDTH

  Column(modifier = widgetSurface().clickable(open)) {
    WidgetTitle(title)
    Spacer(modifier = GlanceModifier.height(4.dp))
    if (LocalSize.current.height >= ROOMY_HEIGHT) {
      WidgetBody(strings.getString(R.string.widget_plus_body), fontSize = 11.sp)
      Spacer(modifier = GlanceModifier.height(6.dp))
    }
    Row(
      modifier = GlanceModifier
        .fillMaxWidth()
        .height(TOUCH_TARGET)
        .background(GlanceTheme.colors.primaryContainer)
        .cornerRadius(12.dp)
        .padding(horizontal = if (wide) 12.dp else 6.dp),
      verticalAlignment = Alignment.Vertical.CenterVertically,
      horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
    ) {
      Text(
        text = if (wide) cta else strings.getString(R.string.widget_plus_cta_short),
        style = TextStyle(
          color = GlanceTheme.colors.onPrimaryContainer,
          fontSize = if (wide) 13.sp else 12.sp,
          fontWeight = FontWeight.Medium,
        ),
        maxLines = 1,
      )
    }
  }
}

/** Ziel des Schnellstarts · Beschriftung auf einer Fläche von mindestens 48 dp. */
@Composable
fun QuickAction(
  context: Context,
  label: String,
  link: String,
  modifier: GlanceModifier,
  fontSize: TextUnit = 12.sp,
  horizontalPadding: Dp = 8.dp,
) {
  Column(
    modifier = modifier
      .background(GlanceTheme.colors.secondaryContainer)
      .cornerRadius(12.dp)
      .padding(horizontal = horizontalPadding)
      .clickable(actionStartActivity(openAppIntent(context, link))),
    verticalAlignment = Alignment.Vertical.CenterVertically,
    horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
  ) {
    Text(
      text = label,
      style = TextStyle(
        color = GlanceTheme.colors.onSecondaryContainer,
        fontSize = fontSize,
        fontWeight = FontWeight.Medium,
      ),
      maxLines = 1,
    )
  }
}
