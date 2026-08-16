package de.torim.kiebitz

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import java.util.concurrent.atomic.AtomicReference

/**
 * Kiebitz Plus über Google Play Billing.
 *
 * Google verlangt für digitale Inhalte innerhalb der App seinen eigenen
 * Bezahlweg. Diese Brücke macht genau drei Dinge: kaufen, vorhandene Käufe
 * wiederfinden und einen vom Server geprüften Kauf bestätigen.
 *
 * Was sie ausdrücklich nicht tut, ist entscheiden, ob Plus gilt. Der Kauf
 * liefert nur ein Token; ob daraus eine Berechtigung wird, prüft die API gegen
 * Google und schreibt es in das signierte Entitlement. Ein Client, der sich
 * selbst freischalten kann, ist keine Freischaltung.
 *
 * `acknowledge` läuft deshalb erst, nachdem die API den Kauf bestätigt hat:
 * Ein nicht bestätigter Kauf wird von Google nach drei Tagen erstattet · genau
 * das soll passieren, wenn die Zuordnung zum Konto scheitert.
 */
@TauriPlugin
class BillingPlugin(private val activity: Activity) : Plugin(activity) {
  /**
   * Der laufende Kauf. Google meldet das Ergebnis nicht am Aufruf, sondern am
   * Listener des Clients · dieser Platz verbindet beide wieder.
   */
  private val pendingPurchase = AtomicReference<Invoke?>(null)

  private val purchaseListener = PurchasesUpdatedListener { result, purchases ->
    val invoke = pendingPurchase.getAndSet(null) ?: return@PurchasesUpdatedListener
    when (result.responseCode) {
      BillingClient.BillingResponseCode.OK -> {
        val purchase = purchases?.firstOrNull()
        if (purchase == null) {
          invoke.resolve(JSObject().apply { put("state", "cancelled") })
        } else {
          invoke.resolve(purchase.toResult())
        }
      }
      // Abbrechen ist kein Fehler · die Oberfläche soll keine Meldung zeigen.
      BillingClient.BillingResponseCode.USER_CANCELED ->
        invoke.resolve(JSObject().apply { put("state", "cancelled") })
      else -> invoke.reject(result.describe())
    }
  }

  private val client: BillingClient by lazy {
    BillingClient.newBuilder(activity)
      .setListener(purchaseListener)
      .enablePendingPurchases(
        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
      )
      .build()
  }

  /* ── Verbindung ─────────────────────────────────────────────────────────── */

