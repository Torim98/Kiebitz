import type { Game, Result, Source } from "../data/demo";
import { translator, type Key, type Locale } from "./i18n";
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
 * Alle Felder matchen exakt gegen die jeweiligen `UiGame`-Felder · `date` und
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

/**
 * Bedenkzeit-Klassen kommen aus demselben Wörterbuch wie der Rest der
 * Oberfläche · eine zweite, je Sprache gepflegte Tabelle hier wäre genau die
 * Stelle, an der eine neue Sprache vergessen wird.
 */
const TC_KEY: Record<string, Key> = {
  bullet: "common.tc.bullet",
  blitz: "common.tc.blitz",
  rapid: "common.tc.rapid",
  daily: "common.tc.daily",
  classical: "common.tc.classical",
  otb: "common.tc.otb",
};

export function tcLabel(timeClass: string, locale: Locale): string {
  const key = TC_KEY[timeClass];
  return key ? translator(locale)(key) : timeClass;
}

/**
 * Anzeige-Datum einer Partie. Bevorzugt `played_ts` (Unix, überall die
 * kanonische Sortier-Zeit · bei chess.com das Partie-ENDE), damit Anzeige und
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
    return locale === "de" ? `${d}.${m}.${y}` : `${y}-${m}-${d}`;
  }
  const [y, m, d] = r.played_at.split("-");
  return d && m && y ? (locale === "de" ? `${d}.${m}.${y}` : `${y}-${m}-${d}`) : r.played_at;
}

export function toUi(r: GameRecord, locale: Locale = "en"): UiGame {
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
