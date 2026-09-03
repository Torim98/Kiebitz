import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  appearanceFromSettings,
  inNightWindow,
  resolveDiagramMode,
  resolvePieceSet,
  resolveTheme,
  settingsFromAppearance,
  type Appearance,
} from "./theme";
import type { Settings } from "./settings";

const day = (hour: number, minute = 0) => new Date(2026, 0, 15, hour, minute);

const appearance = (overrides: Partial<Appearance> = {}): Appearance => ({
  ...DEFAULT_APPEARANCE,
  ...overrides,
});

describe("night window", () => {
  it("spans midnight", () => {
    expect(inNightWindow(day(20), "19:00", "07:00")).toBe(true);
    expect(inNightWindow(day(3), "19:00", "07:00")).toBe(true);
    expect(inNightWindow(day(12), "19:00", "07:00")).toBe(false);
  });

  it("includes the start and releases at the end", () => {
    expect(inNightWindow(day(19), "19:00", "07:00")).toBe(true);
    expect(inNightWindow(day(7), "19:00", "07:00")).toBe(false);
  });

  it("stays within the day when it does not wrap", () => {
    expect(inNightWindow(day(14), "12:00", "16:00")).toBe(true);
    expect(inNightWindow(day(17), "12:00", "16:00")).toBe(false);
  });

  it("treats an empty or broken window as no night", () => {
    expect(inNightWindow(day(20), "19:00", "19:00")).toBe(false);
    expect(inNightWindow(day(20), "Abend", "07:00")).toBe(false);
  });
});

describe("resolve", () => {
  const context = { now: day(20), systemDark: null, plus: true };

  it("takes the chosen theme when switching is off", () => {
    expect(resolveTheme(appearance({ theme: "paper", night: "dusk" }), context)).toBe("paper");
  });

  it("follows the system", () => {
    const prefs = appearance({ theme: "light", night: "dusk", auto: "system" });
    expect(resolveTheme(prefs, { ...context, systemDark: true })).toBe("dusk");
    expect(resolveTheme(prefs, { ...context, systemDark: false })).toBe("light");
    // Ohne Vorgabe der Plattform bleibt es beim Tagthema.
    expect(resolveTheme(prefs, { ...context, systemDark: null })).toBe("light");
  });

  it("follows the clock", () => {
    const prefs = appearance({ theme: "light", night: "dusk", auto: "time" });
    expect(resolveTheme(prefs, { ...context, now: day(21) })).toBe("dusk");
    expect(resolveTheme(prefs, { ...context, now: day(9) })).toBe("light");
  });

  it("falls back to a free theme of the same brightness without Plus", () => {
    expect(resolveTheme(appearance({ theme: "paper" }), { ...context, plus: false })).toBe("light");
    expect(resolveTheme(appearance({ theme: "dusk" }), { ...context, plus: false })).toBe("dark");
    expect(resolveTheme(appearance({ theme: "light" }), { ...context, plus: false })).toBe("light");
  });

  it("keeps the choice while the entitlement is still being checked", () => {
    expect(resolveTheme(appearance({ theme: "paper" }), { ...context, plus: null })).toBe("paper");
  });

  it("applies the fallback to the night theme as well", () => {
    const prefs = appearance({ theme: "light", night: "contrast", auto: "time" });
    expect(resolveTheme(prefs, { ...context, now: day(21), plus: false })).toBe("dark");
  });
});

describe("piece sets", () => {
  it("keeps a free set whatever the entitlement says", () => {
    for (const plus of [true, false, null]) {
      expect(resolvePieceSet(appearance({ pieceSet: "classic" }), plus)).toBe("classic");
    }
  });

  it("falls back to the classic set without Plus", () => {
    expect(resolvePieceSet(appearance({ pieceSet: "kiebitz" }), false)).toBe("classic");
    expect(resolvePieceSet(appearance({ pieceSet: "monolith" }), false)).toBe("classic");
  });

  it("keeps the choice while the entitlement is still being checked", () => {
    expect(resolvePieceSet(appearance({ pieceSet: "kiebitz" }), null)).toBe("kiebitz");
    expect(resolvePieceSet(appearance({ pieceSet: "kiebitz" }), true)).toBe("kiebitz");
  });
});

describe("diagram mode", () => {
  it("stays off until it is switched on", () => {
    expect(resolveDiagramMode(appearance(), true)).toBe(false);
    expect(resolveDiagramMode(appearance({ diagram: true }), true)).toBe(true);
  });

  it("falls back to off without Plus", () => {
    expect(resolveDiagramMode(appearance({ diagram: true }), false)).toBe(false);
  });

  it("keeps the choice while the unlock is still being checked", () => {
    // Sonst spränge die App beim Start einmal durch zwei Layouts.
    expect(resolveDiagramMode(appearance({ diagram: true }), null)).toBe(true);
  });
});

describe("settings", () => {
  const stored = (overrides: Partial<Settings>) =>
    appearanceFromSettings({ ...(overrides as Settings) });

  it("discards values it does not know", () => {
    const result = stored({
      theme: "neongrün" as never,
      board_set: "marmor" as never,
      piece_set: "origami" as never,
      theme_auto: "vielleicht" as never,
      theme_night: "dusk",
      theme_night_from: "25:00",
      theme_night_to: "07:00",
    });
    expect(result).toEqual({
      theme: "dark",
      boardSet: "auto",
      pieceSet: "classic",
      auto: "off",
      night: "dusk",
      nightFrom: "19:00",
      nightTo: "07:00",
      diagram: false,
    });
  });

  it("pads a shortened time", () => {
    expect(stored({ theme_night_from: "9:30" }).nightFrom).toBe("09:30");
  });

  it("round-trips through the stored fields", () => {
    const prefs = appearance({
      theme: "graphite",
      boardSet: "sepia",
      pieceSet: "kiebitz",
      auto: "time",
      night: "contrast",
      nightFrom: "20:15",
      nightTo: "06:45",
      diagram: true,
    });
    expect(appearanceFromSettings(settingsFromAppearance(prefs) as Settings)).toEqual(prefs);
  });
});
