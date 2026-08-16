/**
 * Google Play Billing.
 *
 * Auf Android kauft man Kiebitz Plus über Google Play. Das ist keine
 * Geschmacksfrage: Google verlangt für digitale Inhalte innerhalb der App
 * seinen eigenen Bezahlweg, und ein Verweis auf den Stripe-Checkout im
 * Systembrowser ist der klassische Ablehnungsgrund im Review.
 *
 * Diese Datei kennt nur den nativen Teil · Kaufdialog, vorhandene Käufe,
 * Bestätigung. Was daraus für die Berechtigung folgt, entscheidet der Store
 * zusammen mit der API.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Produkt-ID des Abos in der Play Console.
 *
 * Der Preis steht bewusst nicht hier und nirgends sonst im App-Code · er wird
 * in Google Play gepflegt und im Kaufdialog genannt. Diese Kennung ist keine
 * Preisangabe, sondern der Name des Produkts.
 */
export const PLUS_PRODUCT_ID = "kiebitz_plus";

export interface PurchaseOutcome {
  state: "purchased" | "pending" | "cancelled";
  purchase_token: string | null;
}

/**
 * Steht der Play-Kaufweg auf diesem Gerät bereit?
 *
 * `false` auf Desktop, im Browser und auf Android-Geräten ohne Play Services
 * · etwa einem seitlich installierten Build. Dort zeigt die Oberfläche keinen
 * Kaufknopf, der ohnehin nichts tun könnte.
 */
export async function billingAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>("billing_available");
  } catch {
    return false;
  }
}

/** Öffnet den Play-Kaufdialog. Ein Abbruch ist kein Fehler. */
export function purchasePlus(accountId: string): Promise<PurchaseOutcome> {
  return invoke<PurchaseOutcome>("billing_purchase", {
    productId: PLUS_PRODUCT_ID,
    accountId,
  });
}

/** Kauftoken der Abos dieses Play-Kontos · der Weg zurück nach einem Gerätewechsel. */
export function playPurchaseTokens(): Promise<string[]> {
  return invoke<string[]>("billing_restore");
}

/**
 * Bestätigt einen Kauf gegenüber Google.
 *
 * Erst nach der Prüfung durch die API: Ein unbestätigter Kauf wird nach drei
 * Tagen erstattet, und genau das soll passieren, wenn die Zuordnung zum Konto
 * nicht geklappt hat.
 */
export function acknowledgePurchase(purchaseToken: string): Promise<boolean> {
  return invoke<boolean>("billing_acknowledge", { purchaseToken });
}
