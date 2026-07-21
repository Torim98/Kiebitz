import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";

/** Fortschritt eines Drills aus endgame_attempts. */
export interface DrillStat {
  drill_id: string;
  attempts: number;
  solved: number;
  last_solved_ts: number | null;
}

/** Engine-Zug (UCI, z. B. "e7e5" oder "d2d1q") für die Gegenseite. */
export function endgameMove(fen: string): Promise<string> {
  return invoke<string>("endgame_move", { fen });
}

export function endgameRecord(drillId: string, solved: boolean, moves: number): Promise<void> {
  return invoke<void>("endgame_record", { drillId, solved, moves }).then(() => emitDataChange());
}

export function endgameStats(): Promise<DrillStat[]> {
  return invoke<DrillStat[]>("endgame_stats");
}
