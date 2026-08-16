/**
 * Zustand von Konto und Kiebitz Plus.
 *
 * Ein Modul-Singleton, kein React-State: Die Freischaltung wird an vielen
 * Stellen abgefragt, und jede neu geöffnete Seite soll nicht erneut bei
 * „lädt" beginnen. Komponenten hängen sich über `usePlus()` daran.
 *
 * Grundregeln:
 *   * Freigeschaltet ist nur, was in einem gültig signierten Token steht.
 *   * Fällt die API aus, bleibt der zwischengespeicherte Token gültig, bis er
 *     abläuft; danach gilt wieder Free. Ein Providerausfall darf Free nie
 *     blockieren.
 *   * Es werden keine Schachdaten übertragen · nur Anmeldung, Abrechnung und
 *     Freischaltung.
 */
import {
  PlusApiError,
  consumeAuthorizationCode,
  createCheckout,
  createPortalSession,
  deleteAccount,
  fetchAccount,
  fetchEntitlement,
  fetchJwks,
  logoutSession,
  requestMagicLink,
  verifyGooglePlayPurchase,
} from "./api";
import { acknowledgePurchase, playPurchaseTokens, purchasePlus } from "./billing";
import type { Locale } from "../i18n";
import { deleteSecret, readSecret, writeSecret } from "./storage";
import { claimsStillValid, verifyEntitlementToken } from "./token";
import {
  isPlusOnlyFeature,
  type CachedEntitlement,
  type CheckoutSession,
  type EntitlementClaims,
  type PlusAccount,
  type PlusFeature,
} from "./types";

/** Sperrzeit, bevor ein neuer Magic-Link angefordert werden darf. */
export const RESEND_LOCKOUT_SECONDS = 60;

/**
 * Nachlauf nach der Rückkehr aus dem Checkout. Der Stripe-Webhook trifft
 * asynchron ein; ohne diese kurzen Wiederholungen stünde direkt nach dem Kauf
 * noch „Free" da.
 */
const RETURN_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 40_000];

export interface PlusState {
  /** Der erste Blick in die sichere Ablage läuft noch. */
  loading: boolean;
  signedIn: boolean;
  account: PlusAccount | null;
  /** Geprüfte Claims des zwischengespeicherten Tokens. */
  claims: EntitlementClaims | null;
  /** Läuft gerade eine Aktualisierung? */
  refreshing: boolean;
  /** Letzter Fehler einer Aktualisierung · blockiert nichts. */
  error: PlusApiError | null;
  /** Zeitpunkt der letzten erfolgreichen Entitlement-Abfrage (ms). */
  fetchedAt: number | null;
  /** Frühester Zeitpunkt für den nächsten Magic-Link (ms). */
  resendAllowedAt: number;
}

const initialState: PlusState = {
  loading: true,
  signedIn: false,
  account: null,
  claims: null,
  refreshing: false,
  error: null,
  fetchedAt: null,
  resendAllowedAt: 0,
};

let state: PlusState = initialState;
const listeners = new Set<(next: PlusState) => void>();
let sessionToken: string | null = null;
let bootstrap: Promise<void> | null = null;
let returnTimers: ReturnType<typeof setTimeout>[] = [];

