import { Chess } from "chess.js";
import type { GameRecord } from "./db";

/** Liest einen PGN-Header-Wert, z. B. header(pgn, "ECO") → "B20". */
function pgnHeader(pgn: string, key: string): string {
  const m = pgn.match(new RegExp(`\\[${key} "([^"]*)"\\]`));
  return m ? m[1] : "";
}

/** "Sicilian-Defense-Bowdler-Attack-2...e6" → "Sicilian Defense Bowdler Attack" */
function openingFromSlug(url: string): string {
  const slug = url.split("/openings/")[1] ?? "";
  const words: string[] = [];
  for (const w of slug.split("-")) {
    if (/\d/.test(w)) break; // ab der Zugangabe abschneiden
    if (w) words.push(w);
  }
  return words.join(" ");
}

/** PGN-Movetext → SAN-Liste (über chess.js, ignoriert Uhr-Kommentare). */
function sansFromPgn(pgn: string): string[] {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.history();
  } catch {
    return [];
  }
}

interface CcSide {
  username: string;
  rating: number;
  result: string;
}

interface CcGame {
  url: string;
  pgn?: string;
  end_time: number;
  time_class: string;
  white: CcSide;
  black: CcSide;
  accuracies?: { white?: number; black?: number };
}

const TIME_CLASS: Record<string, string> = {
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  daily: "daily",
  classical: "classical",
  correspondence: "daily",
  ultraBullet: "bullet",
};

function ccResult(me: CcSide, opp: CcSide): "win" | "loss" | "draw" {
  if (me.result === "win") return "win";
  if (opp.result === "win") return "loss";
  return "draw";
}

/** Import von chess.com: die letzten `months` Monatsarchive. */
export async function importChessCom(user: string, months = 3): Promise<GameRecord[]> {
  const res = await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/archives`);
  if (!res.ok) throw new Error(`chess.com: ${res.status}`);
  const archives: string[] = (await res.json()).archives ?? [];

  const games: GameRecord[] = [];
  for (const url of archives.slice(-months)) {
    const monthRes = await fetch(url);
    if (!monthRes.ok) continue;
    const monthGames: CcGame[] = (await monthRes.json()).games ?? [];

    for (const g of monthGames) {
      const iAmWhite = g.white.username.toLowerCase() === user.toLowerCase();
      const me = iAmWhite ? g.white : g.black;
      const opp = iAmWhite ? g.black : g.white;
      const pgn = g.pgn ?? "";
      const sans = sansFromPgn(pgn);
      const date = pgnHeader(pgn, "Date").split(".").join("-") ||
        new Date(g.end_time * 1000).toISOString().slice(0, 10);

      games.push({
        id: null,
        source: "chess.com",
        source_id: g.url.split("/").pop() ?? g.url,
        url: g.url,
        played_at: date,
        time_class: TIME_CLASS[g.time_class] ?? g.time_class,
        color: iAmWhite ? "white" : "black",
        opponent: opp.username,
        opp_elo: opp.rating,
        my_elo: me.rating,
        result: ccResult(me, opp),
        opening: openingFromSlug(pgnHeader(pgn, "ECOUrl")) || pgnHeader(pgn, "ECO"),
        eco: pgnHeader(pgn, "ECO"),
        moves_count: Math.ceil(sans.length / 2),
        accuracy: (iAmWhite ? g.accuracies?.white : g.accuracies?.black) ?? null,
        moves: sans.join(" "),
        note: "",
        analyzed: false,
      });
    }
  }
  return games;
}

interface LiGame {
  id: string;
  speed: string;
  winner?: "white" | "black";
  createdAt: number;
  moves?: string;
  opening?: { eco: string; name: string };
  players: {
    white: { user?: { name: string }; rating?: number };
    black: { user?: { name: string }; rating?: number };
  };
}

/** Import von Lichess: die letzten `max` Partien als NDJSON. */
export async function importLichess(user: string, max = 200): Promise<GameRecord[]> {
  const res = await fetch(
    `https://lichess.org/api/games/user/${user}?max=${max}&opening=true`,
    { headers: { Accept: "application/x-ndjson" } }
  );
  if (!res.ok) throw new Error(`lichess: ${res.status}`);
  const text = await res.text();

  const games: GameRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const g: LiGame = JSON.parse(line);
    const whiteName = g.players.white.user?.name ?? "?";
    const iAmWhite = whiteName.toLowerCase() === user.toLowerCase();
    const me = iAmWhite ? g.players.white : g.players.black;
    const opp = iAmWhite ? g.players.black : g.players.white;
    const myColor = iAmWhite ? "white" : "black";
    const plies = g.moves ? g.moves.split(" ").length : 0;

    games.push({
      id: null,
      source: "lichess",
      source_id: g.id,
      url: `https://lichess.org/${g.id}`,
      played_at: new Date(g.createdAt).toISOString().slice(0, 10),
      time_class: TIME_CLASS[g.speed] ?? g.speed,
      color: myColor,
      opponent: opp.user?.name ?? "Anonym",
      opp_elo: opp.rating ?? 0,
      my_elo: me.rating ?? 0,
      result: g.winner == null ? "draw" : g.winner === myColor ? "win" : "loss",
      opening: g.opening?.name ?? "",
      eco: g.opening?.eco ?? "",
      moves_count: Math.ceil(plies / 2),
      accuracy: null,
      moves: g.moves ?? "",
      note: "",
      analyzed: false,
    });
  }
  return games;
}

export interface ImportSummary {
  fetched: { cc: number; li: number };
  errors: string[];
}

/** Holt Partien von beiden Plattformen; Fehler einer Quelle blockieren die andere nicht. */
export async function fetchAll(
  ccUser: string,
  liUser: string
): Promise<{ games: GameRecord[]; summary: ImportSummary }> {
  const [cc, li] = await Promise.allSettled([importChessCom(ccUser), importLichess(liUser)]);
  const games: GameRecord[] = [];
  const summary: ImportSummary = { fetched: { cc: 0, li: 0 }, errors: [] };

  if (cc.status === "fulfilled") {
    games.push(...cc.value);
    summary.fetched.cc = cc.value.length;
  } else {
    summary.errors.push(`chess.com: ${cc.reason}`);
  }
  if (li.status === "fulfilled") {
    games.push(...li.value);
    summary.fetched.li = li.value.length;
  } else {
    summary.errors.push(`Lichess: ${li.reason}`);
  }
  return { games, summary };
}
