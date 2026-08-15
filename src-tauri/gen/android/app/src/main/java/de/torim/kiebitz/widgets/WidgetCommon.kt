package de.torim.kiebitz.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
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
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
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

fun openAppIntent(context: Context, link: String): Intent =
  Intent(context, MainActivity::class.java).apply {
    action = Intent.ACTION_VIEW
    data = Uri.parse(link)
    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
  }

@Composable
fun widgetSurface(): GlanceModifier =
  GlanceModifier
    .fillMaxSize()
    .background(GlanceTheme.colors.widgetBackground)
    .cornerRadius(16.dp)
    .padding(12.dp)

@Composable
fun WidgetTitle(text: String) {
  Text(
    text = text,
    style = TextStyle(
      color = GlanceTheme.colors.onSurfaceVariant,
      fontSize = 12.sp,
      fontWeight = FontWeight.Medium,
    ),
    maxLines = 1,
  )
}

@Composable
fun WidgetHeadline(text: String, color: ColorProvider = GlanceTheme.colors.onSurface) {
  Text(
    text = text,
    style = TextStyle(color = color, fontSize = 20.sp, fontWeight = FontWeight.Bold),
    maxLines = 1,
  )
}

@Composable
fun WidgetBody(text: String, maxLines: Int = 2) {
  Text(
    text = text,
    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp),
    maxLines = maxLines,
  )
}

@Composable
fun WidgetCaption(text: String) {
  Text(
    text = text,
    style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
    maxLines = 1,
  )
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
 * fehlt, und ein Ziel, das die App öffnet.
 */
@Composable
fun WidgetPlaceholder(context: Context, title: String, body: String, link: String) {
  Column(
    modifier = widgetSurface().clickable(actionStartActivity(openAppIntent(context, link))),
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
 */
@Composable
fun WidgetPlusPreview(context: Context, strings: Context) {
  Column(
    modifier = widgetSurface().clickable(actionStartActivity(openAppIntent(context, WidgetLinks.PLUS))),
    verticalAlignment = Alignment.Vertical.CenterVertically,
  ) {
    WidgetTitle(strings.getString(R.string.widget_plus_title))
    Spacer(modifier = GlanceModifier.height(4.dp))
    WidgetBody(strings.getString(R.string.widget_plus_body))
    Spacer(modifier = GlanceModifier.height(8.dp))
    Row(
      modifier = GlanceModifier
        .height(TOUCH_TARGET)
        .background(GlanceTheme.colors.primaryContainer)
        .cornerRadius(12.dp)
        .padding(horizontal = 12.dp),
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Text(
        text = strings.getString(R.string.widget_plus_cta),
        style = TextStyle(
          color = GlanceTheme.colors.onPrimaryContainer,
          fontSize = 13.sp,
          fontWeight = FontWeight.Medium,
        ),
        maxLines = 1,
      )
    }
  }
}

/** Quadratisches Ziel des Schnellstarts · Beschriftung plus 48-dp-Fläche. */
@Composable
fun QuickAction(context: Context, label: String, link: String, modifier: GlanceModifier) {
  Column(
    modifier = modifier
      .height(TOUCH_TARGET)
      .background(GlanceTheme.colors.secondaryContainer)
      .cornerRadius(12.dp)
      .padding(horizontal = 8.dp)
      .clickable(actionStartActivity(openAppIntent(context, link))),
    verticalAlignment = Alignment.Vertical.CenterVertically,
    horizontalAlignment = Alignment.Horizontal.CenterHorizontally,
  ) {
    Text(
      text = label,
      style = TextStyle(
        color = GlanceTheme.colors.onSecondaryContainer,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
      ),
      maxLines = 1,
    )
  }
}
