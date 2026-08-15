/**
 * Prüfung des signierten Entitlement-Tokens (ES256).
 *
 * Freigeschaltet wird ausschließlich, was in einem gültig signierten Token
 * steht. Die JSON-Antwort von `/v1/entitlements/me` ist nur die Verpackung:
 * Sie wird nie als dauerhafte Freischaltung übernommen, sonst genügte ein
 * abgefangener oder nachgebauter HTTP-Body.
 *
 * Geprüft werden Algorithmus, `kid`, Signatur, Aussteller, Zielgruppe, Ablauf
 * und die Featureliste. Ein abgelaufener Token schaltet offline still auf Free
 * zurück · das ist der sichere Zustand, nicht ein Fehlerdialog.
 */
import {
  ALL_FEATURES,
  type EntitlementClaims,
  type EntitlementJwk,
  type JsonWebKeySet,
  type PlusFeature,
} from "./types";

export const ENTITLEMENT_ISSUER = "https://api.kiebitz.dev";
export const ENTITLEMENT_AUDIENCE = "kiebitz-app";

/** Toleranz für Uhrenversatz zwischen Gerät und Server. */
const CLOCK_SKEW_SECONDS = 120;

export class EntitlementTokenError extends Error {
  constructor(readonly reason: string) {
    super(`entitlement token rejected: ${reason}`);
    this.name = "EntitlementTokenError";
  }
}

/** Base64url ohne Padding → Bytes. */
export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonSegment(segment: string): unknown {
  const text = new TextDecoder().decode(base64UrlToBytes(segment));
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Nur bekannte Feature-IDs werden übernommen. Eine neuere API darf zusätzliche
 * nennen, ohne dass eine ältere App daran scheitert; freischalten kann sie
 * ohnehin nur, was sie selbst kennt.
 */
function knownFeatures(value: unknown): PlusFeature[] {
  const known = new Set<string>(ALL_FEATURES);
  return stringList(value).filter((item): item is PlusFeature => known.has(item));
}

function claimsFrom(payload: Record<string, unknown>): EntitlementClaims {
  const plan = payload.plan === "plus" ? "plus" : "free";
  const status = payload.status === "active" || payload.status === "grace" ? payload.status : null;
  const provider = typeof payload.provider === "string" ? payload.provider : null;
  return {
    iss: String(payload.iss ?? ""),
    sub: String(payload.sub ?? ""),
    aud: String(payload.aud ?? ""),
    plan,
    features: knownFeatures(payload.features),
    provider: provider as EntitlementClaims["provider"],
    providers: stringList(payload.providers) as EntitlementClaims["providers"],
    status,
    trial: payload.trial === true,
    trial_until: optionalSeconds(payload.trial_until),
    entitlement_valid_until: optionalSeconds(payload.entitlement_valid_until),
    iat: optionalSeconds(payload.iat) ?? 0,
    exp: optionalSeconds(payload.exp) ?? 0,
  };
}

/** Der Schlüssel mit dieser `kid` aus dem Schlüsselsatz. */
function selectKey(jwks: JsonWebKeySet, kid: string): EntitlementJwk {
  const key = jwks.keys?.find((candidate) => candidate.kid === kid);
  if (!key) throw new EntitlementTokenError("unknown_key_id");
  if (key.kty !== "EC" || key.crv !== "P-256" || !key.x || !key.y) {
    throw new EntitlementTokenError("unsupported_key");
  }
  if (key.alg && key.alg !== "ES256") throw new EntitlementTokenError("unsupported_key_algorithm");
  return key;
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new EntitlementTokenError("webcrypto_unavailable");
  return subtle;
}

/**
 * Prüft Signatur und Aussagen des Tokens und liefert die Claims.
 *
 * `now` ist in Millisekunden und nur für Tests ein Parameter.
 */
export async function verifyEntitlementToken(
  token: string,
  jwks: JsonWebKeySet,
  now: number = Date.now(),
  expectedSubject?: string
): Promise<EntitlementClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new EntitlementTokenError("malformed_token");
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  let header: unknown;
  let payload: unknown;
  try {
    header = decodeJsonSegment(headerSegment);
    payload = decodeJsonSegment(payloadSegment);
  } catch {
    throw new EntitlementTokenError("malformed_token");
  }
  if (!isRecord(header) || !isRecord(payload)) throw new EntitlementTokenError("malformed_token");
  if (header.alg !== "ES256") throw new EntitlementTokenError("unsupported_algorithm");
  if (typeof header.kid !== "string") throw new EntitlementTokenError("missing_key_id");

  const jwk = selectKey(jwks, header.kid);
  const subtle = subtleCrypto();
  const key = await subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  // ES256 signiert `header.payload`; die Signatur ist das rohe r‖s-Paar, genau
  // das erwartet WebCrypto für ECDSA (im Gegensatz zur DER-Form von OpenSSL).
  const signature = base64UrlToBytes(signatureSegment);
  if (signature.length !== 64) throw new EntitlementTokenError("malformed_signature");
  const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const valid = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed);
  if (!valid) throw new EntitlementTokenError("invalid_signature");

  const claims = claimsFrom(payload);
  if (claims.iss !== ENTITLEMENT_ISSUER) throw new EntitlementTokenError("unexpected_issuer");
  if (claims.aud !== ENTITLEMENT_AUDIENCE) throw new EntitlementTokenError("unexpected_audience");
  if (!claims.sub) throw new EntitlementTokenError("missing_subject");
  if (expectedSubject !== undefined && claims.sub !== expectedSubject) {
    throw new EntitlementTokenError("unexpected_subject");
  }
  const nowSeconds = Math.floor(now / 1000);
  if (claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS) throw new EntitlementTokenError("expired");
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new EntitlementTokenError("issued_in_future");
  if (claims.plan === "plus" && claims.features.length === 0) {
    throw new EntitlementTokenError("empty_feature_list");
  }
  return claims;
}

/** Ist der Token zum angegebenen Zeitpunkt noch gültig? */
export function claimsStillValid(claims: EntitlementClaims, now: number = Date.now()): boolean {
  return claims.exp > Math.floor(now / 1000) - CLOCK_SKEW_SECONDS;
}
