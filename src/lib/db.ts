import { invoke } from "@tauri-apps/api/core";
import { emitDataChange, onDataChange } from "./changes";

/** Spiegelt db::GameRecord aus dem Rust-Backend (snake_case wie serialisiert). */
export interface GameRecord {
  id: number | null;
  source: "chess.com" | "lichess" | "manual";
  source_id: string;
  url: string;
  played_at: string; // ISO-Datum
  played_ts: number; // Unix-Sekunden (Partie-Ende)
  time_class: string;
  color: "white" | "black";
  /** Der in dieser konkreten Partie gefuehrte eigene Spielername. */
  my_name?: string;
  opponent: string;
  opp_elo: number;
  my_elo: number;
  result: "win" | "loss" | "draw";
  opening: string;
  eco: string;
  moves_count: number;
  accuracy: number | null;
  accuracy_opening?: number | null;
  accuracy_middlegame?: number | null;
  accuracy_endgame?: number | null;
  /** Genauigkeit des Gegners, aus Plattformdaten oder der Auto-Analyse. */
  opponent_accuracy?: number | null;
  opponent_accuracy_opening?: number | null;
  opponent_accuracy_middlegame?: number | null;
  opponent_accuracy_endgame?: number | null;
  moves: string; // SAN-Züge, leerzeichengetrennt
  /** Restzeit nach jedem Halbzug in Hundertstelsekunden, leerzeichengetrennt. */
  clocks?: string;
  /** PGN-TimeControl der Partie ("600+5"); leer, wenn unbekannt. */
  time_control?: string;
  note: string;
  tags?: string[];
  analyzed: boolean;
  /** In Bibliothek behalten, aber aus Engine- und Statistik-Analysen auslassen. */
  analysis_excluded?: boolean;
}

export interface UpsertResult {
  inserted: number;
  total: number;
}

let gamesRequest: Promise<GameRecord[]> | null = null;
let statsRequest: Promise<{ total: number }> | null = null;

onDataChange(() => {
  gamesRequest = null;
  statsRequest = null;
});

export function listGames(): Promise<GameRecord[]> {
  if (!gamesRequest) {
    const request = invoke<GameRecord[]>("list_games");
    gamesRequest = request;
    void request.catch(() => {
      if (gamesRequest === request) gamesRequest = null;
    });
  }
  return gamesRequest;
}

export function upsertGames(games: GameRecord[]): Promise<UpsertResult> {
  return invoke<UpsertResult>("upsert_games", { games }).then((r) => {
    emitDataChange();
    return r;
  });
}

export function setGameNote(id: number, note: string): Promise<void> {
  return invoke<void>("set_game_note", { id, note }).then(() => emitDataChange());
}

export function setGameTags(id: number, tags: string[]): Promise<string[]> {
  return invoke<string[]>("set_game_tags", { id, tags }).then((saved) => {
    emitDataChange();
    return saved;
  });
}

export function deleteGame(id: number): Promise<boolean> {
  return invoke<boolean>("delete_game", { id }).then((deleted) => {
    if (deleted) emitDataChange();
    return deleted;
  });
}

export function readPgnFile(path: string): Promise<string> {
  return invoke<string>("read_pgn_file", { path });
}

export function writePgnFile(path: string, contents: string): Promise<number> {
  return invoke<number>("write_pgn_file", { path, contents });
}

export function dbStats(): Promise<{ total: number }> {
  if (!statsRequest) {
    const request = invoke<{ total: number }>("db_stats");
    statsRequest = request;
    void request.catch(() => {
      if (statsRequest === request) statsRequest = null;
    });
  }
  return statsRequest;
}