  /**
   * Stellt sicher, dass der Client verbunden ist.
   *
   * Die Verbindung bricht ab, wenn der Play Store aktualisiert wird. Jeder
   * Aufruf prüft sie deshalb erneut, statt sich auf eine einmalige
   * Einrichtung beim Start zu verlassen.
   */
  private fun withConnection(invoke: Invoke, action: () -> Unit) {
    if (client.isReady) {
      action()
      return
    }
    client.startConnection(object : BillingClientStateListener {
      override fun onBillingSetupFinished(result: BillingResult) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK) action()
        else invoke.reject(result.describe())
      }

      override fun onBillingServiceDisconnected() {
        // Kein Neuverbinden von selbst: Der nächste Aufruf tut es ohnehin,
        // und eine Schleife im Hintergrund kostet nur Akku.
      }
    })
  }

  /* ── Befehle ────────────────────────────────────────────────────────────── */

  /**
   * Steht Google Play Billing auf diesem Gerät bereit?
   *
   * Auf Geräten ohne Play Services · etwa einem Sideload-Build · ist die
   * Antwort `false`, und die Oberfläche verweist auf Desktop und Website,
   * statt einen Kaufknopf zu zeigen, der nichts tun kann.
   */
  @Command
  fun isAvailable(invoke: Invoke) {
    withConnection(invoke) {
      val supported = client
        .isFeatureSupported(BillingClient.FeatureType.SUBSCRIPTIONS)
        .responseCode == BillingClient.BillingResponseCode.OK
      invoke.resolve(JSObject().apply { put("available", supported) })
    }
  }

  @Command
  fun purchase(invoke: Invoke) {
    val args = invoke.getArgs()
    val productId = args.getString("productId", "")
    val accountId = args.getString("accountId", "")
    if (productId.isNullOrBlank()) {
      invoke.reject("Kein Produkt angegeben.")
      return
    }

    withConnection(invoke) {
      val query = QueryProductDetailsParams.newBuilder()
        .setProductList(
          listOf(
            QueryProductDetailsParams.Product.newBuilder()
              .setProductId(productId)
              .setProductType(BillingClient.ProductType.SUBS)
              .build()
          )
        )
        .build()

      client.queryProductDetailsAsync(query) { result, products ->
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
          invoke.reject(result.describe())
          return@queryProductDetailsAsync
        }
        val product = products.firstOrNull()
        val offerToken = product?.bestOfferToken()
        if (product == null || offerToken == null) {
          invoke.reject("Kiebitz Plus ist in diesem Play-Konto nicht verfügbar.")
          return@queryProductDetailsAsync
        }

        val flow = BillingFlowParams.newBuilder()
          .setProductDetailsParamsList(
            listOf(
              BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product)
                .setOfferToken(offerToken)
                .build()
            )
          )
          .apply {
            // Verbindet den Kauf mit dem Kiebitz-Konto. Die Konto-ID ist eine
            // undurchsichtige Kennung, keine Adresse · genau dafür ist das Feld
            // gedacht, und Google nutzt sie zur Missbrauchserkennung.
            if (!accountId.isNullOrBlank()) setObfuscatedAccountId(accountId)
          }
          .build()

        // Erst jetzt eintragen: Vorher könnte ein Fehler oben den Platz
        // belegen und den nächsten Kaufversuch stumm verschlucken.
        pendingPurchase.set(invoke)
        val launch = client.launchBillingFlow(activity, flow)
        if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
          pendingPurchase.compareAndSet(invoke, null)
          invoke.reject(launch.describe())
        }
      }
    }
  }

  /**
   * Vorhandene Abos dieses Play-Kontos.
   *
   * Das ist der Weg zurück nach einem Gerätewechsel, einer Neuinstallation
   * oder einer abgebrochenen Zuordnung: Google kennt den Kauf weiterhin, und
   * die App reicht die Token erneut zur Prüfung an die API.
   */
  @Command
  fun restore(invoke: Invoke) {
    withConnection(invoke) {
      val query = QueryPurchasesParams.newBuilder()
        .setProductType(BillingClient.ProductType.SUBS)
        .build()
      client.queryPurchasesAsync(query) { result, purchases ->
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
          invoke.reject(result.describe())
          return@queryPurchasesAsync
        }
        val tokens = JSONArray()
        for (purchase in purchases) {
          if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
            tokens.put(purchase.purchaseToken)
          }
        }
        invoke.resolve(JSObject().apply { put("tokens", tokens) })
      }
    }
  }

  /**
   * Bestätigt einen Kauf, den die API bereits geprüft hat.
   *
   * Ohne Bestätigung erstattet Google nach drei Tagen. Ein zweiter Aufruf für
   * denselben Kauf ist harmlos und wird still hingenommen · nach einem
   * Wiederherstellen ist er der Normalfall.
   */
  @Command
  fun acknowledge(invoke: Invoke) {
    val token = invoke.getArgs().getString("purchaseToken", "")
    if (token.isNullOrBlank()) {
      invoke.reject("Kein Kauf angegeben.")
      return
    }
    withConnection(invoke) {
      val params = AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build()
      client.acknowledgePurchase(params) { result ->
        val done = result.responseCode == BillingClient.BillingResponseCode.OK ||
          result.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED
        if (done) invoke.resolve(JSObject().apply { put("acknowledged", true) })
        else invoke.reject(result.describe())
      }
    }
  }

  /* ── Hilfen ─────────────────────────────────────────────────────────────── */

  /**
   * Das Angebot, das der Nutzer bekommen soll.
   *
   * Google liefert nur Angebote, für die dieses Konto in Frage kommt. Steht
   * ein kostenloser Zeitraum darunter, ist das der richtige · wer Anspruch auf
   * den Testzeitraum hat, soll ihn nicht deshalb verlieren, weil die App das
   * erste Angebot der Liste genommen hat.
   */
  private fun ProductDetails.bestOfferToken(): String? {
    val offers = subscriptionOfferDetails ?: return null
    val free = offers.firstOrNull { offer ->
      offer.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L }
    }
    return (free ?: offers.firstOrNull())?.offerToken
  }

  private fun Purchase.toResult(): JSObject = JSObject().apply {
    put(
      "state",
      if (purchaseState == Purchase.PurchaseState.PURCHASED) "purchased" else "pending"
    )
    put("purchaseToken", purchaseToken)
  }

  /**
   * Fehlertext für die Oberfläche.
   *
   * Der Antwortcode gehört dazu: Er ist das Einzige, womit ein Support-Fall
   * später etwas anfangen kann.
   */
  private fun BillingResult.describe(): String =
    "Google Play meldet einen Fehler (${responseCode})" +
      if (debugMessage.isNullOrBlank()) "." else ": $debugMessage"
}
