import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { emitDataChange } from "./changes";
import { formatBytes } from "./settings";
import { deInt } from "./util";
import type { TFunc } from "./i18n";

/** Ein Puzzle aus der lokalen Lichess-Datenbank. */
export interface PuzzleOut {
  id: string;
  fen: string;
  /** UCI-Züge; der erste ist der Gegnerzug, der die Aufgabe stellt. */
  moves: string[];
  rating: number;
  themes: string[];
  source: "lichess" | "own";
  source_game_id: number | null;
  /** 1 bei Lichess-Aufgaben, 0 bei direkt spielbaren eigenen Stellungen. */
  setup_plies: number;
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
  lichess_total: number;
  own_total: number;
  attempts: number;
  solved: number;
  today_solved: number;
  /** Alle heutigen Versuche (gelöst oder nicht) · fürs Tagesziel im Dashboard. */
  today_attempts: number;
  streak_days: number;
  history: number[];
  themes: ThemeStat[];
  importing: boolean;
  /** Unix-Sekunden des letzten Dump-Imports (null = nie importiert). */
  imported_at: number | null;
  /** Ein abgebrochener Import lässt sich fortsetzen (halber Download/Lesestand). */
  import_resumable: boolean;
}

export interface PuzzleImportProgress {
  imported: number;
  source: "download" | "file";
  /** Welcher Abschnitt gerade läuft. */
  phase: "download" | "import";
  /** Geladene und erwartete Bytes des Downloads (0 = unbekannt). */
  bytes: number;
  bytes_total: number;
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
  source?: "lichess" | "own";
  minRating?: number;
  maxRating?: number;
}): Promise<PuzzleOut | null> {
  return invoke<PuzzleOut | null>("next_puzzle", {
    theme: opts.theme ?? null,
    source: opts.source ?? null,
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

/** Ein Auswertungsfenster (Rating-Bucket, Wochentag 0 = Montag, Stunde). */
export interface BucketStat {
  key: number;
  attempts: number;
  solved: number;
}

export interface PuzzleDayPoint {
  day_ts: number;
  attempts: number;
  solved: number;
  rating: number;
}

/** Spiegelt puzzles::PuzzleInsights · Datenbasis des Insights-Unterreiters. */
export interface PuzzleInsights {
  personal_rating: number;
  attempts: number;
  solved: number;
  avg_puzzle_rating: number;
  avg_solved_rating: number;
  best_run: number;
  current_run: number;
  themes: ThemeStat[];
  by_rating: BucketStat[];
  by_weekday: BucketStat[];
  by_hour: BucketStat[];
  timeline: PuzzleDayPoint[];
}

export function puzzleInsights(days = 30): Promise<PuzzleInsights> {
  return invoke<PuzzleInsights>("puzzle_insights", { days });
}

/** Ein Eintrag im Puzzle-Verlauf (spiegelt puzzles::AttemptRow). */
export interface AttemptRow {
  puzzle_id: string;
  ts: number;
  solved: boolean;
  rating_before: number;
  rating_after: number;
  puzzle_rating: number;
  themes: string[];
  fen: string | null;
}

export function puzzleHistory(limit = 25): Promise<AttemptRow[]> {
  return invoke<AttemptRow[]>("puzzle_history", { limit });
}

/** Sperrfrist, nach der eine gelöste Aufgabe wieder auftauchen darf. */
export const SOLVED_COOLDOWN_DAYS = 30;

export function onPuzzleImportProgress(
  cb: (p: PuzzleImportProgress) => void
): Promise<UnlistenFn> {
  return listen<PuzzleImportProgress>("puzzles://progress", (e) => cb(e.payload));
}

export function onPuzzleImportDone(cb: (p: PuzzleImportDone) => void): Promise<UnlistenFn> {
  return listen<PuzzleImportDone>("puzzles://done", (e) => cb(e.payload));
}

/**
 * Statuszeile des Imports · er besteht aus zwei sehr unterschiedlich langen
 * Abschnitten, und ein stehendes "Download läuft" während des Einlesens sieht
 * aus, als hinge er.
 */
export function importLabel(progress: PuzzleImportProgress | null, t: TFunc): string {
  if (progress?.phase === "import") {
    return progress.imported > 0
      ? t("pz.importedN", { n: deInt(progress.imported) })
      : t("pz.importReading");
  }
  if (progress && progress.bytes > 0) {
    return t("pz.downloadingBytes", {
      done: formatBytes(progress.bytes),
      total: progress.bytes_total > 0 ? formatBytes(progress.bytes_total) : "?",
    });
  }
  return t("pz.downloading");
}

/** Deutsche Namen für die Lichess-Motive · dazu die eigenen Pseudo-Motive. */
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
  mateIn4: "Matt in 4",
  mateIn5: "Matt in 5",
  smotheredMate: "Ersticktes Matt",
  anastasiaMate: "Anastasia-Matt",
  arabianMate: "Arabisches Matt",
  bodenMate: "Bodens Matt",
  doubleBishopMate: "Läuferpaar-Matt",
  dovetailMate: "Schwalbenschwanz-Matt",
  hookMate: "Hakenmatt",
  killBoxMate: "Kill-Box-Matt",
  vukovicMate: "Vukovic-Matt",
  advancedPawn: "Vorgerückter Bauer",
  attackingF2F7: "Angriff auf f2/f7",
  capturingDefender: "Verteidiger schlagen",
  queenRookEndgame: "Damen-Turm-Endspiel",
  healthyMix: "Bunte Mischung",
  playerGames: "Spielerpartien",
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
  // Eigene Aufgaben tragen keine Lichess-Motive, sondern beschreiben, woher
  // sie kommen · sie stehen genauso im Verlauf und brauchen darum Namen.
  ownGame: "Eigene Partie",
  blunder: "Grober Fehler",
  mistake: "Fehler",
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
  mateIn4: "Mate in 4",
  mateIn5: "Mate in 5",
  smotheredMate: "Smothered mate",
  anastasiaMate: "Anastasia's mate",
  arabianMate: "Arabian mate",
  bodenMate: "Boden's mate",
  doubleBishopMate: "Double bishop mate",
  dovetailMate: "Dovetail mate",
  hookMate: "Hook mate",
  killBoxMate: "Kill box mate",
  vukovicMate: "Vukovic mate",
  advancedPawn: "Advanced pawn",
  attackingF2F7: "Attacking f2/f7",
  capturingDefender: "Capture the defender",
  queenRookEndgame: "Queen and rook endgame",
  healthyMix: "Healthy mix",
  playerGames: "Player games",
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
  ownGame: "Own game",
  blunder: "Blunder",
  mistake: "Mistake",
};

/**
 * Unbekannte Motive lesbar machen, statt "hookMate" roh anzuzeigen. Lichess
 * ergänzt den Motivkatalog gelegentlich · ein neues Motiv soll dann wenigstens
 * als Wortgruppe erscheinen, bis es hier übersetzt ist.
 */
function humanize(theme: string): string {
  const words = theme.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function themeLabel(theme: string, locale: "de" | "en" = "de"): string {
  const map = locale === "en" ? THEME_EN : THEME_DE;
  return map[theme] ?? humanize(theme);
}
