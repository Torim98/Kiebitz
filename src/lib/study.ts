import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";
import type { Key, TFunc } from "./i18n";

/** Spiegelt study::DayActivity. */
export interface DayActivity {
  day_ts: number; // UTC-Tagesbeginn (Unix-Sekunden)
  puzzle_attempts: number;
  puzzle_solved: number;
  endgame_attempts: number;
  rep_reviews: number;
  game_reviews: number;
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

export interface StudyTemplate {
  id: number;
  title: string;
  /**
   * Dauer aus der Zeit vor der Messung · nur noch Rückfall für Altbestand.
   * Geplant wird über `StudyEvent.planned_min`, und die Zahl kommt aus dem
   * Wochenbudget statt aus einem Eingabefeld.
   */
  duration_min: number;
  tool: string;
  description: string;
  /** Erster Trainingsbereich; "" = keiner zugeordnet. */
  area: Area | "";
  /** Alle Bereiche der Einheit · eine eigene darf mehrere nennen. */
  areas: Area[];
  /** Bereichsschlüssel der fünf Standardeinheiten, sonst "". */
  builtin: Area | "";
  /**
   * Basis der Übersetzungsschlüssel einer unbearbeiteten Standardeinheit
   * ("st.seed.tactics"). Leer, sobald der Nutzer den Text angefasst hat · ab
   * dann gehört er ihm und wird nicht mehr übersetzt.
   */
  i18n_key: string;
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
  /**
   * Von selbst erfüllt: an diesem Tag wurde im Bereich der Einheit mindestens
   * ihre Dauer gemessen. Ersetzt kein Abhaken, sondern erübrigt es.
   */
  auto_done: boolean;
  /** "" bei einem Einzeltermin, sonst das Raster der Serie. */
  repeat_rule: RepeatRule;
  /** Gemeinsamer Schlüssel aller Termine einer Serie ("" = Einzeltermin). */
  series_key: string;
  /** Geplante Minuten dieses Termins (0 = keine Vorgabe). */
  planned_min: number;
  /** "plan" bei Terminen aus dem Wochenvorschlag, sonst "". */
  source: "plan" | "";
  template: StudyTemplate;
}

/** Geplante Minuten eines Termins · Rückfall auf die alte Vorlagendauer. */
export function eventMinutes(event: StudyEvent): number {
  return event.planned_min > 0 ? event.planned_min : event.template.duration_min;
}

/** Bereiche einer Einheit · der einzelne Bereich ist der Rückfall. */
export function templateAreas(template: StudyTemplate): Area[] {
  if (template.areas.length > 0) return template.areas;
  return template.area ? [template.area] : [];
}

/** Tageskennzahlen des Wochenkalenders (spiegelt study::StudyDay). */
export interface StudyDay {
  day: string;
  puzzle_attempts: number;
  puzzle_solved: number;
  endgame_attempts: number;
  rep_reviews: number;
  game_reviews: number;
  /** Ist-Minuten nach derselben Regel wie das Trainingsbudget. */
  actual_minutes: number;
  /** Fällige Repertoire-Wiederholungen an diesem Tag. */
  due_reviews: number;
}

export interface StudyCalendar {
  templates: StudyTemplate[];
  events: StudyEvent[];
  days: StudyDay[];
}

/**
 * Was der Editor schickt: Text und Bereiche.
 *
 * Keine Dauer mehr · Kiebitz misst die Zeit, und wie lang eine Sitzung wird,
 * entscheidet das Wochenbudget beim Einplanen. Der Übersetzungsschlüssel wird
 * nie geschrieben, den räumt das Backend selbst weg.
 */
export interface StudyTemplateInput {
  id?: number;
  title: string;
  tool: string;
  description: string;
  areas: Area[];
}

/**
 * Angezeigter Text einer Lerneinheit.
 *
 * Die vier Startvorlagen liegen englisch in der Datenbank, weil sie echte,
 * bearbeitbare Nutzerdaten sind · angezeigt werden sie trotzdem in der Sprache
 * der Oberfläche, solange sie unverändert sind. Ab der ersten Bearbeitung
 * entfällt `i18n_key`, und der eigene Text steht da, wo er hingehört.
 */
export function templateText(
  template: StudyTemplate,
  field: "title" | "tool" | "desc",
  t: TFunc
): string {
  const own = field === "title" ? template.title : field === "tool" ? template.tool : template.description;
  if (!template.i18n_key) return own;
  // Der Schlüssel wird zur Laufzeit zusammengesetzt · die Prüfung darunter
  // fängt ab, wenn er im Wörterbuch fehlt.
  const translated = t(`${template.i18n_key}.${field}` as Key);
  // Fehlt der Schlüssel (etwa nach einem Sync von einer neueren Version),
  // bleibt der gespeicherte englische Text stehen statt eines rohen Schlüssels.
  return translated.startsWith(template.i18n_key) ? own : translated;
}

export function getStudyCalendar(startDay: string, endDay: string): Promise<StudyCalendar> {
  return invoke<StudyCalendar>("study_calendar", { startDay, endDay });
}

export function saveStudyTemplate(template: StudyTemplateInput): Promise<StudyTemplate> {
  return invoke<StudyTemplate>("save_study_template", { template }).then((result) => {
    emitDataChange("study");
    return result;
  });
}

export function deleteStudyTemplate(templateId: number): Promise<void> {
  return invoke<void>("delete_study_template", { templateId }).then(() => emitDataChange("study"));
}

/**
 * Plant eine Einheit auf einen Tag. Mit `repeatRule` entsteht daraus eine Serie
 * echter Termine bis `until` (Standard: 12 Wochen bzw. 30 Tage täglich) ·
 * abhaken, verschieben und löschen bleiben damit Operationen auf einem Termin.
 *
 * `plannedMin` kommt aus dem Wochenbudget (`sessionMinutes` in `plan.ts`) und
 * nicht aus einer Eingabe · 0 lässt die Länge offen.
 */
export function scheduleStudyUnit(
  templateId: number,
  day: string,
  repeatRule: RepeatRule = "",
  until?: string,
  plannedMin = 0
): Promise<number> {
  return invoke<number>("schedule_study_unit", {
    templateId,
    day,
    repeatRule: repeatRule || null,
    until: until || null,
    plannedMin,
  }).then((created) => {
    emitDataChange("study");
    return created;
  });
}

/**
 * Übernimmt einen Wochenvorschlag für `from` bis `to`.
 *
 * Ersetzt die noch offenen Einheiten *aus früheren Vorschlägen* in diesem
 * Zeitraum; von Hand geplante und bereits erledigte bleiben stehen. Damit lässt
 * sich der Vorschlag jederzeit neu ziehen, ohne die Woche zu verdoppeln.
 */
export function applyWeekPlan(
  fromDay: string,
  toDay: string,
  units: { template_id: number; day: string; planned_min: number }[]
): Promise<number> {
  return invoke<number>("apply_week_plan", { fromDay, toDay, units }).then((created) => {
    emitDataChange("study");
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
    emitDataChange("study");
    return created;
  });
}

export function moveStudyUnit(eventId: number, day: string, position: number): Promise<void> {
  return invoke<void>("move_study_unit", { eventId, day, position }).then(() => emitDataChange("study"));
}

export function completeStudyUnit(eventId: number, completed: boolean): Promise<void> {
  return invoke<void>("complete_study_unit", { eventId, completed }).then(() => emitDataChange("study"));
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
    emitDataChange("study");
    return deleted;
  });
}

