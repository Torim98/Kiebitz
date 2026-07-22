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

export interface StudyCalendar {
  templates: StudyTemplate[];
  events: StudyEvent[];
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
