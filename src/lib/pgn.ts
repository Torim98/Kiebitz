import { Chess } from "chess.js";
import type { GameRecord } from "./db";
import {
  clockStamp,
  clocksFromPgn,
  parseClocks,
  parseTimeControl,
  serializeClocks,
} from "./clocks";

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

/** Liest einen optionalen, plausiblen Prozentwert aus einem Kiebitz-Header. */
function accuracy(value = ""): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function normalizedPlayer(value = ""): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

/** Leitet die übliche Schach-Zeitklasse aus PGN-TimeClass/TimeControl ab. */
function timeClass(h: Record<string, string>): string {
  const declared = h.TimeClass?.trim().toLowerCase();
  if (declared && ["bullet", "blitz", "rapid", "classical", "daily", "otb"].includes(declared)) {
    return declared;
  }
  const control = h.TimeControl?.trim();
  if (!control || control === "?" || control === "-") return "otb";

  // Unterstützt u. a. 900+10 sowie Turnierformate wie 40/7200:3600.
  const stages = control.split(":");
  let seconds = 0;
  for (const stage of stages) {
    const match = /^(?:(\d+)\/)?(\d+)(?:\+(\d+))?$/.exec(stage.trim());
    if (!match) return "otb";
    const moves = Number(match[1] || 40);
    seconds += Number(match[2]) + Number(match[3] || 0) * moves;
  }
  if (seconds < 180) return "bullet";
  if (seconds < 600) return "blitz";
  if (seconds < 3600) return "rapid";
  return "classical";
}

export class PgnPlayerMismatchError extends Error {
  readonly playerName: string;
  readonly unmatchedGames: number;

  constructor(playerName: string, unmatchedGames: number) {
    super(`PGN player name does not match White or Black in ${unmatchedGames} game(s)`);
    this.name = "PgnPlayerMismatchError";
    this.playerName = playerName.trim();
    this.unmatchedGames = unmatchedGames;
  }
}

