import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetHeartbeatDay,
  heartbeatPayload,
  reportDailyHeartbeat,
  utcDay,
} from "./analytics";
import { getSettings, setSettings, type Settings } from "./settings";

vi.mock("./settings", () => ({ getSettings: vi.fn(), setSettings: vi.fn() }));
// Das Logbuch geht sonst über invoke ins Backend, das im Test nicht läuft.
vi.mock("./diag", () => ({ logEvent: vi.fn() }));

const INSTALLATION_ID = "9b6c0e2a-5ea5-4a64-8ec4-e7b81a90d621";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    analytics_enabled: true,
    analytics_installation_id: INSTALLATION_ID,
    ...overrides,
  } as Settings;
}

/** Der Rumpf des einzigen abgesetzten Aufrufs. */
function sentBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls[0];
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

function sentHeaders(): Record<string, string> {
  const call = vi.mocked(fetch).mock.calls[0];
  return (call[1] as RequestInit).headers as Record<string, string>;
}

const desktop = { platform: "windows", distribution: "desktop", version: "1.2.0", plus: false };

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getSettings).mockReset().mockResolvedValue(settings());
  vi.mocked(setSettings).mockReset().mockImplementation((s) => Promise.resolve(s));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-17T09:00:00Z"));
});

describe("Nutzungsstatistik · Nachricht", () => {
  it("nennt genau die Felder, die die API erwartet", () => {
    expect(
      heartbeatPayload({
        installationId: INSTALLATION_ID,
        platform: "windows",
        distribution: "desktop",
        version: "1.2.0",
        plus: false,
        now: new Date("2026-08-17T09:00:00Z"),
      })
    ).toEqual({
      schema: 1,
      installation_id: INSTALLATION_ID,
      day: "2026-08-17",
      platform: "windows",
      distribution: "desktop",
      version: "1.2.0",
      tier: "free",
    });
  });

  // Das Backend schreibt "play-store" mit Bindestrich, die API will den
  // Unterstrich · und für Android ist "desktop" ein Ablehnungsgrund.
  it("bildet den Bezugsweg auf die Werte der API ab", () => {
    const android = {
      installationId: INSTALLATION_ID,
      platform: "android",
      version: "1.2.0",
      plus: false,
      now: new Date("2026-08-17T09:00:00Z"),
    };
    expect(heartbeatPayload({ ...android, distribution: "play-store" })?.distribution).toBe(
      "play_store"
    );
    expect(heartbeatPayload({ ...android, distribution: "sideload" })?.distribution).toBe(
      "sideload"
    );
    // Ein Desktop bleibt "desktop", auch wenn das Feld Unsinn trägt: die API
    // koppelt Betriebssystem und Bezugsweg und wiese alles andere ab.
    expect(
      heartbeatPayload({ ...android, platform: "linux", distribution: "play-store" })?.distribution
    ).toBe("desktop");
  });

  it("meldet nichts ohne bekanntes Betriebssystem, Kennung oder Version", () => {
    const base = {
      installationId: INSTALLATION_ID,
      platform: "windows",
      distribution: "desktop",
      version: "1.2.0",
      plus: false,
      now: new Date("2026-08-17T09:00:00Z"),
    };
    // Die Browser-Vorschau hat kein Backend und damit kein Betriebssystem.
    expect(heartbeatPayload({ ...base, platform: "" })).toBeNull();
    // iOS kennt die API noch nicht · lieber keine Zahl als eine falsche.
    expect(heartbeatPayload({ ...base, platform: "ios" })).toBeNull();
    expect(heartbeatPayload({ ...base, installationId: "" })).toBeNull();
    expect(heartbeatPayload({ ...base, version: " " })).toBeNull();
  });

  // Die API erlaubt nur einen Tag Abweichung von ihrem UTC-Datum. Ein lokales
  // Datum wäre am Abend der häufigste Grund für ein abgewiesenes Lebenszeichen.
  it("rechnet den Tag in UTC", () => {
    expect(utcDay(new Date("2026-08-17T23:30:00Z"))).toBe("2026-08-17");
    expect(utcDay(new Date("2026-08-18T00:30:00Z"))).toBe("2026-08-18");
  });
});

describe("Nutzungsstatistik · Versand", () => {
  it("sendet ohne Einwilligung nichts", async () => {
    vi.mocked(getSettings).mockResolvedValue(settings({ analytics_enabled: false }));

    expect(await reportDailyHeartbeat(desktop)).toBe("no_consent");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("schickt das Lebenszeichen mit dem Einwilligungskopf", async () => {
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(
      "https://api.kiebitz.dev/v1/analytics/heartbeat"
    );
    expect(sentHeaders()["X-Kiebitz-Analytics-Consent"]).toBe("1");
    expect(sentBody()).toMatchObject({ installation_id: INSTALLATION_ID, day: "2026-08-17" });
  });

  it("übernimmt die Stufe aus dem Plus-Zustand", async () => {
    expect(await reportDailyHeartbeat({ ...desktop, plus: true })).toBe("sent");
    expect(sentBody().tier).toBe("plus");
  });

  it("sendet höchstens einmal pro UTC-Tag", async () => {
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");
    expect(await reportDailyHeartbeat(desktop)).toBe("already_today");
    expect(fetch).toHaveBeenCalledTimes(1);

    // Der nächste UTC-Tag zählt wieder.
    vi.setSystemTime(new Date("2026-08-18T09:00:00Z"));
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // Ein misslungener Versuch darf den Tag nicht verbrauchen · sonst kostet ein
  // kurzer Netzausfall beim Start die Zahl des ganzen Tages.
  it("verbraucht den Tag nicht, wenn der Versand scheitert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    expect(await reportDailyHeartbeat(desktop)).toBe("failed");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");
  });

  it("schweigt, wenn das Netz gar nicht antwortet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await expect(reportDailyHeartbeat(desktop)).resolves.toBe("failed");
  });

  it("legt die Kennung erst mit der Einwilligung an und behält sie dann", async () => {
    vi.mocked(getSettings).mockResolvedValue(settings({ analytics_installation_id: "" }));

    expect(await reportDailyHeartbeat(desktop)).toBe("sent");

    expect(setSettings).toHaveBeenCalledTimes(1);
    const stored = vi.mocked(setSettings).mock.calls[0][0].analytics_installation_id;
    expect(stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(sentBody().installation_id).toBe(stored);
  });

  it("meldet nichts, wenn das Backend fehlt", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("no backend"));

    expect(await reportDailyHeartbeat(desktop)).toBe("not_applicable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("vergisst den Tagesriegel auf Verlangen", async () => {
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");
    forgetHeartbeatDay();
    expect(await reportDailyHeartbeat(desktop)).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
