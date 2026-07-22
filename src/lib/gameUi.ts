import type { Game, Result, Source } from "../data/demo";
import type { Locale } from "./i18n";
import type { GameRecord } from "./db";

/** UI-Form einer Partie: Demo-Partien und DB-Partien teilen diese Struktur. */
export interface UiGame extends Omit<Game, "tc"> {
  tc: string;
  dbId?: number;
  url?: string;
  analysisExcluded?: boolean;
}

/**
 * Vorfilter für die Partien-Liste (z. B. von einem Klick im Dashboard).
 * Alle Felder matchen exakt gegen die jeweiligen `UiGame`-Felder — `date` und
 * `tc` sind bereits lokalisierte Anzeige-Strings, die zwischen Dashboard und
 * Games übereinstimmen, solange dieselbe Locale gilt.
 */
export interface GamesFilter {
  source?: Source;
  result?: Result;
  tc?: string;
  date?: string;
  opponent?: string;
  opening?: string;
}

const TC_LABEL: Record<Locale, Record<string, string>> = {
  de: {
    bullet: "Bullet",
    blitz: "Blitz",
    rapid: "Rapid",
    daily: "Täglich",
    classical: "Klassisch",
    otb: "Brett",
  },
  en: {
    bullet: "Bullet",
    blitz: "Blitz",
    rapid: "Rapid",
    daily: "Daily",
    classical: "Classical",
    otb: "OTB",
  },
};

export function tcLabel(timeClass: string, locale: Locale): string {
  return TC_LABEL[locale][timeClass] ?? timeClass;
}

/**
 * Anzeige-Datum einer Partie. Bevorzugt `played_ts` (Unix, überall die
 * kanonische Sortier-Zeit — bei chess.com das Partie-ENDE), damit Anzeige und
 * Reihenfolge übereinstimmen. Bei chess.com-Fernpartien weicht `played_at`
 * (Start-Datum aus dem PGN) sonst von der Sortierung ab. Fallback auf
 * `played_at` für Alt-Datensätze ohne Zeitstempel.
 */
function gameDate(r: GameRecord, locale: Locale): string {
  if (r.played_ts > 0) {
    const dt = new Date(r.played_ts * 1000);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return locale === "en" ? `${y}-${m}-${d}` : `${d}.${m}.${y}`;
  }
  const [y, m, d] = r.played_at.split("-");
  return d && m && y ? (locale === "en" ? `${y}-${m}-${d}` : `${d}.${m}.${y}`) : r.played_at;
}

export function toUi(r: GameRecord, locale: Locale = "de"): UiGame {
  const date = gameDate(r, locale);
  return {
    id: `db-${r.id}`,
    dbId: r.id ?? undefined,
    url: r.url,
    date,
    source: r.source,
    tc: tcLabel(r.time_class, locale),
    color: r.color,
    opponent: r.opponent,
    oppElo: r.opp_elo,
    myElo: r.my_elo,
    result: r.result,
    opening: r.opening || "—",
    eco: r.eco,
    moves: r.moves_count,
    accuracy: r.accuracy,
    accuracyOpening: r.accuracy_opening,
    accuracyMiddlegame: r.accuracy_middlegame,
    accuracyEndgame: r.accuracy_endgame,
    analyzed: r.analyzed,
    analysisExcluded: r.analysis_excluded,
    tags: r.tags ?? [],
    note: r.note || undefined,
    sans: r.moves ? r.moves.split(" ") : undefined,
  };
}