/** Parses one or more PGN games into normal database records. */
export function importPgn(
  text: string,
  playerName: string,
  options: { excludeFromAnalysis?: boolean } = {}
): GameRecord[] {
  const player = normalizedPlayer(playerName);
  const parsed = splitGames(text).map((block) => ({ block, headers: headers(block) }));
  const unmatchedGames = parsed.filter(({ headers: h }) => {
    const white = normalizedPlayer(h.White);
    const black = normalizedPlayer(h.Black);
    return player === "" || (white !== player && black !== player);
  }).length;
  if (unmatchedGames > 0) {
    throw new PgnPlayerMismatchError(playerName, unmatchedGames);
  }

  return parsed.map(({ block, headers: h }) => {
    const chess = new Chess();
    chess.loadPgn(block, { strict: false });
    const moves = chess.history();
    const isBlack = normalizedPlayer(h.Black) === player;
    const color = isBlack ? "black" : "white";
    const opponent = color === "white" ? h.Black : h.White;
    const result = h.Result === "1/2-1/2" ? "draw" : h.Result === (color === "white" ? "1-0" : "0-1") ? "win" : "loss";
    const date = unixDate(h.UTCDate || h.Date, h.UTCTime);
    const stable = [h.Date, h.Round, h.White, h.Black, moves.join(" ")].join("|");
    const storedMine = {
      overall: accuracy(h.KiebitzAccuracy),
      opening: accuracy(h.KiebitzAccuracyOpening),
      middlegame: accuracy(h.KiebitzAccuracyMiddlegame),
      endgame: accuracy(h.KiebitzAccuracyEndgame),
    };
    const storedOpponent = {
      overall: accuracy(h.KiebitzOpponentAccuracy),
      opening: accuracy(h.KiebitzOpponentAccuracyOpening),
      middlegame: accuracy(h.KiebitzOpponentAccuracyMiddlegame),
      endgame: accuracy(h.KiebitzOpponentAccuracyEndgame),
    };
    const storedColor = h.KiebitzAccuracyColor?.trim().toLowerCase();
    // Seit beide Seiten exportiert werden, reist die damalige eigene Farbe
    // explizit mit. So bleiben die Werte auch korrekt, wenn dieselbe PGN aus
    // Sicht des anderen Spielers importiert wird. Alte Exporte ohne Marker
    // behalten aus Kompatibilitätsgründen ihre bisherige Perspektive.
    const swapAccuracy = (storedColor === "white" || storedColor === "black") && storedColor !== color;
    const mine = swapAccuracy ? storedOpponent : storedMine;
    const theirs = swapAccuracy ? storedMine : storedOpponent;
    return {
      id: null,
      source: "manual",
      source_id: `pgn-${hash(stable)}`,
      url: "",
      played_at: date.iso,
      played_ts: date.ts,
      time_class: timeClass(h),
      color,
      my_name: (color === "white" ? h.White : h.Black) || playerName.trim(),
      opponent: opponent || "?",
      opp_elo: Number(color === "white" ? h.BlackElo : h.WhiteElo) || 0,
      my_elo: Number(color === "white" ? h.WhiteElo : h.BlackElo) || 0,
      result,
      opening: h.Opening || "",
      eco: h.ECO || "",
      moves_count: Math.ceil(moves.length / 2),
      accuracy: mine.overall,
      accuracy_opening: mine.opening,
      accuracy_middlegame: mine.middlegame,
      accuracy_endgame: mine.endgame,
      opponent_accuracy: theirs.overall,
      opponent_accuracy_opening: theirs.opening,
      opponent_accuracy_middlegame: theirs.middlegame,
      opponent_accuracy_endgame: theirs.endgame,
      moves: moves.join(" "),
      clocks: serializeClocks(
        clocksFromPgn(block, parseTimeControl(h.TimeControl ?? "")).slice(0, moves.length)
      ),
      time_control: h.TimeControl ?? "",
      note: h.KiebitzNote || "",
      tags: tags(h.KiebitzTags),
      analyzed: false,
      analysis_excluded:
        options.excludeFromAnalysis ?? /^(1|true|yes)$/i.test(h.KiebitzAnalysisExcluded || ""),
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
    const ownName = game.my_name?.trim() || player;
    const white = game.color === "white" ? ownName : game.opponent;
    const black = game.color === "black" ? ownName : game.opponent;
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
    if (game.time_control) values.TimeControl = game.time_control;
    if (game.tags?.length) values.KiebitzTags = game.tags.join(", ");
    if (game.note) values.KiebitzNote = game.note;
    if (game.analysis_excluded) values.KiebitzAnalysisExcluded = "true";
    if ([
      game.accuracy,
      game.accuracy_opening,
      game.accuracy_middlegame,
      game.accuracy_endgame,
      game.opponent_accuracy,
      game.opponent_accuracy_opening,
      game.opponent_accuracy_middlegame,
      game.opponent_accuracy_endgame,
    ].some((value) => value != null)) values.KiebitzAccuracyColor = game.color;
    if (game.accuracy != null) values.KiebitzAccuracy = game.accuracy.toFixed(1);
    if (game.accuracy_opening != null) values.KiebitzAccuracyOpening = game.accuracy_opening.toFixed(1);
    if (game.accuracy_middlegame != null) values.KiebitzAccuracyMiddlegame = game.accuracy_middlegame.toFixed(1);
    if (game.accuracy_endgame != null) values.KiebitzAccuracyEndgame = game.accuracy_endgame.toFixed(1);
    if (game.opponent_accuracy != null) values.KiebitzOpponentAccuracy = game.opponent_accuracy.toFixed(1);
    if (game.opponent_accuracy_opening != null) values.KiebitzOpponentAccuracyOpening = game.opponent_accuracy_opening.toFixed(1);
    if (game.opponent_accuracy_middlegame != null) values.KiebitzOpponentAccuracyMiddlegame = game.opponent_accuracy_middlegame.toFixed(1);
    if (game.opponent_accuracy_endgame != null) values.KiebitzOpponentAccuracyEndgame = game.opponent_accuracy_endgame.toFixed(1);
    for (const [key, value] of Object.entries(values)) chess.setHeader(key, value);
    // Uhren gehen als %clk-Kommentare mit, so wie sie hereingekommen sind ·
    // ein Export/Import-Rundlauf verliert die Zeitdaten damit nicht.
    const clocks = parseClocks(game.clocks ?? "");
    game.moves
      .split(/\s+/)
      .filter(Boolean)
      .forEach((san, index) => {
        chess.move(san);
        const remaining = clocks[index];
        if (remaining != null) chess.setComment(`[%clk ${clockStamp(remaining)}]`);
      });
    return chess.pgn({ maxWidth: 100, newline: "\n" });
  }).join("\n\n");
}