function setState(patch: Partial<PlusState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function plusState(): PlusState {
  return state;
}

export function subscribePlus(listener: (next: PlusState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Aktive Sitzung · nur innerhalb dieses Moduls und für Tests interessant. */
export function currentSessionToken(): string | null {
  return sessionToken;
}

function cancelReturnPolling(): void {
  returnTimers.forEach((timer) => clearTimeout(timer));
  returnTimers = [];
}

async function clearSession(): Promise<void> {
  cancelReturnPolling();
  sessionToken = null;
  await Promise.all([deleteSecret("session"), deleteSecret("entitlement")]);
  setState({ signedIn: false, account: null, claims: null, error: null, fetchedAt: null });
}

/** Den zwischengespeicherten Token prüfen · offline der einzige Weg zu Plus. */
async function restoreCachedEntitlement(now: number): Promise<EntitlementClaims | null> {
  const raw = await readSecret("entitlement");
  if (!raw) return null;
  let cached: CachedEntitlement;
  try {
    cached = JSON.parse(raw) as CachedEntitlement;
  } catch {
    await deleteSecret("entitlement");
    return null;
  }
  if (!cached?.token || !cached.jwks?.keys?.length) return null;
  try {
    const claims = await verifyEntitlementToken(cached.token, cached.jwks, now);
    setState({ fetchedAt: cached.fetched_at ?? null });
    return claims;
  } catch {
    // Abgelaufen oder nicht mehr prüfbar: still auf Free zurück. Der nächste
    // erfolgreiche Netzaufruf stellt Plus wieder her.
    await deleteSecret("entitlement");
    return null;
  }
}

/**
 * Einmalige Initialisierung: Sitzung und Token aus der sicheren Ablage holen,
 * danach im Hintergrund aktualisieren, wenn das nötig ist.
 */
export function initPlus(): Promise<void> {
  if (bootstrap) return bootstrap;
  bootstrap = (async () => {
    const now = Date.now();
    const [session, claims] = await Promise.all([
      readSecret("session"),
      restoreCachedEntitlement(now),
    ]);
    sessionToken = session;
    setState({ loading: false, signedIn: Boolean(session), claims });
    if (session) void refreshEntitlement().catch(() => {});
  })();
  return bootstrap;
}

/** Steht eine Aktualisierung an? `refresh_after` der letzten Antwort zählt. */
async function refreshDue(now: number): Promise<boolean> {
  const raw = await readSecret("entitlement");
  if (!raw) return true;
  try {
    const cached = JSON.parse(raw) as CachedEntitlement;
    if (!cached.refresh_after) return true;
    return Date.parse(cached.refresh_after) <= now;
  } catch {
    return true;
  }
}

/**
 * Entitlement neu holen, prüfen und ablegen.
 *
 * Der Aufruf schlägt bewusst nicht durch: Die Oberfläche zeigt den Fehler an,
 * arbeitet aber mit dem zuletzt gültigen Stand weiter.
 */
export async function refreshEntitlement(options: { force?: boolean } = {}): Promise<void> {
  if (!sessionToken) return;
  const now = Date.now();
  if (!options.force && !(await refreshDue(now))) return;
  if (state.refreshing) return;
  setState({ refreshing: true });
  const token = sessionToken;
  try {
    const [account, entitlement, jwks] = await Promise.all([
      fetchAccount(token),
      fetchEntitlement(token),
      fetchJwks(),
    ]);
    const claims = await verifyEntitlementToken(
      entitlement.entitlement_token,
      jwks,
      Date.now(),
      account.id
    );
    const cached: CachedEntitlement = {
      token: entitlement.entitlement_token,
      fetched_at: Date.now(),
      refresh_after: entitlement.refresh_after,
      jwks,
    };
    await writeSecret("entitlement", JSON.stringify(cached));
    setState({
      account,
      claims,
      error: null,
      refreshing: false,
      signedIn: true,
      fetchedAt: cached.fetched_at,
    });
  } catch (error) {
    // Eine ungültige Sitzung ist der einzige Fehler, der den lokalen Zustand
    // ändert · alles andere lässt den zwischengespeicherten Token stehen.
    if (error instanceof PlusApiError && (error.status === 401 || error.status === 403)) {
      await clearSession();
      setState({ refreshing: false, error });
      return;
    }
    setState({
      refreshing: false,
      error: error instanceof PlusApiError ? error : new PlusApiError(0, "refresh_failed", String(error)),
    });
  }
}

/**
 * Magic-Link anfordern; erst nach der Sperrzeit wieder möglich.
 *
 * `locale` reicht die Oberfläche durch · der Store kennt die Spracheinstellung
 * nicht und soll sie auch nicht erraten.
 */
export async function requestSignInLink(email: string, locale: Locale): Promise<void> {
  const now = Date.now();
  if (now < state.resendAllowedAt) {
    throw new PlusApiError(429, "rate_limited", "resend locked");
  }
  await requestMagicLink(email.trim(), locale);
  setState({ resendAllowedAt: now + RESEND_LOCKOUT_SECONDS * 1000, error: null });
}

/** Einmalcode aus `kiebitz://auth?code=…` einlösen. */
export async function signInWithCode(code: string): Promise<void> {
  const session = await consumeAuthorizationCode(code);
  sessionToken = session.access_token;
  await writeSecret("session", session.access_token);
  setState({ signedIn: true, error: null, resendAllowedAt: 0 });
  await refreshEntitlement({ force: true });
}

export async function signOut(): Promise<void> {
  const token = sessionToken;
  // Erst lokal abmelden: Ob der Server die Sitzung noch widerrufen kann, darf
  // nicht darüber entscheiden, ob das Gerät abgemeldet ist.
  await clearSession();
  if (token) await logoutSession(token).catch(() => {});
}

/** Konto löschen. Wirft bei laufendem Abo mit `409 active_subscription`. */
export async function deletePlusAccount(): Promise<void> {
  if (!sessionToken) return;
  await deleteAccount(sessionToken);
  await clearSession();
}

export function startCheckout(locale: Locale): Promise<CheckoutSession> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  return createCheckout(sessionToken, locale);
}

/**
 * Kiebitz Plus über Google Play kaufen.
 *
 * Die Reihenfolge ist die ganze Sicherheit dieser Funktion: kaufen, von der
 * API gegen Google prüfen lassen, erst dann gegenüber Google bestätigen. Wer
 * zuerst bestätigt und danach prüft, verschenkt die einzige Rückholung, die
 * Google vorsieht · ein unbestätigter Kauf wird nach drei Tagen erstattet.
 */
export async function purchaseWithGooglePlay(): Promise<"purchased" | "pending" | "cancelled"> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  const accountId = state.account?.id ?? "";
  const outcome = await purchasePlus(accountId);
  if (outcome.state === "cancelled" || !outcome.purchase_token) return "cancelled";

  await verifyGooglePlayPurchase(sessionToken, outcome.purchase_token);
  if (outcome.state === "purchased") {
    // Scheitert nur die Bestätigung, ist Plus trotzdem zugeordnet · das
    // Wiederherstellen holt sie beim nächsten Mal nach.
    await acknowledgePurchase(outcome.purchase_token).catch(() => {});
  }
  await refreshEntitlement({ force: true });
  return outcome.state;
}

/**
 * Vorhandene Play-Käufe erneut zuordnen.
 *
 * Nach einem Gerätewechsel, einer Neuinstallation oder einer abgebrochenen
 * Zuordnung kennt Google den Kauf weiterhin. Gibt die Zahl der Käufe zurück,
 * die die API angenommen hat.
 *
 * Ein einzelnes Token, das die API zurückweist, bricht den Vorgang nicht ab:
 * In einem Play-Konto können Abos anderer Apps oder abgelaufene Käufe liegen,
 * und deretwegen soll ein gültiger Kauf daneben nicht liegen bleiben.
 */
export async function restoreGooglePlayPurchases(): Promise<number> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  const tokens = await playPurchaseTokens();
  let restored = 0;
  for (const purchaseToken of tokens) {
    try {
      await verifyGooglePlayPurchase(sessionToken, purchaseToken);
      await acknowledgePurchase(purchaseToken).catch(() => {});
      restored += 1;
    } catch {
      // Nicht unser Produkt oder nicht mehr gültig · der nächste Kauf zählt.
    }
  }
  if (restored > 0) await refreshEntitlement({ force: true });
  return restored;
}

