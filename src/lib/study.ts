import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";

/** Spiegelt study::DayActivity. */
export interface DayActivity {
  day_ts: number; // UTC-Tagesbeginn (Unix-Sekunden)
  puzzle_attempts: number;
  puzzle_solved: number;
  endgame_attempts: number;
  rep_reviews: number;
  game_reviews: number;
}

/** Ein vollständiges Partie-Review ist eine große Einheit · es zählt zehnfach. */
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

/** Wiederholungsraster einer Serie; "" ist ein Einzeltermin. */
export type RepeatRule = "" | "daily" | "weekly" | "biweekly";

export const REPEAT_RULES: Exclude<RepeatRule, "">[] = ["daily", "weekly", "biweekly"];

/** Abstand zweier Termine in Tagen · Basis für den Enddatum-Vorschlag. */
export const REPEAT_STEP_DAYS: Record<Exclude<RepeatRule, "">, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
};

export interface StudyEvent {
  id: number;
  template_id: number;
  day: string;
  position: number;
  completed: boolean;
  completed_ts: number;
  /** "" bei einem Einzeltermin, sonst das Raster der Serie. */
  repeat_rule: RepeatRule;
  /** Gemeinsamer Schlüssel aller Termine einer Serie ("" = Einzeltermin). */
  series_key: string;
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
  return invoke<StudyTemplate>("save_study_template", { template }).then((result) => {
    emitDataChange();
    return result;
  });
}

export function deleteStudyTemplate(templateId: number): Promise<void> {
  return invoke<void>("delete_study_template", { templateId }).then(() => emitDataChange());
}

/**
 * Plant eine Einheit auf einen Tag. Mit `repeatRule` entsteht daraus eine Serie
 * echter Termine bis `until` (Standard: 12 Wochen bzw. 30 Tage täglich) ·
 * abhaken, verschieben und löschen bleiben damit Operationen auf einem Termin.
 */
export function scheduleStudyUnit(
  templateId: number,
  day: string,
  repeatRule: RepeatRule = "",
  until?: string
): Promise<number> {
  return invoke<number>("schedule_study_unit", {
    templateId,
    day,
    repeatRule: repeatRule || null,
    until: until || null,
  }).then((created) => {
    emitDataChange();
    return created;
  });
}

/** Macht aus einem geplanten Termin eine Serie bzw. ändert deren Raster. */
export function repeatStudyUnit(
  eventId: number,
  repeatRule: Exclude<RepeatRule, "">,
  until?: string
): Promise<number> {
  return invoke<number>("repeat_study_unit", {
    eventId,
    repeatRule,
    until: until || null,
  }).then((created) => {
    emitDataChange();
    return created;
  });
}

export function moveStudyUnit(eventId: number, day: string, position: number): Promise<void> {
  return invoke<void>("move_study_unit", { eventId, day, position }).then(() => emitDataChange());
}

export function completeStudyUnit(eventId: number, completed: boolean): Promise<void> {
  return invoke<void>("complete_study_unit", { eventId, completed }).then(() => emitDataChange());
}

/**
 * Löscht einen Termin · mit `scope: "series"` diesen und alle folgenden Termine
 * derselben Serie. Vergangene Termine bleiben stehen, dort steht schon, was
 * tatsächlich passiert ist.
 */
export function deleteStudyUnit(
  eventId: number,
  scope: "one" | "series" = "one"
): Promise<number> {
  return invoke<number>("delete_study_unit", { eventId, scope }).then((deleted) => {
    emitDataChange();
    return deleted;
  });
}

// ── Trainingsprogramm ───────────────────────────────────────────────────────

/** Trainingsbereiche · dieselben Schlüssel wie in `study.rs`. */
export type Area = "play" | "tactics" | "openings" | "endgames" | "analysis";

export const AREAS: Area[] = ["play", "tactics", "openings", "endgames", "analysis"];

/** Wählbare Zykluslängen in Tagen. */
export const CYCLE_DAYS = [7, 14, 28] as const;
export type CycleDays = (typeof CYCLE_DAYS)[number];

/**
 * Ein Fokus-Zyklus. Gespeichert wird nur die Absicht · Baseline und Wirkung
 * werden aus den Rohdaten neu gerechnet, damit sie nach Nachimport, neuer
 * Analyse oder Gerätesync noch stimmen.
 */
export interface StudyFocus {
  id: number;
  area: Area;
  /** Kennzahl aus `study_metrics`, an der die Wirkung gemessen wird. */
  metric_key: string;
  /** JSON mit den Parametern für die Beschriftung (Motiv, Eröffnung, …). */
  label_params: string;
  target: number | null;
  cycle_days: number;
  start_ts: number;
  /** 0, solange der Zyklus läuft. */
  end_ts: number;
  status: "active" | "done" | "dropped";
}

export interface StudyFocusInput {
  id?: number;
  area: Area;
  metric_key: string;
  label_params?: string;
  target?: number | null;
  cycle_days?: number;
}

export interface AreaLoad {
  area: Area;
  items: number;
  minutes: number;
}

export interface LoadDay {
  day_ts: number;
  play: number;
  tactics: number;
  openings: number;
  endgames: number;
  analysis: number;
}

export interface TrainingProgram {
  focuses: StudyFocus[];
  history: StudyFocus[];
  load_28d: AreaLoad[];
  days: LoadDay[];
  /** Aus den letzten acht Wochen abgeleitetes Wochenbudget in Minuten. */
  observed_weekly_minutes: number;
}

export function trainingProgram(days?: number): Promise<TrainingProgram> {
  return invoke<TrainingProgram>("training_program", { days: days ?? null });
}

export function setStudyFocus(focus: StudyFocusInput): Promise<StudyFocus> {
  return invoke<StudyFocus>("set_study_focus", { focus }).then((result) => {
    emitDataChange();
    return result;
  });
}

export function closeStudyFocus(focusId: number, status: "done" | "dropped"): Promise<void> {
  return invoke<void>("close_study_focus", { focusId, status }).then(() => emitDataChange());
}

export function deleteStudyFocus(focusId: number): Promise<void> {
  return invoke<void>("delete_study_focus", { focusId }).then(() => emitDataChange());
}

/** Minuten eines Tages über alle Bereiche. */
export function dayMinutes(day: LoadDay): number {
  return day.play + day.tactics + day.openings + day.endgames + day.analysis;
}

/** Beschriftungsparameter eines Fokus · defekte Werte werden ignoriert. */
export function focusParams(focus: StudyFocus): Record<string, string | number> {
  try {
    const parsed: unknown = JSON.parse(focus.label_params || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string | number>)
      : {};
  } catch {
    return {};
  }
}
