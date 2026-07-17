import { invoke } from "@tauri-apps/api/core";

/** Spiegelt settings::Settings aus dem Rust-Backend. */
export interface Settings {
  locale: "de" | "en";
  db_path: string | null;
  engine_path: string | null;
  engine_threads: number; // 0 = automatisch
  engine_hash_mb: number;
  engine_multipv: number;
  live_depth: number;
  batch_depth: number;
  syzygy_path: string | null;
  chessdb_enabled: boolean;
  cc_user: string;
  li_user: string;
  /** Anzeigename fürs Dashboard (leer = Benutzername). */
  display_name: string;
  import_months: number;
  puzzle_goal: number;
  auto_update: boolean;
}

export interface EngineTest {
  ok: boolean;
  name: string;
  path: string;
}

export interface DbInfo {
  path: string;
  size_bytes: number;
  games: number;
  puzzles: number;
  is_default: boolean;
}

export interface ChessDbMove {
  uci: string;
  san: string;
  score: number | null; // Centipawns aus Sicht des Spielers am Zug
  rank: number | null;
  winrate: string | null;
}

export interface ChessDbResult {
  status: string; // "ok" | "unknown" | …
  moves: ChessDbMove[];
  cached: boolean;
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(newSettings: Settings): Promise<Settings> {
  return invoke<Settings>("set_settings", { newSettings });
}

export function testEngine(path?: string): Promise<EngineTest> {
  return invoke<EngineTest>("test_engine", { path: path ?? null });
}

export function dbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>("db_info");
}

export function moveDatabase(target: string): Promise<DbInfo> {
  return invoke<DbInfo>("move_database", { target });
}

export function useDatabase(path: string): Promise<DbInfo> {
  return invoke<DbInfo>("use_database", { path });
}

export function chessdbQuery(fen: string): Promise<ChessDbResult> {
  return invoke<ChessDbResult>("chessdb_query", { fen });
}

/** Bytes menschenlesbar (1 Dezimalstelle ab MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
