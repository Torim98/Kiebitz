// @vitest-environment node
/**
 * Wer ist angemeldet? · das Konto beim Kaltstart.
 *
 * Der signierte Token sagt, was freigeschaltet ist, aber nicht, wem. Die
 * Adresse steht allein in `/v1/account/me`, und die wurde nur geholt, wenn die
 * Freischaltung ohnehin fällig war. Wer die App startete und in die
 * Einstellungen ging, las deshalb „Konto wird geladen …", bis er von Hand
 * aktualisierte · obwohl alles Nötige längst da war.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Der native Teil braucht Google Play und ein Gerät · für den Kaltstart zählt
// er nicht.
vi.mock("./billing", () => ({
  PLUS_PRODUCT_ID: "kiebitz_plus",
  billingAvailable: vi.fn(async () => false),
  purchasePlus: vi.fn(),
  playPurchaseTokens: vi.fn(),
  acknowledgePurchase: vi.fn(),
}));

// Die Signaturprüfung hat ihre eigenen Tests (token.test.ts); hier geht es um
// den Weg des Kontos durch den Zwischenspeicher.
vi.mock("./token", () => ({
  verifyEntitlementToken: vi.fn(async () => CLAIMS),
  claimsStillValid: () => true,
}));

import { initPlus, plusState, resetPlusStore } from "./store";
import { resetSecretFallback, writeSecret } from "./storage";
import {
  FREE_FEATURES,
  PLUS_ONLY_FEATURES,
  type CachedEntitlement,
  type EntitlementClaims,
  type PlusAccount,
} from "./types";

const NOW_SECONDS = Math.floor(Date.now() / 1000);

const CLAIMS: EntitlementClaims = {
  iss: "https://api.kiebitz.dev",
  aud: "kiebitz-app",
  sub: "acc_1",
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
};

const ACCOUNT: PlusAccount = {
  id: "acc_1",
  email: "someone@example.com",
  plan: "plus",
  status: "active",
  providers: ["stripe"],
  trial: false,
  trial_eligible: false,
};

const JWKS = { keys: [{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "k1" }] };

/** Ein Zwischenspeicher, dessen Freischaltung noch lange nicht fällig ist. */
function cached(overrides: Partial<CachedEntitlement> = {}): CachedEntitlement {
  return {
    token: "signed.entitlement.token",
    fetched_at: Date.now() - 60_000,
    refresh_after: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    jwks: JWKS,
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(async () => {
  resetPlusStore();
  resetSecretFallback();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await writeSecret("session", "session-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPlusStore();
  resetSecretFallback();
});

describe("the account on a cold start", () => {
  it("comes back from the cache without asking the network", async () => {
    await writeSecret("entitlement", JSON.stringify(cached({ account: ACCOUNT })));
    fetchMock.mockRejectedValue(new Error("no network in this test"));

    await initPlus();

    expect(plusState().account?.email).toBe("someone@example.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is fetched when the cache does not know it yet", async () => {
    // Genau der Zustand nach einer Aktualisierung der App: gültige
    // Freischaltung, aber ein Zwischenspeicher aus der Zeit davor.
    await writeSecret("entitlement", JSON.stringify(cached()));
    fetchMock.mockImplementation((url: string) => {
      const path = String(url);
      const body = path.endsWith("/v1/account/me")
        ? ACCOUNT
        : path.endsWith("/v1/entitlements/me")
          ? { entitlement_token: "signed.entitlement.token", refresh_after: null }
          : JWKS;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    await initPlus();
    // `initPlus` stößt die Aktualisierung an, ohne auf sie zu warten.
    await vi.waitFor(() => expect(plusState().account?.email).toBe("someone@example.com"));
  });
});
