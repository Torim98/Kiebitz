package de.torim.kiebitz

import android.app.Activity
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native Google-Mobile-Ads-Brücke für die Tauri-WebView.
 *
 * React reserviert einen festen, nicht anklickbaren Platz im Layout und
 * übermittelt dessen Fensterkoordinaten. Die offizielle AdView wird im
 * Android-DecorView genau darüber gelegt. Dadurch bleibt Werbecode aus dem
 * Web-DOM heraus und Google erhält eine reguläre native App-Integration.
 */
@TauriPlugin
class AdsPlugin(private val activity: Activity) : Plugin(activity) {
  private var container: FrameLayout? = null
  private var adView: AdView? = null
  private lateinit var consentInformation: ConsentInformation
  private val consentRequested = AtomicBoolean(false)
  private val mobileAdsStarted = AtomicBoolean(false)

  @Command
  fun setBanner(invoke: Invoke) {
    val args = invoke.getArgs()
    val visible = args.getBoolean("visible", false)

    activity.runOnUiThread {
      try {
        if (!visible) {
          container?.visibility = View.GONE
          invoke.resolve(JSObject().put("available", true))
          return@runOnUiThread
        }

        val left = args.getInteger("left", 0).coerceAtLeast(0)
        val top = args.getInteger("top", 0).coerceAtLeast(0)
        val width = args.getInteger("width", 0).coerceAtLeast(1)
        val height = args.getInteger("height", 0).coerceAtLeast(1)
        positionContainer(left, top, width, height)
        requestConsentAndStartAds()
        invoke.resolve(JSObject().put("available", true))
      } catch (error: Exception) {
        invoke.reject("Banner konnte nicht vorbereitet werden", error)
      }
    }
  }

  @Command
  fun showPrivacyOptions(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        if (!::consentInformation.isInitialized) {
          consentInformation = UserMessagingPlatform.getConsentInformation(activity)
        }
        val required =
          consentInformation.privacyOptionsRequirementStatus ==
            ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        if (!required) {
          invoke.resolve(JSObject().put("shown", false))
          return@runOnUiThread
        }
        UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
          if (error == null) {
            if (consentInformation.canRequestAds()) startMobileAdsOnce()
            invoke.resolve(JSObject().put("shown", true))
          } else {
            invoke.reject(error.message)
          }
        }
      } catch (error: Exception) {
        invoke.reject("Datenschutzoptionen konnten nicht geöffnet werden", error)
      }
    }
  }

  private fun positionContainer(left: Int, top: Int, width: Int, height: Int) {
    // Browser-Koordinaten beginnen am Inhalt der Activity, nicht am DecorView
    // inklusive Statusleiste. Der Tauri-WebView füllt genau diesen Container.
    val root = activity.findViewById<ViewGroup>(android.R.id.content)
    val frame = container ?: FrameLayout(activity).also {
      it.setBackgroundColor(Color.TRANSPARENT)
      root.addView(it)
      container = it
    }
    frame.layoutParams = FrameLayout.LayoutParams(width, height).apply {
      leftMargin = left
      topMargin = top
    }
    frame.visibility = View.VISIBLE
  }

  private fun requestConsentAndStartAds() {
    if (!consentRequested.compareAndSet(false, true)) return
    if (!::consentInformation.isInitialized) {
      consentInformation = UserMessagingPlatform.getConsentInformation(activity)
    }

    // Bei jeder App-Sitzung aktualisieren: eine frühere Entscheidung kann
    // abgelaufen sein oder die regionale Rechtslage sich geändert haben.
    consentInformation.requestConsentInfoUpdate(
      activity,
      ConsentRequestParameters.Builder().build(),
      {
        UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) {
          if (consentInformation.canRequestAds()) startMobileAdsOnce()
        }
      },
      {
        // Ein voriger, weiterhin gültiger Status darf auch bei einem
        // vorübergehenden Netzwerkfehler genutzt werden.
        if (consentInformation.canRequestAds()) startMobileAdsOnce()
      },
    )
  }

  private fun startMobileAdsOnce() {
    if (!mobileAdsStarted.compareAndSet(false, true)) return
    MobileAds.initialize(activity) {
      activity.runOnUiThread { loadBanner() }
    }
  }

  private fun loadBanner() {
    val frame = container ?: return
    val density = activity.resources.displayMetrics.density
    val availableWidthDp = (frame.layoutParams.width / density).toInt()
    // Das kleine 320×50-Banner ist absichtlich vorhersehbar und nimmt auf
    // einem Telefon weniger Raum ein als die großen adaptiven Formate.
    val size = if (availableWidthDp >= 320) AdSize.BANNER else AdSize(availableWidthDp, 50)
    val view = AdView(activity).apply {
      adUnitId = BuildConfig.ADMOB_BANNER_AD_UNIT_ID
      setAdSize(size)
    }
    adView?.destroy()
    frame.removeAllViews()
    frame.addView(
      view,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
      ),
    )
    adView = view
    view.loadAd(AdRequest.Builder().build())
  }

  override fun onPause() {
    adView?.pause()
  }

  override fun onResume() {
    adView?.resume()
  }

  override fun onDestroy(activity: AppCompatActivity) {
    adView?.destroy()
    adView = null
    container?.let { (it.parent as? ViewGroup)?.removeView(it) }
    container = null
  }
}
