/**
 * Leichtgewichtiges, typsicheres i18n: ein Wörterbuch je Sprache unter
 * ./locales, ein Context, t() mit {param}-Interpolation. Das deutsche
 * Wörterbuch ist die Quelle der Wahrheit · fehlende Schlüssel einer anderen
 * Sprache erzwingt der Typ-Checker über `Record<Key, string>`.
 *
 * Die Locale kommt aus den App-Einstellungen (Desktop) bzw. localStorage
 * (Web-Preview); Zahl- und Datumsformatierung folgt über setFormatLocale.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getSettings } from "./settings";
import { setFormatLocale } from "./util";
import { de, type Key } from "./locales/de";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import { es } from "./locales/es";
import { zh } from "./locales/zh";
import { hi } from "./locales/hi";
import { ar } from "./locales/ar";

export type { Key };

/**
 * Reihenfolge der Sprachwahl · Englisch und Deutsch zuerst (die beiden von
 * Hand gepflegten Wörterbücher), danach nach Sprecherzahl.
 */
export const LOCALES = ["en", "de", "es", "fr", "hi", "ar", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Eigenname der Sprache. Im Sprachwähler steht jede Sprache in sich selbst ·
 * wer die App gerade auf Chinesisch vorfindet, soll "Deutsch" trotzdem finden.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  hi: "हिन्दी",
  ar: "العربية",
  zh: "中文",
};

/**
 * BCP-47-Tag für `Intl` (Zahlen, Datum, Uhrzeit).
 *
 * Arabisch bekommt bewusst `-u-nu-latn`: die Achsenbeschriftungen der Charts
 * kommen von Recharts als rohe Zahlen, und ein Tooltip in ٠١٢ neben einer
 * Achse in 012 liest sich wie ein Fehler.
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  hi: "hi-IN",
  ar: "ar-u-nu-latn",
  zh: "zh-CN",
};

/** Sprachen, die von rechts nach links gesetzt werden. */
const RTL: readonly Locale[] = ["ar"];

export function isRtl(locale: Locale): boolean {
  return RTL.includes(locale);
}

/** Prüft einen gespeicherten Wert (Settings, localStorage) gegen die Liste. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

const dicts: Record<Locale, Record<Key, string>> = { de, en, es, fr, hi, ar, zh };

export type TFunc = (key: Key, params?: Record<string, string | number>) => string;

function translate(locale: Locale, key: Key, params?: Record<string, string | number>): string {
  let text: string = dicts[locale][key] ?? en[key] ?? de[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Übersetzer außerhalb von React (z. B. für Benachrichtigungstexte). */
export function translator(locale: Locale): TFunc {
  return (key, params) => translate(locale, key, params);
}

interface I18nContext {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}

// Ohne Provider gilt Deutsch · das ist die Sprache, in der die Wörterbücher
// gepflegt werden. In der App liegt alles unter dem LocaleProvider, der mit
// Englisch startet; dieser Vorgabewert greift nur in Tests.
const Ctx = createContext<I18nContext>({
  locale: "de",
  setLocale: () => {},
  t: (key, params) => translate("de", key, params),
});

const STORAGE_KEY = "kiebitz.locale";

/**
 * Sprache, Schreibrichtung und Zahlformat am Dokument setzen. `lang` steuert
 * Silbentrennung und Font-Fallback (ohne das zeigt Chromium für Hindi und
 * Arabisch gerne die falsche Schriftfamilie), `dir` die Schreibrichtung.
 */
function applyDocumentLocale(locale: Locale): void {
  setFormatLocale(LOCALE_TAGS[locale]);
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Neuinstallationen starten auf Englisch; die gespeicherte Wahl gewinnt.
  const [locale, setLocaleState] = useState<Locale>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isLocale(stored) ? stored : "en";
    } catch {
      return "en";
    }
  });

  // Zahlformatierung synchron zur Locale halten (auch beim ersten Render).
  setFormatLocale(LOCALE_TAGS[locale]);

  // Desktop: die in den Einstellungen gespeicherte Sprache gewinnt.
  useEffect(() => {
    getSettings()
      .then((s) => setLocaleState(isLocale(s.locale) ? s.locale : "en"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* Storage nicht verfügbar · Locale gilt nur für die Sitzung */
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const t = useCallback<TFunc>((key, params) => translate(locale, key, params), [locale]);

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nContext {
  return useContext(Ctx);
}

export function useT(): TFunc {
  return useContext(Ctx).t;
}
