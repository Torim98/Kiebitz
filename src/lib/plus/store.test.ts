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
  plusState,
  purchaseWithGooglePlay,
  initPlus,
  refreshEntitlement,
  requestSignInLink,
  resetPlusStore,
  restoreGooglePlayPurchases,
  signInWithCode,
  signOut,
  startCheckout,
  type PlusState,
} from "./store";
import * as storage from "./storage";
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

/**
 * Was passiert, wenn der Schlüsselspeicher nicht mitspielt.
 *
 * Der Anlass ist kein gedachter: Der Windows Credential Manager nimmt höchstens
 * 2560 Byte je Eintrag, und der abgelegte Entitlement-Satz — signierter Token,
 * öffentlicher Schlüsselsatz und Konto in einem JSON — liegt hart an dieser
 * Grenze. Kippt er darüber, lehnt Windows das Schreiben mit einem Fehler ab.
 *
 * Früher stand das Schreiben im selben `try` wie die Abfrage. Der Fehler riss
 * damit den eben geprüften Stand mit: In den Einstellungen stand danach
 * dauerhaft „Konto wird geladen …" neben der Meldung, der Status habe sich
 * nicht holen lassen — obwohl Konto, Berechtigung und Netz in Ordnung waren.
 */
describe("when the key store refuses the value", () => {
  const fetchMock = vi.fn();

  function base64Url(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const segment = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

  /** Ein echtes Schlüsselpaar · geprüft wird die Signatur, nicht eine Attrappe. */
  async function signedEntitlement() {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = "kiebitz-test-1";
    const seconds = Math.floor(Date.now() / 1000);
    const head = segment({ alg: "ES256", typ: "JWT", kid });
    const payload = segment({
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
      entitlement_valid_until: seconds + 30 * 86_400,
      iat: seconds - 60,
      exp: seconds + 7 * 86_400,
    });
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(`${head}.${payload}`)
    );
    return {
      token: `${head}.${payload}.${base64Url(new Uint8Array(signature))}`,
      jwks: {
        keys: [
          { kty: "EC", crv: "P-256", x: publicJwk.x!, y: publicJwk.y!, alg: "ES256", use: "sig", kid },
        ],
      },
    };
  }

  beforeEach(() => {
    resetPlusStore();
    resetSecretFallback();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetPlusStore();
    resetSecretFallback();
  });

  async function signInWithWorkingApi() {
    const { token, jwks } = await signedEntitlement();
    fetchMock.mockImplementation((url: string) => {
      const path = String(url);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          })
        );
      if (path.endsWith("/v1/auth/magic-link/consume")) return json({ access_token: "session" }, 201);
      if (path.endsWith("/v1/account/me"))
        return json({ id: "acc_1", email: "someone@example.com" });
      if (path.endsWith("/v1/entitlements/me"))
        return json({ entitlement_token: token, refresh_after: null });
      if (path.endsWith("/.well-known/jwks.json")) return json(jwks);
      return json({});
    });
    await signInWithCode("one-time-code");
  }

  it("keeps the verified state when it cannot be stored", async () => {
    const failed = vi
      .spyOn(storage, "writeSecret")
      .mockImplementation(async (key) => {
        // Die Sitzung passt in den Speicher, der größere Entitlement-Satz nicht.
        if (key === "entitlement") throw new Error("The stub received bad data. (os error 1783)");
      });

    await signInWithWorkingApi();

    const after = plusState();
    // Plus gilt, das Konto steht da · genau das ging vorher verloren.
    expect(featureUnlocked("no_ads", after)).toBe(true);
    expect(after.account?.email).toBe("someone@example.com");
    expect(after.fetchedAt).not.toBeNull();
    expect(failed).toHaveBeenCalledWith("entitlement", expect.any(String));
  });

  it("names the real trouble instead of blaming the network", async () => {
    vi.spyOn(storage, "writeSecret").mockImplementation(async (key) => {
      if (key === "entitlement") throw new Error("The stub received bad data. (os error 1783)");
    });

    await signInWithWorkingApi();

    const error = plusState().error;
    expect(error?.code).toBe("cache_unavailable");
    // Das Netz war in Ordnung · wer hier „offline" meldet, schickt den
    // Benutzer seinen Router neu starten.
    expect(error?.offline).toBe(false);
  });

  it("still reports a dead network as offline", async () => {
    // Erst anmelden, damit eine Sitzung steht · dann fällt das Netz aus.
    await signInWithWorkingApi();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await refreshEntitlement({ force: true });

    const error = plusState().error;
    expect(error?.code).toBe("network_unavailable");
    expect(error?.offline).toBe(true);
    // Der zwischengespeicherte Stand bleibt · ein Netzausfall nimmt kein Plus weg.
    expect(featureUnlocked("no_ads", plusState())).toBe(true);
  });

  it("does not call a bad signature a network problem", async () => {
    await signInWithWorkingApi();
    // Dieselbe API, aber ein fremder Schlüsselsatz: Die Prüfung schlägt fehl.
    const foreign = await signedEntitlement();
    const before = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith("/.well-known/jwks.json")
        ? Promise.resolve(
            new Response(JSON.stringify(foreign.jwks), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          )
        : before(url)
    );

    await refreshEntitlement({ force: true });

    const error = plusState().error;
    expect(error?.code).toBe("verify_failed");
    expect(error?.offline).toBe(false);
  });
});

