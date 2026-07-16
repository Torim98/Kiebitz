import type { Game } from "../data/demo";
import type { Locale } from "./i18n";
import type { GameRecord } from "./db";

/** UI-Form einer Partie: Demo-Partien und DB-Partien teilen diese Struktur. */
export interface UiGame extends Omit<Game, "tc"> {
  tc: string;
  dbId?: number;
  url?: string;
}

const TC_LABEL: Record<Locale, Record<string, string>> = {
  de: {
    bullet: "Bullet",
    blitz: "Blitz",
    rapid: "Rapid",
    daily: "Täglich",
    classical: "Klassisch",
  },
  en: {
    bullet: "Bullet",
    blitz: "Blitz",
    rapid: "Rapid",
    daily: "Daily",
    classical: "Classical",
  },
};

export function tcLabel(timeClass: string, locale: Locale): string {
  return TC_LABEL[locale][timeClass] ?? timeClass;
}

export function toUi(r: GameRecord, locale: Locale = "de"): UiGame {
  const [y, m, d] = r.played_at.split("-");
  const date =
    d && m && y ? (locale === "en" ? `${y}-${m}-${d}` : `${d}.${m}.${y}`) : r.played_at;
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
    analyzed: r.analyzed,
    tags: [],
    note: r.note || undefined,
    sans: r.moves ? r.moves.split(" ") : undefined,
  };
}
