import type { Game } from "../data/demo";
import type { GameRecord } from "./db";

/** UI-Form einer Partie: Demo-Partien und DB-Partien teilen diese Struktur. */
export interface UiGame extends Omit<Game, "tc"> {
  tc: string;
  dbId?: number;
  url?: string;
}

export const TC_LABEL: Record<string, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  daily: "Täglich",
  classical: "Klassisch",
};

export function toUi(r: GameRecord): UiGame {
  const [y, m, d] = r.played_at.split("-");
  return {
    id: `db-${r.id}`,
    dbId: r.id ?? undefined,
    url: r.url,
    date: d && m && y ? `${d}.${m}.${y}` : r.played_at,
    source: r.source,
    tc: TC_LABEL[r.time_class] ?? r.time_class,
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