/**
 * Die Aufteilung des Zwischenspeichers auf zwei Einträge.
 *
 * Der Windows Credential Manager nimmt höchstens 2560 Byte je Eintrag an — als
 * UTF-16 also 1280 Zeichen — und lehnt alles darüber mit Fehler 1783 ab. Token,
 * Schlüsselsatz und Konto in einem JSON maßen zusammen rund 2660 Byte und
 * standen damit knapp hundert Byte hinter dieser Wand: Auf dem Desktop kam die
 * Freischaltung nie in der Ablage an, während Android sie ohne Weiteres nahm.
 *
 * Der Größentest unten ist deshalb kein Zierat: Er ist die Wache davor, dass
 * ein weiteres Feld im Token dieselbe Grenze noch einmal findet.
 */
describe("the entitlement cache", () => {
  /** `CRED_MAX_CREDENTIAL_BLOB_SIZE` · 2560 Byte, in UTF-16 also 1280 Zeichen. */
  const WINDOWS_LIMIT_CHARS = 1280;

  const fetchMock = vi.fn();

  function base64Url(bytes: Uint8Array): string {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const segment = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

  /**
   * Ein Token, wie ihn die API ausstellt · mit allen Feldern aus
   * `getEntitlement` und dem vollen Plus-Satz, denn an dessen Länge hängt die
   * Größe.
   */
  async function realisticEntitlement(email: string) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = "kiebitz-plus-2026-08-1";
    const seconds = Math.floor(Date.now() / 1000);
    const account = {
      id: "acc_01JQZK7X3M4N5P6Q7R8S9T0V1W",
      email,
      plan: "plus" as const,
      status: "active" as const,
      providers: ["stripe" as const],
      trial: false,
      trial_eligible: false,
    };
    const head = segment({ alg: "ES256", typ: "JWT", kid });
    const payload = segment({
      iss: "https://api.kiebitz.dev",
      sub: account.id,
      aud: "kiebitz-app",
      plan: "plus",
      features: [...FREE_FEATURES, ...PLUS_ONLY_FEATURES],
      provider: "stripe",
      providers: ["stripe"],
      status: "active",
      trial: false,
      trial_until: null,
      entitlement_valid_until: seconds + 30 * 86_400,
      iat: seconds - 60,
      exp: seconds + 7 * 86_400,
    });
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      new TextEncoder().encode(`${head}.${payload}`)
    );
    return {
      account,
      token: `${head}.${payload}.${base64Url(new Uint8Array(signature))}`,
      jwks: {
        keys: [
          { kty: "EC", crv: "P-256", x: publicJwk.x!, y: publicJwk.y!, alg: "ES256", use: "sig", kid },
        ],
      },
    };
  }

  async function signIn(email = "tommaurerhof@googlemail.com") {
    const issued = await realisticEntitlement(email);
    fetchMock.mockImplementation((url: string) => {
      const path = String(url);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          })
        );
      if (path.endsWith("/v1/auth/magic-link/consume")) return json({ access_token: "session" }, 201);
      if (path.endsWith("/v1/account/me")) return json(issued.account);
      if (path.endsWith("/v1/entitlements/me"))
        return json({ entitlement_token: issued.token, refresh_after: null });
      if (path.endsWith("/.well-known/jwks.json")) return json(issued.jwks);
      return json({});
    });
    await signInWithCode("one-time-code");
    return issued;
  }

  beforeEach(() => {
    resetPlusStore();
    resetSecretFallback();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetPlusStore();
    resetSecretFallback();
  });

  it("keeps every entry inside what Windows accepts", async () => {
    await signIn();

    const token = (await storage.readSecret("entitlement"))!;
    const keys = (await storage.readSecret("entitlement_keys"))!;

    // Nicht knapp darunter, sondern mit Luft: Wer dem Token ein Feld
    // hinzufügt, soll es hier merken und nicht erst auf einem Windows-Rechner.
    // In einem Eintrag maßen beide zusammen rund 1330 Zeichen — fünfzig über
    // der Wand. Getrennt bleibt der größere unter tausend.
    expect(token.length).toBeLessThanOrEqual(WINDOWS_LIMIT_CHARS - 280);
    expect(keys.length).toBeLessThanOrEqual(WINDOWS_LIMIT_CHARS - 280);
  });

  it("puts the token in one entry and the keys in the other", async () => {
    const issued = await signIn();

    const token = JSON.parse((await storage.readSecret("entitlement"))!);
    const keys = JSON.parse((await storage.readSecret("entitlement_keys"))!);

    expect(token.token).toBe(issued.token);
    // Der Schlüsselsatz gehört nicht mehr in den ersten Eintrag · genau das
    // war die Überschreitung.
    expect(token.jwks).toBeUndefined();
    expect(keys.jwks.keys[0].kid).toBe("kiebitz-plus-2026-08-1");
    expect(keys.account.email).toBe("tommaurerhof@googlemail.com");
  });

  it("carries an older single-entry cache over instead of dropping it", async () => {
    const issued = await realisticEntitlement("someone@example.com");
    // Die Form vor der Aufteilung: alles in einem Eintrag.
    await storage.writeSecret(
      "entitlement",
      JSON.stringify({
        token: issued.token,
        fetched_at: Date.now(),
        refresh_after: new Date(Date.now() + 86_400_000).toISOString(),
        jwks: issued.jwks,
        account: issued.account,
      })
    );
    await storage.writeSecret("session", "session");

    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await initPlus();

    // Ohne Netz und nach dem Update: Plus gilt weiter, die Adresse steht da.
    expect(featureUnlocked("no_ads", plusState())).toBe(true);
    expect(plusState().account?.email).toBe("someone@example.com");

    // Und der Zwischenspeicher steht jetzt in der neuen Form.
    await vi.waitFor(async () => {
      expect(await storage.readSecret("entitlement_keys")).not.toBeNull();
    });
    const moved = JSON.parse((await storage.readSecret("entitlement"))!);
    expect(moved.jwks).toBeUndefined();
    expect(moved.token).toBe(issued.token);
  });

  it("forgets both entries when signing out", async () => {
    await signIn();
    expect(await storage.readSecret("entitlement_keys")).not.toBeNull();

    await signOut();

    expect(await storage.readSecret("entitlement")).toBeNull();
    expect(await storage.readSecret("entitlement_keys")).toBeNull();
  });
});
