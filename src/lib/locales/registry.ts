/**
 * Die Wörterbücher selbst · ohne React und ohne App-Anbindung.
 *
 * Getrennt von `lib/i18n.tsx`, weil dort der Provider steht und der die
 * Einstellungen liest — also die Tauri-Brücke. Wer nur ein Wörterbuch braucht
 * (das Test-Setup, ein Skript), zöge sie sonst mit herein: Ein Testfile, das
 * `@tauri-apps/api/core` ersetzt, käme zu spät, weil `settings.ts` die echte
 * `invoke` schon in der Hand hätte.
 *
 * Hier hängt deshalb nichts als die Wörterbücher.
 */
import type { Key } from "./de";
import { en } from "./en";

/**
 * Reihenfolge der Sprachwahl · Englisch und Deutsch zuerst (die beiden von
 * Hand gepflegten Wörterbücher), danach nach Sprecherzahl.
 */
export const LOCALES = ["en", "de", "es", "fr", "hi", "ar", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

export type Dictionary = Record<Key, string>;

/** Prüft einen gespeicherten Wert (Settings, localStorage) gegen die Liste. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Fest im Startbündel liegt genau ein Wörterbuch: Englisch. Es ist die
 * Voreinstellung einer frischen Installation und zugleich die Rückfallebene
 * für jeden Schlüssel — mehr braucht der erste Bildaufbau nicht.
 *
 * Deutsch kommt nach wie die fünf anderen Sprachen. Es ist die Quelle, in der
 * die Texte gepflegt werden, aber im gebauten Bündel ist es einfach das
 * zweitgrößte Wörterbuch: rund hundert Kilobyte, die englische, spanische oder
 * chinesische Nutzer nie zu Gesicht bekommen. Wer auf Deutsch startet, sieht
 * dafür einen Bildaufbau lang Englisch — dieselbe Kröte, die die anderen fünf
 * Sprachen seit jeher schlucken, und aus einer Datei nachgeladen, die neben
 * der App liegt.
 */
const dicts: Partial<Record<Locale, Dictionary>> = { en };

const localeLoaders: Partial<Record<Locale, () => Promise<Dictionary>>> = {
  de: () => import("./de").then((module) => module.de),
  es: () => import("./es").then((module) => module.es),
  fr: () => import("./fr").then((module) => module.fr),
  hi: () => import("./hi").then((module) => module.hi),
  ar: () => import("./ar").then((module) => module.ar),
  zh: () => import("./zh").then((module) => module.zh),
};

const localeRequests = new Map<Locale, Promise<Dictionary>>();

/** Ist das Wörterbuch schon zur Hand? Dann startet der Provider damit. */
export function localeReady(locale: Locale): boolean {
  return dicts[locale] != null;
}

/** Loads and memoizes an optional language pack. */
export function loadLocale(locale: Locale): Promise<Dictionary> {
  const loaded = dicts[locale];
  if (loaded) return Promise.resolve(loaded);
  let request = localeRequests.get(locale);
  if (!request) {
    const loader = localeLoaders[locale];
    if (!loader) return Promise.resolve(en);
    request = loader().then((dictionary) => {
      dicts[locale] = dictionary;
      return dictionary;
    });
    localeRequests.set(locale, request);
    void request.catch(() => localeRequests.delete(locale));
  }
  return request;
}

export type TFunc = (key: Key, params?: Record<string, string | number>) => string;

export function translate(
  locale: Locale,
  key: Key,
  params?: Record<string, string | number>
): string {
  // Jedes Wörterbuch ist über `Record<Key, string>` vollständig · Englisch
  // trifft deshalb immer, solange das gewählte Paket noch unterwegs ist.
  let text: string = dicts[locale]?.[key] ?? en[key] ?? key;
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
