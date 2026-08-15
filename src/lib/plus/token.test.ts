// @vitest-environment node
/**
 * Der Token entscheidet über die Freischaltung · alles hier prüft, dass er das
 * auch wirklich tut und nicht bloß gut aussieht.
 */
import { describe, expect, it } from "vitest";
import {
  EntitlementTokenError,
  base64UrlToBytes,
  claimsStillValid,
  verifyEntitlementToken,
} from "./token";
import type { JsonWebKeySet } from "./types";

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function keyPair(): Promise<{ jwks: JsonWebKeySet; privateKey: CryptoKey; kid: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "kiebitz-test-1";
  return {
    kid,
    privateKey: pair.privateKey,
    jwks: {
      keys: [
        {
          kty: "EC",
          crv: "P-256",
          x: publicJwk.x!,
          y: publicJwk.y!,
          alg: "ES256",
          use: "sig",
          kid,
        },
      ],
    },
  };
}

function defaultClaims(overrides: Record<string, unknown> = {}) {
  const seconds = Math.floor(NOW / 1000);
  return {
    iss: "https://api.kiebitz.dev",
    sub: "acc_1",
    aud: "kiebitz-app",
    plan: "plus",
    features: ["basic_analysis", "widgets", "no_ads", "something_from_the_future"],
    provider: "stripe",
    providers: ["stripe"],
    status: "active",
    trial: false,
    trial_until: null,
    entitlement_valid_until: seconds + 30 * 86_400,
    iat: seconds - 60,
    exp: seconds + 7 * 86_400,
    ...overrides,
  };
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {}
): Promise<string> {
  const head = encodeSegment({ alg: "ES256", typ: "JWT", kid, ...header });
  const payload = encodeSegment(claims);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${head}.${payload}`)
  );
  return `${head}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

describe("verifyEntitlementToken", () => {
  it("accepts a correctly signed token and keeps only known features", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const token = await signToken(privateKey, kid, defaultClaims());

    const claims = await verifyEntitlementToken(token, jwks, NOW);

    expect(claims.plan).toBe("plus");
    expect(claims.providers).toEqual(["stripe"]);
    // Eine neuere API darf zusätzliche IDs nennen; freischalten kann diese
    // Version nur, was sie selbst kennt.
    expect(claims.features).toEqual(["basic_analysis", "widgets", "no_ads"]);
  });

  it("rejects a token whose payload was changed after signing", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const token = await signToken(privateKey, kid, defaultClaims({ plan: "free" }));
    const [head, , signature] = token.split(".");
    const forged = `${head}.${encodeSegment(defaultClaims({ plan: "plus" }))}.${signature}`;

    await expect(verifyEntitlementToken(forged, jwks, NOW)).rejects.toThrow(EntitlementTokenError);
  });

  it("rejects a token signed by a different key", async () => {
    const mine = await keyPair();
    const other = await keyPair();
    const token = await signToken(other.privateKey, mine.kid, defaultClaims());

    await expect(verifyEntitlementToken(token, mine.jwks, NOW)).rejects.toMatchObject({
      reason: "invalid_signature",
    });
  });

  it("rejects an unknown key id", async () => {
    const { jwks, privateKey } = await keyPair();
    const token = await signToken(privateKey, "rotated-away", defaultClaims());

    await expect(verifyEntitlementToken(token, jwks, NOW)).rejects.toMatchObject({
      reason: "unknown_key_id",
    });
  });

  it("rejects a foreign issuer or audience", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const wrongIssuer = await signToken(
      privateKey,
      kid,
      defaultClaims({ iss: "https://evil.example" })
    );
    const wrongAudience = await signToken(privateKey, kid, defaultClaims({ aud: "kiebitz-web" }));

    await expect(verifyEntitlementToken(wrongIssuer, jwks, NOW)).rejects.toMatchObject({
      reason: "unexpected_issuer",
    });
    await expect(verifyEntitlementToken(wrongAudience, jwks, NOW)).rejects.toMatchObject({
      reason: "unexpected_audience",
    });
  });

  it("rejects an expired token so the app falls back to free offline", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const seconds = Math.floor(NOW / 1000);
    const token = await signToken(privateKey, kid, defaultClaims({ exp: seconds - 3600 }));

    await expect(verifyEntitlementToken(token, jwks, NOW)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("rejects anything that is not an ES256 JWT", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const none = await signToken(privateKey, kid, defaultClaims(), { alg: "none" });

    await expect(verifyEntitlementToken("not-a-token", jwks, NOW)).rejects.toMatchObject({
      reason: "malformed_token",
    });
    await expect(verifyEntitlementToken(none, jwks, NOW)).rejects.toMatchObject({
      reason: "unsupported_algorithm",
    });
  });

  it("treats a plus token without features as broken", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const token = await signToken(privateKey, kid, defaultClaims({ features: [] }));

    await expect(verifyEntitlementToken(token, jwks, NOW)).rejects.toMatchObject({
      reason: "empty_feature_list",
    });
  });
});

describe("claimsStillValid", () => {
  it("expires a token once its exp has passed", async () => {
    const { jwks, privateKey, kid } = await keyPair();
    const seconds = Math.floor(NOW / 1000);
    const token = await signToken(privateKey, kid, defaultClaims({ exp: seconds + 600 }));
    const claims = await verifyEntitlementToken(token, jwks, NOW);

    expect(claimsStillValid(claims, NOW)).toBe(true);
    expect(claimsStillValid(claims, NOW + 3_600_000)).toBe(false);
  });
});

describe("base64UrlToBytes", () => {
  it("decodes unpadded base64url", () => {
    expect(new TextDecoder().decode(base64UrlToBytes("S2llYml0eg"))).toBe("Kiebitz");
  });
});
