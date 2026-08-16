// @vitest-environment node
/**
 * Das Gate selbst: Was ist freigeschaltet, und wann fällt es auf Free zurück?
 *
 * Free-Funktionen dürfen niemals von einem Konto, einem Netz oder einem
 * Provider abhängen · das ist die wichtigste Zusage dieser Datei.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  featureUnlocked,
  requestSignInLink,
  resetPlusStore,
  signInWithCode,
  startCheckout,
  type PlusState,
} from "./store";
import { resetSecretFallback } from "./storage";
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

/**
 * Die Sprache reist von der Oberfläche bis in den Rumpf des Aufrufs.
 *
 * Zwischen `useI18n()` und der API liegen zwei Ebenen; geprüft wird deshalb
 * nicht die Weitergabe an die nächste Funktion, sondern das, was am Ende
 * tatsächlich über die Leitung geht.
 */
describe("the selected language reaches the API", () => {
  const fetchMock = vi.fn();

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  beforeEach(() => {
    resetPlusStore();
    resetSecretFallback();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPlusStore();
    resetSecretFallback();
  });

  function bodyOf(path: string): unknown {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(path));
    if (!call) throw new Error(`no request to ${path}`);
    return JSON.parse(call[1].body);
  }

  it("sends the language along with the magic link request", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accepted: true }, 202));

    await requestSignInLink("  Someone@Example.com  ", "fr");

    expect(bodyOf("/v1/auth/magic-link/request")).toEqual({
      email: "Someone@Example.com",
      client: "app",
      locale: "fr",
    });
  });

  it("sends the language along with the checkout", async () => {
    // Die Aktualisierung nach der Anmeldung scheitert hier absichtlich am
    // fehlenden signierten Token · für den Checkout zählt nur die Sitzung.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith("/v1/auth/magic-link/consume")
          ? jsonResponse({ access_token: "session-token" }, 201)
          : jsonResponse({}, 200)
      )
    );
    await signInWithCode("one-time-code");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse({ checkout_url: "https://checkout.stripe.com/x", trial_days: 7 }, 201)
    );

    await startCheckout("hi");

    expect(bodyOf("/v1/billing/stripe/checkout")).toEqual({ locale: "hi" });
  });
});
