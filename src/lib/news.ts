/**
 * Neuigkeiten beim ersten Start nach einem Update.
 *
 * Es gibt immer genau eine aktuelle Meldung. Sie erscheint, solange ihre
 * Kennung nicht in den Einstellungen steht · "Nicht mehr anzeigen" schreibt sie
 * dorthin. Für die nächste Version wird hier eine neue Kennung samt Texten
 * eingetragen, und die Meldung erscheint wieder. Ein Schalter statt der
 * Kennung würde das nicht können: er wäre nach dem ersten Wegklicken für
 * immer aus.
 *
 * Absichtlich kein Abgleich mit der App-Version: eine Version ohne
 * mitteilenswerte Neuigkeit soll niemanden mit einem leeren Fenster begrüßen.
 */
import { getSettings, setSettings, type Settings } from "./settings";
import type { Key } from "./i18n";

export interface NewsLink {
  labelKey: Key;
  url: string;
}

export interface NewsEntry {
  /** Frei wählbar, muss sich zur Vorgängermeldung unterscheiden. */
  id: string;
  titleKey: Key;
  introKey: Key;
  /** Die Punkte der Meldung, in dieser Reihenfolge. */
  pointKeys: Key[];
  /** Schlusssatz unter den Punkten. */
  outroKey: Key;
  links: NewsLink[];
}

export const CURRENT_NEWS: NewsEntry = {
  id: "2026-07-beta",
  titleKey: "news.betaTitle",
  introKey: "news.betaIntro",
  pointKeys: [
    "news.betaFeedback",
    "news.betaClosedBeta",
    "news.betaTestDays",
    "news.betaFuture",
  ],
  outroKey: "news.betaThanks",
  links: [
    { labelKey: "news.linkWebsite", url: "https://torim98.github.io/kiebitz-site/" },
    {
      labelKey: "news.linkPlayStore",
      url: "https://play.google.com/store/apps/details?id=de.torim.kiebitz",
    },
  ],
};

/** Die Meldung, die jetzt ansteht · null, wenn sie schon weggeklickt wurde. */
export function pendingNews(settings: Settings): NewsEntry | null {
  // Vor der Ersteinrichtung hat die Meldung keinen Platz · sie kommt direkt
  // danach, wenn das Onboarding die Einstellungen gespeichert hat.
  if (!settings.onboarded) return null;
  return settings.news_seen === CURRENT_NEWS.id ? null : CURRENT_NEWS;
}

/**
 * Merkt sich die Meldung als erledigt. Die Einstellungen werden dafür frisch
 * gelesen, damit nichts überschrieben wird, was inzwischen woanders gesetzt
 * wurde (der Klang-Regler etwa).
 */
export async function markNewsSeen(entry: NewsEntry = CURRENT_NEWS): Promise<void> {
  const current = await getSettings();
  if (current.news_seen === entry.id) return;
  await setSettings({ ...current, news_seen: entry.id });
}
