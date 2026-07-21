import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { emitDataChange } from "./changes";

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
  /** Alle heutigen Versuche (gelöst oder nicht) — fürs Tagesziel im Dashboard. */
  today_attempts: number;
  streak_days: number;
  history: number[];
  themes: ThemeStat[];
  importing: boolean;
  /** Unix-Sekunden des letzten Dump-Imports (null = nie importiert). */
  imported_at: number | null;
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
  return invoke<AttemptResult>("record_attempt", { puzzleId, solved }).then((r) => {
    emitDataChange();
    return r;
  });
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
const THEME_DE: Record<string, string> = {
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

/** Englische Namen (Lichess-Originalbezeichnungen, lesbar formatiert). */
const THEME_EN: Record<string, string> = {
  fork: "Fork",
  pin: "Pin",
  skewer: "Skewer",
  discoveredAttack: "Discovered attack",
  backRankMate: "Back-rank mate",
  mate: "Mate",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  smotheredMate: "Smothered mate",
  endgame: "Endgame",
  middlegame: "Middlegame",
  opening: "Opening",
  rookEndgame: "Rook endgame",
  pawnEndgame: "Pawn endgame",
  queenEndgame: "Queen endgame",
  knightEndgame: "Knight endgame",
  bishopEndgame: "Bishop endgame",
  zugzwang: "Zugzwang",
  sacrifice: "Sacrifice",
  attraction: "Attraction",
  deflection: "Deflection",
  clearance: "Clearance",
  interference: "Interference",
  intermezzo: "Intermezzo",
  quietMove: "Quiet move",
  xRayAttack: "X-ray attack",
  doubleCheck: "Double check",
  promotion: "Promotion",
  underPromotion: "Underpromotion",
  enPassant: "En passant",
  castling: "Castling",
  trappedPiece: "Trapped piece",
  hangingPiece: "Hanging piece",
  exposedKing: "Exposed king",
  kingsideAttack: "Kingside attack",
  queensideAttack: "Queenside attack",
  defensiveMove: "Defensive move",
  equality: "Equality",
  advantage: "Advantage",
  crushing: "Crushing",
  short: "Short",
  long: "Long",
  veryLong: "Very long",
  oneMove: "One move",
  master: "Master game",
  masterVsMaster: "Master vs. master",
  superGM: "Super GM",
};

export function themeLabel(theme: string, locale: "de" | "en" = "de"): string {
  const map = locale === "en" ? THEME_EN : THEME_DE;
  return map[theme] ?? theme;
}
