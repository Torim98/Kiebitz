/**
 * HTTP-Client für die Kiebitz-API.
 *
 * Nur Konto, Abrechnung und Freischaltung laufen hierüber. Es werden keine
 * Partien, Analysen, Trainingsdaten oder Einstellungen übertragen; die Aufrufe
 * unten sind vollständig, mehr Endpunkte kennt die App nicht. Die einzige
 * Ausnahme ist das Lebenszeichen der Statistik in `lib/analytics.ts` · es hängt
 * an keinem Konto und benutzt von hier nur `apiRequest`.
 *
 * Die App authentifiziert sich mit `Authorization: Bearer <token>`. Das
 * Cookie-/CSRF-Modell gilt ausschließlich für die Website.
 */
import type { Locale } from "../i18n";
import type {
  AppSession,
  CheckoutSession,
  EntitlementResponse,
  JsonWebKeySet,
  PlusAccount,
  PortalSession,
} from "./types";

export const API_ORIGIN = "https://api.kiebitz.dev";

/** Fehler der API mit ihrem maschinenlesbaren Code. */
export class PlusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PlusApiError";
  }

  /** Kein Netz, DNS tot, Zertifikatsfehler · kein Zustand des Kontos. */
  get offline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  /** Zusätzliche Köpfe · bislang nur der Einwilligungskopf der Statistik. */
  headers?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ein Aufruf gegen die API. Fehlerantworten der API tragen
 * `{ error: { code, message, details } }`; alles andere wird auf denselben
 * Fehlertyp abgebildet, damit die Oberfläche nur einen Fall kennt.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  Object.assign(headers, options.headers);

  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Die App schickt bewusst keine Cookies · ihre Sitzung ist der Bearer.
      credentials: "omit",
      signal,
    });
  } catch (error) {
    throw new PlusApiError(0, "network_unavailable", String(error));
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    throw new PlusApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "request_failed",
      typeof error?.message === "string" ? error.message : `HTTP ${response.status}`,
      isRecord(error?.details) ? error.details : undefined
    );
  }
  return payload as T;
}

/**
 * Magic-Link anfordern. Der Link öffnet `kiebitz://auth?code=…`; ein zweiter
 * Aufruf für dieselbe Adresse entwertet den vorherigen Link.
 *
 * `locale` ist die in Kiebitz eingestellte Sprache, nicht die des
 * Betriebssystems: Wer die App auf Französisch bedient, soll die Mail auf
 * Französisch bekommen, auch auf einem englischen Windows.
 */
export function requestMagicLink(
  email: string,
  locale: Locale,
  signal?: AbortSignal
): Promise<{ accepted: boolean }> {
  return apiRequest<{ accepted: boolean }>("/v1/auth/magic-link/request", {
    method: "POST",
    body: { email: email.trim(), client: "app", locale },
    signal,
  });
}

/** Einmalcode aus dem Deep Link gegen eine Sitzung tauschen. */
export function consumeAuthorizationCode(code: string, signal?: AbortSignal): Promise<AppSession> {
  return apiRequest<AppSession>("/v1/auth/magic-link/consume", {
    method: "POST",
    body: { code },
    signal,
  });
}

export function fetchAccount(token: string, signal?: AbortSignal): Promise<PlusAccount> {
  return apiRequest<PlusAccount>("/v1/account/me", { token, signal });
}

export function fetchEntitlement(token: string, signal?: AbortSignal): Promise<EntitlementResponse> {
  return apiRequest<EntitlementResponse>("/v1/entitlements/me", { token, signal });
}

export function fetchJwks(signal?: AbortSignal): Promise<JsonWebKeySet> {
  return apiRequest<JsonWebKeySet>("/.well-known/jwks.json", { signal });
}

export function logoutSession(token: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>("/v1/auth/logout", { method: "POST", token, signal });
}

/**
 * Checkout eröffnen. Die Sprache bestimmt sowohl die Stripe-Seite als auch die
 * spätere Vertragsbestätigung · deshalb reist sie mit, statt dass der Server
 * aus einem Accept-Language-Kopf raten muss.
 */
export function createCheckout(
  token: string,
  locale: Locale,
  signal?: AbortSignal
): Promise<CheckoutSession> {
  return apiRequest<CheckoutSession>("/v1/billing/stripe/checkout", {
    method: "POST",
    body: { locale },
    token,
    signal,
  });
}

/**
 * Ein Google-Play-Kauf dem Konto zuordnen.
 *
 * Der Client schickt nur das Token. Ob daraus Plus wird, prüft die API gegen
 * Google · eine App, die sich selbst freischalten könnte, wäre keine
 * Freischaltung. Antwort ist 204, der neue Stand kommt aus dem nächsten
 * Entitlement.
 */
export function verifyGooglePlayPurchase(
  token: string,
  purchaseToken: string,
  signal?: AbortSignal
): Promise<void> {
  return apiRequest<void>("/v1/purchases/google-play/verify", {
    method: "POST",
    body: { purchase_token: purchaseToken },
    token,
    signal,
  });
}

export function createPortalSession(token: string, signal?: AbortSignal): Promise<PortalSession> {
  return apiRequest<PortalSession>("/v1/billing/stripe/portal", {
    method: "POST",
    token,
    signal,
  });
}

/**
 * Konto löschen. Läuft noch ein Abo, antwortet die API mit `409
 * active_subscription` und nennt in `details.providers`, wo gekündigt werden
 * muss · die Oberfläche führt den Nutzer dann zuerst dorthin.
 */
export function deleteAccount(token: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>("/v1/account", {
    method: "DELETE",
    body: { confirmation: "DELETE" },
    token,
    signal,
  });
}

/** Provider aus einer `409 active_subscription`-Antwort. */
export function renewingProvidersOf(error: unknown): string[] {
  if (!(error instanceof PlusApiError) || error.code !== "active_subscription") return [];
  const providers = error.details?.providers;
  return Array.isArray(providers) ? providers.filter((p): p is string => typeof p === "string") : [];
}
