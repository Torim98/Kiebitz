// @vitest-environment node
/**
 * Das Gate selbst: Was ist freigeschaltet, und wann fällt es auf Free zurück?
 *
 * Free-Funktionen dürfen niemals von einem Konto, einem Netz oder einem
 * Provider abhängen · das ist die wichtigste Zusage dieser Datei.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Der native Teil braucht Google Play und ein Gerät · hier zählt, was die
// Reihenfolge daraus macht.
vi.mock("./billing", () => ({
  PLUS_PRODUCT_ID: "kiebitz_plus",
  billingAvailable: vi.fn(async () => true),
  purchasePlus: vi.fn(),
  playPurchaseTokens: vi.fn(),
  acknowledgePurchase: vi.fn(),
}));

import { acknowledgePurchase, playPurchaseTokens, purchasePlus } from "./billing";
import {
  featureUnlocked,
  purchaseWithGooglePlay,
  requestSignInLink,
  resetPlusStore,
  restoreGooglePlayPurchases,
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

/**
 * Der Play-Kauf.
 *
 * Die Reihenfolge ist hier keine Stilfrage: Ein gegenüber Google bestätigter
 * Kauf lässt sich nicht mehr automatisch erstatten. Wer bestätigt, bevor die
 * API den Kauf einem Konto zuordnen konnte, hat für Geld nichts geliefert und
 * merkt es erst im Support.
 */
describe("buying through Google Play", () => {
  const fetchMock = vi.fn();
  /** Was in welcher Reihenfolge passiert ist. */
  let order: string[];

  beforeEach(async () => {
    resetPlusStore();
    resetSecretFallback();
    order = [];
    fetchMock.mockReset();
    vi.mocked(purchasePlus).mockReset();
    vi.mocked(playPurchaseTokens).mockReset();
    vi.mocked(acknowledgePurchase).mockReset();
    vi.mocked(acknowledgePurchase).mockImplementation(async (token: string) => {
      order.push(`acknowledge:${token}`);
      return true;
    });
    vi.stubGlobal("fetch", fetchMock);

    // Eine Sitzung herstellen · die Aktualisierung danach scheitert bewusst am
    // fehlenden signierten Token und ändert daran nichts.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).endsWith("/v1/auth/magic-link/consume")
          ? new Response(JSON.stringify({ access_token: "session-token" }), { status: 201 })
          : new Response("{}", { status: 200 })
      )
    );
    await signInWithCode("one-time-code");

    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (String(url).endsWith("/v1/purchases/google-play/verify")) {
        const body = JSON.parse(String(init.body)) as { purchase_token: string };
        order.push(`verify:${body.purchase_token}`);
        // Ein fremdes Token weist die API zurück · das darf den Rest nicht
        // aufhalten.
        return Promise.resolve(
          body.purchase_token === "foreign"
            ? new Response(JSON.stringify({ error: { code: "invalid_purchase_token" } }), { status: 400 })
            : new Response(null, { status: 204 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPlusStore();
    resetSecretFallback();
  });

  it("lets the API confirm the purchase before Google is told to keep the money", async () => {
    vi.mocked(purchasePlus).mockResolvedValue({ state: "purchased", purchase_token: "tok" });

    expect(await purchaseWithGooglePlay()).toBe("purchased");

    expect(order).toEqual(["verify:tok", "acknowledge:tok"]);
  });

  it("does not acknowledge a payment Google has not settled yet", async () => {
    vi.mocked(purchasePlus).mockResolvedValue({ state: "pending", purchase_token: "tok" });

    expect(await purchaseWithGooglePlay()).toBe("pending");

    // Zugeordnet ja, bestätigt nein: Bleibt die Zahlung aus, soll Google den
    // Kauf von selbst zurücknehmen.
    expect(order).toEqual(["verify:tok"]);
  });

  it("treats a cancelled dialog as nothing having happened", async () => {
    vi.mocked(purchasePlus).mockResolvedValue({ state: "cancelled", purchase_token: null });

    expect(await purchaseWithGooglePlay()).toBe("cancelled");

    expect(order).toEqual([]);
  });

  it("restores what belongs to this account and steps over what does not", async () => {
    vi.mocked(playPurchaseTokens).mockResolvedValue(["foreign", "mine"]);

    expect(await restoreGooglePlayPurchases()).toBe(1);

    // Das zurückgewiesene Token wird nicht bestätigt, das gültige schon · und
    // ein fremdes Abo im selben Play-Konto hält den Vorgang nicht auf.
    expect(order).toEqual(["verify:foreign", "verify:mine", "acknowledge:mine"]);
  });

  it("reports no purchase rather than pretending to have found one", async () => {
    vi.mocked(playPurchaseTokens).mockResolvedValue([]);

    expect(await restoreGooglePlayPurchases()).toBe(0);
    expect(order).toEqual([]);
  });
});
