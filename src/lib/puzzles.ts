import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { emitDataChange } from "./changes";
import { formatBytes } from "./settings";
import { deInt } from "./format";
import type { Locale, TFunc } from "./i18n";
import { PUZZLE_THEMES } from "./locales/themes";

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
    emitDataChange("puzzles");
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

/**
 * Unbekannte Motive lesbar machen, statt "hookMate" roh anzuzeigen. Lichess
 * ergänzt den Motivkatalog gelegentlich · ein neues Motiv soll dann wenigstens
 * als Wortgruppe erscheinen, bis es hier übersetzt ist.
 */
function humanize(theme: string): string {
  const words = theme.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function themeLabel(theme: string, locale: Locale = "en"): string {
  return PUZZLE_THEMES[locale][theme] ?? PUZZLE_THEMES.en[theme] ?? humanize(theme);
}
