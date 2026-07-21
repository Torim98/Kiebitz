import { Chess } from "chess.js";
import type { GameRecord } from "./db";

function splitGames(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const starts = [...normalized.matchAll(/^\s*\[Event\s+/gm)].map((m) => m.index ?? 0);
  if (starts.length < 2) return [normalized];
  return starts.map((start, i) => normalized.slice(start, starts[i + 1]).trim()).filter(Boolean);
}

function headers(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm)) {
    out[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return out;
}

function unixDate(value = "", time = ""): { iso: string; ts: number } {
  const match = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(value);
  const now = new Date();
  const iso = match ? `${match[1]}-${match[2]}-${match[3]}` : now.toISOString().slice(0, 10);
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  const ts = Math.floor(Date.parse(`${iso}T${tm ? `${tm[1]}:${tm[2]}:${tm[3] ?? "00"}` : "12:00:00"}Z`) / 1000);
  return { iso, ts };
}

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function tags(value = ""): string[] {
  return [...new Set(value.split(/[,;]/).map((v) => v.trim()).filter(Boolean))];
}

/** Parses one or more PGN games into normal database records. */
export function importPgn(text: string, playerName: string): GameRecord[] {
  const player = playerName.trim().toLocaleLowerCase();
  return splitGames(text).map((block) => {
    const h = headers(block);
    const chess = new Chess();
    chess.loadPgn(block, { strict: false });
    const moves = chess.history();
    const isBlack = player !== "" && h.Black?.trim().toLocaleLowerCase() === player;
    const color = isBlack ? "black" : "white";
    const opponent = color === "white" ? h.Black : h.White;
    const result = h.Result === "1/2-1/2" ? "draw" : h.Result === (color === "white" ? "1-0" : "0-1") ? "win" : "loss";
    const date = unixDate(h.UTCDate || h.Date, h.UTCTime);
    const stable = [h.Date, h.Round, h.White, h.Black, moves.join(" ")].join("|");
    return {
      id: null,
      source: "manual",
      source_id: `pgn-${hash(stable)}`,
      url: "",
      played_at: date.iso,
      played_ts: date.ts,
      time_class: h.TimeClass?.toLowerCase() || (h.TimeControl ? "classical" : "otb"),
      color,
      opponent: opponent || "?",
      opp_elo: Number(color === "white" ? h.BlackElo : h.WhiteElo) || 0,
      my_elo: Number(color === "white" ? h.WhiteElo : h.BlackElo) || 0,
      result,
      opening: h.Opening || "",
      eco: h.ECO || "",
      moves_count: Math.ceil(moves.length / 2),
      accuracy: null,
      accuracy_opening: null,
      accuracy_middlegame: null,
      accuracy_endgame: null,
      moves: moves.join(" "),
      note: h.KiebitzNote || "",
      tags: tags(h.KiebitzTags),
      analyzed: false,
    };
  });
}

function resultHeader(game: GameRecord): string {
  if (game.result === "draw") return "1/2-1/2";
  const whiteWon = (game.color === "white") === (game.result === "win");
  return whiteWon ? "1-0" : "0-1";
}

/** Exports database games as standards-compliant, multi-game PGN. */
export function exportPgn(games: GameRecord[], playerName: string): string {
  const player = playerName.trim() || "Kiebitz user";
  return games.map((game) => {
    const chess = new Chess();
    const white = game.color === "white" ? player : game.opponent;
    const black = game.color === "black" ? player : game.opponent;
    const values: Record<string, string> = {
      Event: "Kiebitz export",
      Site: game.source === "manual" ? "OTB" : game.source,
      Date: (game.played_at || "????-??-??").replace(/-/g, "."),
      Round: "?",
      White: white,
      Black: black,
      Result: resultHeader(game),
      TimeClass: game.time_class,
    };
    if (game.my_elo > 0) values[game.color === "white" ? "WhiteElo" : "BlackElo"] = String(game.my_elo);
    if (game.opp_elo > 0) values[game.color === "white" ? "BlackElo" : "WhiteElo"] = String(game.opp_elo);
    if (game.eco) values.ECO = game.eco;
    if (game.opening) values.Opening = game.opening;
    if (game.tags?.length) values.KiebitzTags = game.tags.join(", ");
    if (game.note) values.KiebitzNote = game.note;
    if (game.accuracy != null) values.KiebitzAccuracy = game.accuracy.toFixed(1);
    if (game.accuracy_opening != null) values.KiebitzAccuracyOpening = game.accuracy_opening.toFixed(1);
    if (game.accuracy_middlegame != null) values.KiebitzAccuracyMiddlegame = game.accuracy_middlegame.toFixed(1);
    if (game.accuracy_endgame != null) values.KiebitzAccuracyEndgame = game.accuracy_endgame.toFixed(1);
    for (const [key, value] of Object.entries(values)) chess.setHeader(key, value);
    for (const san of game.moves.split(/\s+/).filter(Boolean)) chess.move(san);
    return chess.pgn({ maxWidth: 100, newline: "\n" });
  }).join("\n\n");
}
