import { describe, it, expect } from "vitest";
import { LOCALES, LOCALE_NAMES, LOCALE_TAGS, isLocale, isRtl, loadLocale, translator } from "./i18n";
import { de } from "./locales/de";
import { PUZZLE_THEMES } from "./locales/themes";

const KEYS = Object.keys(de) as (keyof typeof de)[];

/** Platzhalter einer Vorlage, sortiert · {n}, {p} … */
const params = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");

describe("locales", () => {
  it("offers every language with its own name and an Intl tag", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_NAMES[locale]).toBeTruthy();
      // Wirft, wenn der Tag kein gültiges BCP-47 ist.
      expect(new Intl.NumberFormat(LOCALE_TAGS[locale]).format(1)).toBeTruthy();
    }
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("de")).toBe(false);
  });

  it("rejects unknown locale codes from settings or storage", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("kl")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("loads every language pack and keeps all placeholders", async () => {
    for (const locale of LOCALES) {
      await loadLocale(locale);
      const t = translator(locale);
      for (const key of KEYS) {
        const text = t(key);
        expect(text, `${locale}/${key}`).not.toBe(key);
        expect(params(text), `${locale}/${key}`).toBe(params(de[key]));
      }
    }
  });

  it("interpolates parameters", () => {
    expect(translator("fr")("dash.streak", { n: 4 })).toContain("4");
    expect(translator("ar")("dash.streak", { n: 4 })).toContain("4");
  });

  it("names the puzzle themes in every language", () => {
    const english = Object.keys(PUZZLE_THEMES.en);
    for (const locale of LOCALES) {
      expect(Object.keys(PUZZLE_THEMES[locale]).sort()).toEqual([...english].sort());
    }
  });
});
