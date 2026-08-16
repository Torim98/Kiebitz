// @vitest-environment node
/**
 * Der API-Client ist die einzige Stelle, an der Kiebitz mit dem Konto-Server
 * spricht. Geprüft wird deshalb beides: was er sendet und wie er antwortet,
 * wenn es schiefgeht.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_ORIGIN,
  PlusApiError,
  createCheckout,
  deleteAccount,
  fetchEntitlement,
  renewingProvidersOf,
  requestMagicLink,
  verifyGooglePlayPurchase,
} from "./api";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestMagicLink", () => {
  it("asks for an app link and never sends a session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accepted: true }, 202));

    await requestMagicLink("Someone@Example.com ", "de");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_ORIGIN}/v1/auth/magic-link/request`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      email: "Someone@Example.com",
      client: "app",
      locale: "de",
    });
    // Die App authentifiziert sich per Bearer · Cookies gehören der Website.
    expect(init.credentials).toBe("omit");
    expect(init.headers.Authorization).toBeUndefined();
  });

  // Ohne diese Angabe fiele die API auf Accept-Language und damit auf die
  // Sprache des Betriebssystems zurück · die Mail käme in der falschen.
  it("carries whichever language Kiebitz is set to", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accepted: true }, 202));

    await requestMagicLink("someone@example.com", "ar");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).locale).toBe("ar");
  });
});

describe("fetchEntitlement", () => {
  it("sends the session as a bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ plan: "plus", features: [] }));

    await fetchEntitlement("session-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_ORIGIN}/v1/entitlements/me`);
    expect(init.headers.Authorization).toBe("Bearer session-token");
  });

  it("turns an API error body into a typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "invalid_session", message: "gone" } }, 401)
    );

    const error = await fetchEntitlement("stale").catch((e) => e);

    expect(error).toBeInstanceOf(PlusApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_session");
  });

  it("reports a dead network as an offline error rather than a plan change", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await fetchEntitlement("token").catch((e) => e);

    expect(error).toBeInstanceOf(PlusApiError);
    expect(error.offline).toBe(true);
  });
});

describe("createCheckout", () => {
  it("returns the checkout URL and the trial length", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ checkout_url: "https://checkout.stripe.com/x", trial_days: 7 }, 201)
    );

    const session = await createCheckout("token", "en");

    expect(session).toEqual({ checkout_url: "https://checkout.stripe.com/x", trial_days: 7 });
  });

  // Dieselbe Sprache bestimmt die Stripe-Seite und die Vertragsbestätigung,
  // die Stripe später auslöst · sie muss vollständig im Rumpf stehen.
  it("sends nothing but the selected language", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ checkout_url: "https://checkout.stripe.com/x", trial_days: 0 }, 201)
    );

    await createCheckout("session-token", "zh");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_ORIGIN}/v1/billing/stripe/checkout`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ locale: "zh" });
    expect(init.headers.Authorization).toBe("Bearer session-token");
  });

  it("surfaces an existing subscription as its own code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "stripe_subscription_exists", message: "" } }, 409)
    );

    const error = await createCheckout("token", "en").catch((e) => e);

    expect(error.code).toBe("stripe_subscription_exists");
  });
});

describe("verifyGooglePlayPurchase", () => {
  // Der Client schickt das Token und sonst nichts · was daraus für die
  // Berechtigung folgt, prüft die API gegen Google.
  it("hands the purchase token to the API and nothing else", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await verifyGooglePlayPurchase("session-token", "play-purchase-token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_ORIGIN}/v1/purchases/google-play/verify`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ purchase_token: "play-purchase-token" });
    expect(init.headers.Authorization).toBe("Bearer session-token");
  });
});

describe("deleteAccount", () => {
  it("sends the explicit confirmation the API demands", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteAccount("token");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_ORIGIN}/v1/account`);
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ confirmation: "DELETE" });
  });

  it("names the providers that still need cancelling", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "active_subscription",
            message: "cancel first",
            details: { providers: ["stripe", "google_play"] },
          },
        },
        409
      )
    );

    const error = await deleteAccount("token").catch((e) => e);

    expect(renewingProvidersOf(error)).toEqual(["stripe", "google_play"]);
  });

  it("reports no providers for unrelated errors", () => {
    expect(renewingProvidersOf(new Error("boom"))).toEqual([]);
    expect(renewingProvidersOf(new PlusApiError(500, "internal_error", "x"))).toEqual([]);
  });
});
