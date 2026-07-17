import { invoke } from "@tauri-apps/api/core";

/** Spiegelt study::DayActivity. */
export interface DayActivity {
  day_ts: number; // UTC-Tagesbeginn (Unix-Sekunden)
  puzzle_attempts: number;
  endgame_attempts: number;
  rep_reviews: number;
}

/** Spiegelt study::StudyData. */
export interface StudyData {
  due_now: number;
  /** Index 0 = heute (inkl. überfälliger), 1..6 = kommende Tage. */
  due_week: number[];
  unanalyzed: number;
  today_puzzle_attempts: number;
  puzzle_goal: number;
  /** Letzte 7 Tage aufsteigend (Index 6 = heute). */
  activity: DayActivity[];
  streak_days: number;
}

export function studyData(): Promise<StudyData> {
  return invoke<StudyData>("study_data");
}

/** Lerneinheiten eines Tages (Puzzles + Endspiele + Wiederholungen). */
export function dayUnits(d: DayActivity): number {
  return d.puzzle_attempts + d.endgame_attempts + d.rep_reviews;
}
