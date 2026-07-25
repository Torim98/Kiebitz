import { invoke } from "@tauri-apps/api/core";

/** Spiegelt study::DayActivity. */
export interface DayActivity {
  day_ts: number; // UTC-Tagesbeginn (Unix-Sekunden)
  puzzle_attempts: number;
  puzzle_solved: number;
  endgame_attempts: number;
  rep_reviews: number;
  game_reviews: number;
}

/** Ein vollständiges Partie-Review ist eine große Einheit — es zählt zehnfach. */
export const GAME_REVIEW_UNITS = 10;

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

/**
 * Lerneinheiten eines Tages: gelöste Puzzles, Endspiel-Drills und
 * Repertoire-Wiederholungen zählen einfach, ein vollständiges Partie-Review
 * zehnfach. Der Wochenkalender bekommt denselben Wert fertig gerechnet aus
 * `study_calendar`; hier steht die Regel für Tagesauswertungen.
 */
export function dayUnits(d: DayActivity): number {
  return (
    d.puzzle_solved + d.endgame_attempts + d.rep_reviews + d.game_reviews * GAME_REVIEW_UNITS
  );
}

export interface StudyTemplate {
  id: number;
  title: string;
  duration_min: number;
  tool: string;
  description: string;
}

export interface StudyEvent {
  id: number;
  template_id: number;
  day: string;
  position: number;
  completed: boolean;
  completed_ts: number;
  template: StudyTemplate;
}

/** Tageskennzahlen des Wochenkalenders (spiegelt study::StudyDay). */
export interface StudyDay {
  day: string;
  puzzle_solved: number;
  endgame_attempts: number;
  rep_reviews: number;
  game_reviews: number;
  /** Erledigte Einheiten; Partie-Reviews zählen zehnfach. */
  units: number;
  /** Fällige Repertoire-Wiederholungen an diesem Tag. */
  due_reviews: number;
}

export interface StudyCalendar {
  templates: StudyTemplate[];
  events: StudyEvent[];
  days: StudyDay[];
}

export type StudyTemplateInput = Omit<StudyTemplate, "id"> & { id?: number };

export function getStudyCalendar(startDay: string, endDay: string): Promise<StudyCalendar> {
  return invoke<StudyCalendar>("study_calendar", { startDay, endDay });
}

export function saveStudyTemplate(template: StudyTemplateInput): Promise<StudyTemplate> {
  return invoke<StudyTemplate>("save_study_template", { template });
}

export function deleteStudyTemplate(templateId: number): Promise<void> {
  return invoke("delete_study_template", { templateId });
}

export function scheduleStudyUnit(templateId: number, day: string): Promise<void> {
  return invoke("schedule_study_unit", { templateId, day });
}

export function moveStudyUnit(eventId: number, day: string, position: number): Promise<void> {
  return invoke("move_study_unit", { eventId, day, position });
}

export function completeStudyUnit(eventId: number, completed: boolean): Promise<void> {
  return invoke("complete_study_unit", { eventId, completed });
}

export function deleteStudyUnit(eventId: number): Promise<void> {
  return invoke("delete_study_unit", { eventId });
}
