import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ── Live-Engine (persistente Stockfish-Instanz, Streaming) ──────────────────

/** Eine gestreamte info-Zeile; eval_cp aus Sicht des Spielers am Zug. */
export interface LiveInfo {
  generation: number;
  depth: number;
  multipv: number;
  eval_cp: number | null;
  mate_in: number | null;
  nps: number | null;
  pv: string[];
}

export interface LiveDone {
  generation: number;
  bestmove: string;
}

/** Startet die Dauer-Analyse; liefert die Generation dieser Anfrage. */
export function analyzeLive(fen: string, depth = 24): Promise<number> {
  return invoke<number>("analyze_live", { fen, depth });
}

export function stopLive(): Promise<void> {
  return invoke("stop_live");
}

export function onEngineInfo(cb: (info: LiveInfo) => void): Promise<UnlistenFn> {
  return listen<LiveInfo>("engine://info", (e) => cb(e.payload));
}

export function onEngineDone(cb: (done: LiveDone) => void): Promise<UnlistenFn> {
  return listen<LiveDone>("engine://done", (e) => cb(e.payload));
}

// ── Auto-Analyse-Pipeline ────────────────────────────────────────────────────

export interface MoveEvalRow {
  ply: number;
  san: string;
  eval_cp: number | null; // nach dem Zug, aus Weiß-Sicht
  mate_in: number | null;
  best_uci: string; // Engine-Empfehlung vor dem Zug
  judgment: "" | "inaccuracy" | "mistake" | "blunder";
  phase: "opening" | "middlegame" | "endgame";
}

export interface AnalysisProgress {
  game_index: number;
  games_total: number;
  game_id: number;
  opponent: string;
  ply: number;
  plies: number;
}

export interface AnalysisGameDone {
  game_id: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
}

export interface AnalysisAllDone {
  analyzed: number;
  canceled: boolean;
  error: string | null;
}

export function startAnalysis(opts: {
  gameIds?: number[];
  depth?: number;
  limit?: number;
}): Promise<void> {
  return invoke("start_analysis", {
    gameIds: opts.gameIds ?? null,
    depth: opts.depth ?? null,
    limit: opts.limit ?? null,
  });
}

export function cancelAnalysis(): Promise<void> {
  return invoke("cancel_analysis");
}

export function analysisRunning(): Promise<boolean> {
  return invoke<boolean>("analysis_running");
}

export function gameAnalysis(gameId: number): Promise<MoveEvalRow[]> {
  return invoke<MoveEvalRow[]>("game_analysis", { gameId });
}

export function onAnalysisProgress(cb: (p: AnalysisProgress) => void): Promise<UnlistenFn> {
  return listen<AnalysisProgress>("analysis://progress", (e) => cb(e.payload));
}

export function onAnalysisGameDone(cb: (p: AnalysisGameDone) => void): Promise<UnlistenFn> {
  return listen<AnalysisGameDone>("analysis://game_done", (e) => cb(e.payload));
}

export function onAnalysisDone(cb: (p: AnalysisAllDone) => void): Promise<UnlistenFn> {
  return listen<AnalysisAllDone>("analysis://done", (e) => cb(e.payload));
}

// ── Fehler nach Spielphase ───────────────────────────────────────────────────

export interface PhaseErrors {
  phase: "opening" | "middlegame" | "endgame";
  inaccuracy: number;
  mistake: number;
  blunder: number;
}

export function errorStats(): Promise<PhaseErrors[]> {
  return invoke<PhaseErrors[]>("error_stats");
}

// ── Positionssuche ───────────────────────────────────────────────────────────

export interface NextMoveStat {
  san: string;
  games: number;
  score_pct: number;
}

export interface PositionHit {
  game_id: number;
  ply: number;
  opponent: string;
  color: "white" | "black";
  result: "win" | "loss" | "draw";
  played_at: string;
  time_class: string;
  next_san: string;
}

export interface PositionSearch {
  total_games: number;
  next_moves: NextMoveStat[];
  sample: PositionHit[];
}

export function searchPosition(fen: string): Promise<PositionSearch> {
  return invoke<PositionSearch>("search_position", { fen });
}

export function indexPositions(): Promise<number> {
  return invoke<number>("index_positions");
}
