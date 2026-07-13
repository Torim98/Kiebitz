import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Ein Puzzle aus der lokalen Lichess-Datenbank. */
export interface PuzzleOut {
  id: string;
  fen: string;
  /** UCI-Züge; der erste ist der Gegnerzug, der die Aufgabe stellt. */
  moves: string[];
  rating: number;
  themes: string[];
}

export interface AttemptResult {
  rating_before: number;
  rating_after: number;
  delta: number;
}

export interface ThemeStat {
  theme: string;
  attempts: number;
  solved: number;
}

export interface PuzzleStats {
  personal_rating: number;
  db_total: number;
  attempts: number;
  solved: number;
  today_solved: number;
  streak_days: number;
  history: number[];
  themes: ThemeStat[];
  importing: boolean;
}

export interface PuzzleImportProgress {
  imported: number;
  source: "download" | "file";
}

export interface PuzzleImportDone {
  imported: number;
  total: number;
  error: string | null;
}

/** Ohne Pfad: Direkt-Download des Lichess-Dumps (~250 MB). */
export function importPuzzles(path?: string): Promise<void> {
  return invoke("import_puzzles", { path: path ?? null });
}

export function nextPuzzle(opts: {
  theme?: string;
  minRating?: number;
  maxRating?: number;
}): Promise<PuzzleOut | null> {
  return invoke<PuzzleOut | null>("next_puzzle", {
    theme: opts.theme ?? null,
    minRating: opts.minRating ?? null,
    maxRating: opts.maxRating ?? null,
  });
}

export function recordAttempt(puzzleId: string, solved: boolean): Promise<AttemptResult> {
  return invoke<AttemptResult>("record_attempt", { puzzleId, solved });
}

export function puzzleStats(): Promise<PuzzleStats> {
  return invoke<PuzzleStats>("puzzle_stats");
}

export function onPuzzleImportProgress(
  cb: (p: PuzzleImportProgress) => void
): Promise<UnlistenFn> {
  return listen<PuzzleImportProgress>("puzzles://progress", (e) => cb(e.payload));
}

export function onPuzzleImportDone(cb: (p: PuzzleImportDone) => void): Promise<UnlistenFn> {
  return listen<PuzzleImportDone>("puzzles://done", (e) => cb(e.payload));
}

/** Deutsche Namen für die häufigsten Lichess-Motive. */
export const THEME_DE: Record<string, string> = {
  fork: "Gabel",
  pin: "Fesselung",
  skewer: "Spieß",
  discoveredAttack: "Abzug",
  backRankMate: "Grundreihenmatt",
  mate: "Matt",
  mateIn1: "Matt in 1",
  mateIn2: "Matt in 2",
  mateIn3: "Matt in 3",
  smotheredMate: "Ersticktes Matt",
  endgame: "Endspiel",
  middlegame: "Mittelspiel",
  opening: "Eröffnung",
  rookEndgame: "Turmendspiel",
  pawnEndgame: "Bauernendspiel",
  queenEndgame: "Damenendspiel",
  knightEndgame: "Springerendspiel",
  bishopEndgame: "Läuferendspiel",
  zugzwang: "Zugzwang",
  sacrifice: "Opfer",
  attraction: "Hinlenkung",
  deflection: "Ablenkung",
  clearance: "Räumung",
  interference: "Unterbrechung",
  intermezzo: "Zwischenzug",
  quietMove: "Stiller Zug",
  xRayAttack: "Röntgenangriff",
  doubleCheck: "Doppelschach",
  promotion: "Umwandlung",
  underPromotion: "Unterverwandlung",
  enPassant: "En passant",
  castling: "Rochade",
  trappedPiece: "Gefangene Figur",
  hangingPiece: "Hängende Figur",
  exposedKing: "Offener König",
  kingsideAttack: "Königsangriff",
  queensideAttack: "Damenflügelangriff",
  defensiveMove: "Verteidigungszug",
  equality: "Ausgleich",
  advantage: "Vorteil",
  crushing: "Vernichtend",
  short: "Kurz",
  long: "Lang",
  veryLong: "Sehr lang",
  oneMove: "Ein Zug",
  master: "Meisterpartie",
  masterVsMaster: "Meister gegen Meister",
  superGM: "Super-GM",
};

export function themeLabel(theme: string): string {
  return THEME_DE[theme] ?? theme;
}
