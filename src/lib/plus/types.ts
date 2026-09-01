/**
 * Typen der Kiebitz-Plus-Berechtigung.
 *
 * Die Feature-IDs sind die verbindliche Liste aus `docs/KIEBITZ_PLUS.md` der
 * API. Sie stehen hier einmal und nirgends sonst als Zeichenkette · ein Gate
 * mit Tippfehler soll der Typ-Checker abfangen, nicht der Nutzer.
 *
 * Kiebitz bleibt local-first: Das Konto trägt Anmeldung, Abrechnung und die
 * signierte Freischaltung. Partien, Analysen und Trainingsdaten verlassen das
 * Gerät dafür nicht.
 */

/** In jeder Installation freigeschaltet, auch ohne Konto. */
export const FREE_FEATURES = ["basic_analysis", "manual_training", "basic_statistics"] as const;

/** Nur mit gültigem Plus · Reihenfolge wie in der Featurematrix. */
export const PLUS_ONLY_FEATURES = [
  "background_analysis",
  "full_insights",
  "personal_puzzles",
  "adaptive_plan",
  "automatic_lan_sync",
  "widgets",
  "advanced_themes",
  "focus_board",
  "opening_explorer",
  "reference_database",
  "no_ads",
] as const;

export type FreeFeature = (typeof FREE_FEATURES)[number];
export type PlusOnlyFeature = (typeof PLUS_ONLY_FEATURES)[number];
export type PlusFeature = FreeFeature | PlusOnlyFeature;

export const ALL_FEATURES: readonly PlusFeature[] = [...FREE_FEATURES, ...PLUS_ONLY_FEATURES];

export function isPlusOnlyFeature(feature: PlusFeature): feature is PlusOnlyFeature {
  return (PLUS_ONLY_FEATURES as readonly string[]).includes(feature);
}

export type PlusPlan = "free" | "plus";
export type PlusStatus = "active" | "grace" | null;
export type BillingProvider = "stripe" | "google_play" | "manual";

/** Antwort von `GET /v1/account/me`. */
export interface PlusAccount {
  id: string;
  email: string;
  plan: PlusPlan;
  status: PlusStatus;
  providers: BillingProvider[];
  trial: boolean;
  /** Nur dann darf der Trial-CTA erscheinen. */
  trial_eligible: boolean;
}

/** Antwort von `GET /v1/entitlements/me`. */
export interface EntitlementResponse {
  plan: PlusPlan;
  features: string[];
  status: PlusStatus;
  provider: BillingProvider | null;
  providers: BillingProvider[];
  trial: boolean;
  /** ISO-8601 oder null. */
  trial_until: string | null;
  valid_until: string | null;
  refresh_after: string | null;
  entitlement_token: string;
}

/** Geprüfte Nutzlast des ES256-Tokens · nur das gilt als Freischaltung. */
export interface EntitlementClaims {
  iss: string;
  sub: string;
  aud: string;
  plan: PlusPlan;
  features: PlusFeature[];
  provider: BillingProvider | null;
  providers: BillingProvider[];
  status: PlusStatus;
  trial: boolean;
  /** Unix-Sekunden oder null. */
  trial_until: number | null;
  entitlement_valid_until: number | null;
  iat: number;
  exp: number;
}

/**
 * Was lokal zwischengespeichert wird: der signierte Token, die Metadaten der
 * Antwort und der öffentliche Schlüsselsatz, gegen den geprüft wurde.
 *
 * Der Schlüsselsatz gehört mit in die sichere Ablage. Läge er als Klartext
 * daneben, könnte ihn jemand austauschen und sich damit selbst ein gültig
 * aussehendes Entitlement ausstellen.
 */
export interface CachedEntitlement {
  token: string;
  /** Zeitpunkt der letzten erfolgreichen Abfrage (Unix-Millisekunden). */
  fetched_at: number;
  refresh_after: string | null;
  jwks: JsonWebKeySet;
}

export interface JsonWebKeySet {
  keys: EntitlementJwk[];
}

export interface EntitlementJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg?: string;
  use?: string;
}

/** Antwort des Stripe-Checkouts. */
export interface CheckoutSession {
  checkout_url: string;
  /** 0, wenn kein Trial mehr zusteht. */
  trial_days: number;
}

export interface PortalSession {
  portal_url: string;
}

/** Bearer-Sitzung der App (nicht der Website · die bekommt ein Cookie). */
export interface AppSession {
  token_type: string;
  access_token: string;
  expires_in: number;
}