export function startPortal(): Promise<{ portal_url: string }> {
  if (!sessionToken) throw new PlusApiError(401, "authentication_required", "not signed in");
  return createPortalSession(sessionToken);
}

/**
 * Nach der Rückkehr aus Checkout oder Portal mehrfach mit wachsendem Abstand
 * nachfragen. Sobald Plus aktiv ist, hört das Nachfragen auf.
 */
export function pollAfterReturn(): void {
  if (!sessionToken) return;
  cancelReturnPolling();
  returnTimers = RETURN_BACKOFF_MS.map((delay) =>
    setTimeout(() => {
      if (state.claims?.plan === "plus") {
        cancelReturnPolling();
        return;
      }
      void refreshEntitlement({ force: true }).catch(() => {});
    }, delay)
  );
}

/** Prüft eine Feature-ID gegen den geprüften Token. */
export function featureUnlocked(feature: PlusFeature, current: PlusState = state): boolean {
  if (!isPlusOnlyFeature(feature)) return true;
  const claims = current.claims;
  if (!claims || claims.plan !== "plus") return false;
  if (!claimsStillValid(claims)) return false;
  return claims.features.includes(feature);
}

/**
 * Nur für Tests · setzt einen Zustand ein, ohne über das Netz zu gehen.
 *
 * Die Oberflächentests prüfen die Funktionen selbst, nicht das Gate davor;
 * sie brauchen deshalb einen Weg, eine geprüfte Berechtigung zu setzen.
 */
export function setPlusStateForTests(patch: Partial<PlusState>): void {
  setState(patch);
}

/** Nur für Tests · setzt das Singleton in den Ausgangszustand zurück. */
export function resetPlusStore(): void {
  cancelReturnPolling();
  state = initialState;
  sessionToken = null;
  bootstrap = null;
  listeners.clear();
}
