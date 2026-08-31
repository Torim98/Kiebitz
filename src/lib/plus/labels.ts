/**
 * Beschriftungen der Plus-Funktionen.
 *
 * Eine Tabelle statt verstreuter Zeichenketten: Die Erklärung, die
 * Einstellungen und jede gesperrte Stelle nennen dieselbe Funktion beim selben
 * Namen, und eine neue Feature-ID zwingt den Typ-Checker, hier vorbeizukommen.
 */
import type { Key } from "../i18n";
import { PLUS_ONLY_FEATURES, type BillingProvider, type PlusOnlyFeature } from "./types";

export const FEATURE_NAME_KEY: Record<PlusOnlyFeature, Key> = {
  background_analysis: "plus.f.background",
  full_insights: "plus.f.insights",
  personal_puzzles: "plus.f.puzzles",
  adaptive_plan: "plus.f.plan",
  automatic_lan_sync: "plus.f.lanSync",
  widgets: "plus.f.widgets",
  advanced_themes: "plus.f.themes",
  focus_board: "plus.f.focus",
  no_ads: "plus.f.noAds",
};

export const FEATURE_DESC_KEY: Record<PlusOnlyFeature, Key> = {
  background_analysis: "plus.d.background",
  full_insights: "plus.d.insights",
  personal_puzzles: "plus.d.puzzles",
  adaptive_plan: "plus.d.plan",
  automatic_lan_sync: "plus.d.lanSync",
  widgets: "plus.d.widgets",
  advanced_themes: "plus.d.themes",
  focus_board: "plus.d.focus",
  no_ads: "plus.d.noAds",
};

/** Reihenfolge in der Erklärung · dieselbe wie in der Featurematrix. */
export const FEATURE_ORDER: readonly PlusOnlyFeature[] = PLUS_ONLY_FEATURES;

export const PROVIDER_KEY: Record<BillingProvider, Key> = {
  stripe: "plus.providerStripe",
  google_play: "plus.providerPlay",
  manual: "plus.providerManual",
};

/** Verwaltung des Google-Play-Abos · dorthin führt die App bei Play-Käufen. */
export const PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions";

/**
 * E-Mail-Adresse verkürzt anzeigen. Über die Schulter gesehen soll nicht die
 * ganze Adresse dastehen; wer sie braucht, klappt sie auf.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}${domain}`;
}
