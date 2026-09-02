/**
 * Leichtgewichtiges, typsicheres i18n: ein Wörterbuch je Sprache unter
 * ./locales, ein Context, t() mit {param}-Interpolation. Das deutsche
 * Wörterbuch ist die Quelle der Wahrheit · fehlende Schlüssel einer anderen
 * Sprache erzwingt der Typ-Checker über `Record<Key, string>`.
 *
 * Die Locale kommt aus den App-Einstellungen (Desktop) bzw. localStorage
 * (Web-Preview); Zahl- und Datumsformatierung folgt über setFormatLocale.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSettings } from "./settings";
import { setFormatLocale } from "./format";
import type { Key } from "./locales/de";
import {
  isLocale,
  loadLocale,
  localeReady,
  LOCALES,
  translate,
  translator,
  type Locale,
  type TFunc,
} from "./locales/registry";

export type { Key, Locale, TFunc };
export { isLocale, loadLocale, LOCALES, translator };

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

/**
 * Loads a language first for non-React callers such as notifications.
 *
 * Setzt dabei auch das Zahlformat. Diese Aufrufer bauen Text außerhalb des
 * Providers zusammen, und seit der Wochenbericht Kennzahlen in seinen
 * Aufmacher schreibt, stünde dort sonst „4.1" neben einem deutschen Satz,
 * solange der Provider noch nicht gerendert hat. Ein Widerspruch zur
 * Oberfläche kann daraus nicht entstehen: beide lesen dieselbe Locale aus den
 * Einstellungen.
 */
export async function loadTranslator(locale: Locale): Promise<TFunc> {
  await loadLocale(locale);
  setFormatLocale(LOCALE_TAGS[locale]);
  return translator(locale);
}

interface I18nContext {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}

// Ohne Provider gilt Deutsch · das ist die Sprache, in der die Wörterbücher
// gepflegt werden. In der App liegt alles unter dem LocaleProvider, der mit
// Englisch startet; dieser Vorgabewert greift nur in Tests. `translate` schlägt
// das Wörterbuch bei jedem Aufruf nach: Ist das deutsche Paket noch nicht da,
// kommt Englisch heraus statt eines Schlüssels.
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
  const initialLocale = useRef<Locale | null>(null);
  if (initialLocale.current == null) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      initialLocale.current = isLocale(stored) ? stored : "en";
    } catch {
      initialLocale.current = "en";
    }
  }
  // Optional packs render the English fallback only until their small dynamic
  // import resolves; setting the locale afterwards causes one coherent render.
  const [locale, setLocaleState] = useState<Locale>(() =>
    localeReady(initialLocale.current!) ? initialLocale.current! : "en"
  );
  const localeRequest = useRef(0);

  const activateLocale = useCallback((next: Locale) => {
    const requestId = ++localeRequest.current;
    void loadLocale(next)
      .then(() => {
        if (localeRequest.current === requestId) setLocaleState(next);
      })
      .catch(() => {});
  }, []);

  // Zahlformatierung synchron zur Locale halten (auch beim ersten Render).
  setFormatLocale(LOCALE_TAGS[locale]);

  // Desktop: die in den Einstellungen gespeicherte Sprache gewinnt.
  useEffect(() => {
    getSettings()
      .then((s) => activateLocale(isLocale(s.locale) ? s.locale : "en"))
      .catch(() => {});
  }, [activateLocale]);

  // A locale restored from localStorage may live in an optional chunk.
  useEffect(() => activateLocale(initialLocale.current!), [activateLocale]);

  useEffect(() => {
    applyDocumentLocale(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* Storage nicht verfügbar · Locale gilt nur für die Sitzung */
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => activateLocale(l), [activateLocale]);
  const t = useCallback<TFunc>((key, params) => translate(locale, key, params), [locale]);

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nContext {
  return useContext(Ctx);
}

export function useT(): TFunc {
  return useContext(Ctx).t;
}
