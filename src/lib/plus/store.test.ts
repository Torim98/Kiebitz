// @vitest-environment node
/**
 * Das Gate selbst: Was ist freigeschaltet, und wann fällt es auf Free zurück?
 *
 * Free-Funktionen dürfen niemals von einem Konto, einem Netz oder einem
 * Provider abhängen · das ist die wichtigste Zusage dieser Datei.
 */
import { describe, expect, it } from "vitest";
import { featureUnlocked, type PlusState } from "./store";
import { FREE_FEATURES, PLUS_ONLY_FEATURES, type EntitlementClaims } from "./types";

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function state(claims: EntitlementClaims | null): PlusState {
  return {
    loading: false,
    signedIn: claims !== null,
    account: null,
    claims,
    refreshing: false,
    error: null,
    fetchedAt: null,
    resendAllowedAt: 0,
  };
}

function claims(overrides: Partial<EntitlementClaims> = {}): EntitlementClaims {
  return {
    iss: "https://api.kiebitz.dev",
    sub: "acc_1",
    aud: "kiebitz-app",
    plan: "plus",
    features: [...FREE_FEATURES, ...PLUS_ONLY_FEATURES],
    provider: "stripe",
    providers: ["stripe"],
    status: "active",
    trial: false,
    trial_until: null,
    entitlement_valid_until: NOW_SECONDS + 30 * 86_400,
    iat: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 7 * 86_400,
    ...overrides,
  };
}

describe("featureUnlocked", () => {
  it("keeps the free features available without an account", () => {
    const free = state(null);
    for (const feature of FREE_FEATURES) {
      expect(featureUnlocked(feature, free)).toBe(true);
    }
  });

  it("locks every plus feature without a verified token", () => {
    const free = state(null);
    for (const feature of PLUS_ONLY_FEATURES) {
      expect(featureUnlocked(feature, free)).toBe(false);
    }
  });

  it("unlocks exactly the features the token names", () => {
    const partial = state(claims({ features: [...FREE_FEATURES, "widgets"] }));

    expect(featureUnlocked("widgets", partial)).toBe(true);
    expect(featureUnlocked("no_ads", partial)).toBe(false);
    expect(featureUnlocked("full_insights", partial)).toBe(false);
  });

  it("falls back to free once the token has expired", () => {
    const expired = state(claims({ exp: NOW_SECONDS - 3600 }));

    expect(featureUnlocked("widgets", expired)).toBe(false);
    expect(featureUnlocked("basic_analysis", expired)).toBe(true);
  });

  it("ignores a token that claims plus but was issued for the free plan", () => {
    const inconsistent = state(claims({ plan: "free" }));

    expect(featureUnlocked("no_ads", inconsistent)).toBe(false);
  });

  it("keeps plus during a grace period, because the entitlement is still valid", () => {
    const grace = state(claims({ status: "grace" }));

    expect(featureUnlocked("no_ads", grace)).toBe(true);
  });

  it("unlocks everything a full entitlement lists", () => {
    const full = state(claims());
    for (const feature of PLUS_ONLY_FEATURES) {
      expect(featureUnlocked(feature, full)).toBe(true);
    }
  });
});