// ── Trainingsprogramm ───────────────────────────────────────────────────────

/** Trainingsbereiche · dieselben Schlüssel wie in `study.rs`. */
export type Area = "play" | "tactics" | "openings" | "endgames" | "analysis";

export const AREAS: Area[] = ["play", "tactics", "openings", "endgames", "analysis"];

/**
 * Name eines Bereichs in der Oberfläche. Steht hier und nicht in den
 * Komponenten, weil vier von ihnen dieselbe Tabelle brauchen · vorher stand sie
 * viermal da, und eine sechste Farbe wäre viermal nachzutragen gewesen.
 */
export const AREA_KEY: Record<Area, Key> = {
  play: "plan.areaPlay",
  tactics: "plan.areaTactics",
  openings: "plan.areaOpenings",
  endgames: "plan.areaEndgames",
  analysis: "plan.areaAnalysis",
};

/** Feste Farbe je Bereich · Wochenleiste, Tagessitzung und Kalender teilen sie. */
export const AREA_COLOR: Record<Area, string> = {
  play: "var(--color-accent)",
  tactics: "var(--color-blue)",
  openings: "var(--color-violet)",
  endgames: "var(--color-gold)",
  analysis: "var(--color-cc)",
};

/**
 * Gedämpfte Fassung derselben Farbe · Hintergrund hinter einem Bereichssymbol.
 *
 * Bewusst feste rgba-Werte und kein `color-mix`: die Android-WebView älterer
 * Geräte kennt die Funktion nicht und ließe die Fläche dann ganz weg.
 */
export const AREA_SOFT: Record<Area, string> = {
  play: "rgba(34, 192, 138, 0.14)",
  tactics: "rgba(57, 135, 229, 0.14)",
  openings: "rgba(144, 133, 233, 0.14)",
  endgames: "rgba(217, 160, 40, 0.14)",
  analysis: "rgba(129, 182, 76, 0.14)",
};

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
  load_28d: AreaLoad[];
  days: LoadDay[];
  /** Aus den letzten acht Wochen abgeleitetes Wochenbudget in Minuten. */
  observed_weekly_minutes: number;
}

export function trainingProgram(days?: number): Promise<TrainingProgram> {
  return invoke<TrainingProgram>("training_program", { days: days ?? null });
}

/** Minuten eines Tages über alle Bereiche. */
export function dayMinutes(day: LoadDay): number {
  return day.play + day.tactics + day.openings + day.endgames + day.analysis;
}
