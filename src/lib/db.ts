import { invoke } from "@tauri-apps/api/core";

/** Spiegelt db::GameRecord aus dem Rust-Backend (snake_case wie serialisiert). */
export interface GameRecord {
  id: number | null;
  source: "chess.com" | "lichess";
  source_id: string;
  url: string;
  played_at: string; // ISO-Datum
  time_class: string;
  color: "white" | "black";
  opponent: string;
  opp_elo: number;
  my_elo: number;
  result: "win" | "loss" | "draw";
  opening: string;
  eco: string;
  moves_count: number;
  accuracy: number | null;
  moves: string; // SAN-Züge, leerzeichengetrennt
  note: string;
  analyzed: boolean;
}

export interface UpsertResult {
  inserted: number;
  total: number;
}

export function listGames(): Promise<GameRecord[]> {
  return invoke<GameRecord[]>("list_games");
}

export function upsertGames(games: GameRecord[]): Promise<UpsertResult> {
  return invoke<UpsertResult>("upsert_games", { games });
}

export function setGameNote(id: number, note: string): Promise<void> {
  return invoke("set_game_note", { id, note });
}
