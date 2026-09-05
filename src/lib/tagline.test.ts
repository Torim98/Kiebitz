import { afterEach, expect, it, vi } from "vitest";
import { COMPACT_LIMIT, resetTagline, TAGLINES, taglineKey, taglineWidth } from "./tagline";
import { loadLocale, LOCALES } from "./locales/registry";

afterEach(() => {
  vi.restoreAllMocks();
  resetTagline();
});

it("draws one claim and keeps it for the whole session", () => {
  resetTagline();
  const zufall = vi.spyOn(Math, "random");
  zufall.mockReturnValueOnce(0.99).mockReturnValue(0);

  const erste = taglineKey();
  expect(erste).toBe(TAGLINES[TAGLINES.length - 1]);
  // Alle vier Stellen der Oberfläche fragen dieselbe Sitzung · nicht jede
  // ihren eigenen Satz.
  expect(taglineKey()).toBe(erste);
  expect(zufall).toHaveBeenCalledTimes(1);
});

it("covers the whole list over enough starts", () => {
  const gesehen = new Set<string>();
  for (let i = 0; i < TAGLINES.length; i++) {
    resetTagline();
    vi.spyOn(Math, "random").mockReturnValue(i / TAGLINES.length);
    gesehen.add(taglineKey());
  }
  expect(gesehen.size).toBe(TAGLINES.length);
});

/**
 * Der Claim in der App-Bar eines Telefons · dort ist der Platz gemessen und
 * knapp. Ein Satz, der dort nicht ganz hinpasst, soll gar nicht erst gezogen
 * werden; abgeschnitten stand er zuletzt als „Bauernzug und Vog…" da.
 */
it("draws only claims that fit the phone app bar", () => {
  const passt = (text: string) => taglineWidth(text) <= COMPACT_LIMIT;
  expect(passt("Zug um Zugvogel")).toBe(true);
  expect(passt("Das Brett von oben")).toBe(true);
  expect(passt("Bauernzug und Vogelflug")).toBe(false);
  expect(passt("Sieht, was du übersiehst")).toBe(false);

  // Gegriffen wird dann nur noch aus dem, was die Sperre durchlässt · bei
  // jedem Los, auch dem, das ohne Sperre auf einen langen Satz zeigt.
  const sperre = (key: string) => key !== "app.tagline6" && key !== "app.tagline5";
  const kurz: string[] = [];
  for (let i = 0; i < 20; i++) {
    resetTagline();
    vi.spyOn(Math, "random").mockReturnValue(i / 20);
    kurz.push(taglineKey(sperre));
    vi.restoreAllMocks();
  }
  expect(kurz).not.toContain("app.tagline6");
  expect(kurz).not.toContain("app.tagline5");
  // Und aus dem kleineren Topf kommt trotzdem mehr als ein Satz.
  expect(new Set(kurz).size).toBe(TAGLINES.length - 2);
});

/**
 * Gemerkt wird das Los, nicht der Satz.
 *
 * Der erste Bildaufbau läuft noch auf dem englischen Wörterbuch · stünde der
 * Satz danach fest, entschiede der englische Topf über eine deutsche Sitzung.
 * Derselbe Topf gibt aber immer denselben Satz, sonst stünden auf einem Schirm
 * zwei verschiedene.
 */
it("keeps the same claim for the same pool, whenever it is asked", () => {
  resetTagline();
  vi.spyOn(Math, "random").mockReturnValue(0.6);

  const erste = taglineKey();
  expect(taglineKey()).toBe(erste);
  // Ein kleinerer Topf darf einen anderen Satz ergeben · derselbe kleinere
  // Topf danach aber wieder denselben.
  const eng = taglineKey((key) => key === "app.tagline" || key === "app.tagline4");
  expect(["app.tagline", "app.tagline4"]).toContain(eng);
  expect(taglineKey((key) => key === "app.tagline" || key === "app.tagline4")).toBe(eng);
  expect(taglineKey()).toBe(erste);
});

/**
 * Jede Sprache muss mindestens einen Satz für die App-Bar übrig haben ·
 * sonst steht dort ein abgeschnittener, weil die Auswahl leer lief.
 */
it("leaves every language a claim short enough for the phone", async () => {
  for (const locale of LOCALES) {
    const dict = await loadLocale(locale);
    const passend = TAGLINES.filter((key) => taglineWidth(dict[key]) <= COMPACT_LIMIT);
    expect(passend.length, `${locale} hat keinen kurzen Claim`).toBeGreaterThan(0);
  }
});
