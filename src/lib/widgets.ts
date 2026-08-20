/**
 * Datenstand für die Android-Widgets.
 *
 * Ein Widget läuft in einem eigenen Prozess, oft dann, wenn Kiebitz gar nicht
 * offen ist. Es bekommt deshalb keinen Zugriff auf die Datenbank, sondern eine
 * kleine, lokal erzeugte Momentaufnahme: der Tag, die nächsten Einheiten, die
 * Wochenbilanz. Keine Netzabfrage, keine Engine, keine Partiedaten.
 *
 * Geschrieben wird sie, wenn sich in der App etwas Relevantes geändert hat,
 * beim Tageswechsel und auf ausdrückliche Anforderung · nicht in einem Takt.
 */
import { invoke } from "@tauri-apps/api/core";
import { getSettings, type Settings } from "./settings";
import {
  AREAS,
  getStudyCalendar,
  studyData,
  templateAreas,
  trainingProgram,
  type Area,
  type LoadDay,
  type StudyCalendar,
  type StudyData,
} from "./study";
import { localDay } from "./notify";
import { onDataChange } from "./changes";
import { featureUnlocked, subscribePlus } from "./plus/store";

/**
 * Version des Dateiformats · das Widget verweigert, was es nicht kennt.
 *
 * 2 kam dazu, weil die großen Kacheln mit Version 1 nichts anzufangen wussten:
 * Ohne geplante Einheiten und ohne Wochenbudget blieb unter der Kennzahl eine
 * leere Fläche. Seither reisen auch die *Bestandteile* der offenen Aufgaben und
 * die Aufteilung der Woche nach Bereichen mit · daraus lässt sich eine Kachel
 * füllen, ohne etwas zu erfinden.
 */
export const WIDGET_SNAPSHOT_VERSION = 2;

export interface WidgetUnit {
  title: string;
  /** Geplante Minuten (0 = keine Vorgabe). */
  minutes: number;
  done: boolean;
  /**
   * Erster Lernbereich der Einheit ("" = keiner). Das Widget färbt damit den
   * Punkt vor der Zeile · dieselbe Zuordnung wie AREA_COLOR im Wochenbudget,
   * damit auf dem Startbildschirm dasselbe gilt wie in der App.
   */
  area: Area | "";
}

/**
 * Eine offene Aufgabe des Tages · ein Bestandteil von `openTasks`.
 *
 * Die Zahl allein („5 offen") füllt eine Kopfzeile, aber keine Kachel. Ihre
 * Bestandteile schon: Sie sagen, *was* offen ist, tragen die Bereichsfarbe des
 * Lernplans und führen jeweils an ihre eigene Stelle in der App.
 */
export interface WidgetTask {
  /** Welche Art Aufgabe · das Widget beschriftet und verlinkt danach. */
  kind: "units" | "repertoire" | "puzzles" | "endgame" | "analysis";
  /** Wie viele · 0 heißt „ansteht", ohne Anzahl (Endspiel). */
  count: number;
  /** Lernbereich für den Farbpunkt; "" = keiner. */
  area: Area | "";
}

/** Gemessene Minuten eines Bereichs in der laufenden Woche. */
export interface WidgetArea {
  area: Area;
  minutes: number;
}

export interface WidgetSnapshot {
  version: number;
  /** Unix-Sekunden der Erzeugung. */
  generatedAt: number;
  /** Lokaler Tag, den diese Momentaufnahme beschreibt ("YYYY-MM-DD"). */
  day: string;
  /** Sprache der Oberfläche · das Widget beschriftet sich danach. */
  locale: string;
  /** Gilt die Widget-Berechtigung? Ohne sie zeigt das Widget die Plus-Vorschau. */
  plus: boolean;
  today: {
    /** Bis zu drei Einheiten des Tages, offene zuerst. */
    units: WidgetUnit[];
    /** Offene Aufgaben insgesamt (Einheiten, Wiederholungen, Puzzles, Endspiel). */
    openTasks: number;
    /** Woraus `openTasks` besteht · größter Posten zuerst. */
    tasks: WidgetTask[];
    /** Heute gemessene Minuten. */
    doneMinutes: number;
    /** Für heute geplante Minuten. */
    plannedMinutes: number;
    /** Tage in Folge mit Training · dieselbe Zahl wie im Kopf der App. */
    streakDays: number;
  };
  week: {
    trainedMinutes: number;
    budgetMinutes: number;
    remainingMinutes: number;
    trainedDays: number;
    /** Vorgesehene Trainingstage (0 = keine Vorgabe). */
    targetDays: number;
    /**
     * Die Woche nach Bereichen · nur die gemessenen Minuten, absteigend.
     *
     * Bewusst ohne Soll je Bereich: das kommt aus dem vollen Trainingsplan
     * (Deep-Insights, Partien, Puzzle-Statistik), und der gehört nicht in einen
     * Pfad, der bei jeder Änderung läuft. Die Zusammensetzung allein sagt
     * schon, was diese Woche war · „17 Minuten, fast nur Taktik".
     */
    byArea: WidgetArea[];
  };
}

/** Montag der Woche zu einem lokalen Tag. */
function weekDays(today: Date): string[] {
  const weekday = today.getDay() || 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return localDay(day);
  });
}

function trainingDayCount(mask: number): number {
  let count = 0;
  for (let bit = 0; bit < 7; bit += 1) if (mask & (1 << bit)) count += 1;
  return count;
}

export interface SnapshotInput {
  now: Date;
  settings: Settings;
  data: StudyData;
  calendar: StudyCalendar;
  plus: boolean;
  /** Tageslasten für die Bereichsaufteilung der Woche; fehlen sie, entfällt sie. */
  load?: LoadDay[];
}

/** Sekunden-Zeitstempel des lokalen Tagesbeginns · Schlüssel der Tageslasten. */
function dayStamp(day: Date): number {
  return Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 1000);
}

/**
 * Die Woche nach Bereichen, größter Posten zuerst.
 *
 * Bereiche ohne eine einzige Minute fallen heraus: Auf einer Kachel ist eine
 * Zeile „Eröffnungen 0 min" verschenkter Platz, und im Balken wäre sie ein
 * Segment der Breite null.
 */
function weekByArea(load: LoadDay[], week: string[]): WidgetArea[] {
  const stamps = new Set(
    week.map((day) => {
      const [year, month, date] = day.split("-").map(Number);
      return dayStamp(new Date(year, month - 1, date));
    })
  );
  const days = load.filter((day) => stamps.has(day.day_ts));
  return AREAS.map((area) => ({
    area,
    minutes: days.reduce((sum, day) => sum + day[area], 0),
  }))
    .filter((entry) => entry.minutes > 0)
    .sort((left, right) => right.minutes - left.minutes);
}

/**
 * Woraus die offenen Aufgaben bestehen · dieselben Posten, die auch die
 * Erinnerung nennt, in der Reihenfolge des Lernplans.
 *
 * Die Aufschlüsselung steht *neben* `openTasks`, sie ersetzt sie nicht: Die
 * Gesamtzahl zählt das Puzzleziel als einen Posten, während hier die fehlenden
 * Aufgaben stehen, weil „7 Puzzles" auf einer Kachel mehr sagt als „Puzzles".
 * Beide Zahlen sind richtig, sie beantworten nur verschiedene Fragen.
 */
function openTaskList(input: {
  openUnits: number;
  dueReviews: number;
  puzzlesLeft: number;
  endgameDone: boolean;
}): WidgetTask[] {
  const tasks: WidgetTask[] = [];
  if (input.openUnits > 0) tasks.push({ kind: "units", count: input.openUnits, area: "" });
  if (input.dueReviews > 0)
    tasks.push({ kind: "repertoire", count: input.dueReviews, area: "openings" });
  if (input.puzzlesLeft > 0)
    tasks.push({ kind: "puzzles", count: input.puzzlesLeft, area: "tactics" });
  if (!input.endgameDone) tasks.push({ kind: "endgame", count: 0, area: "endgames" });
  return tasks;
}

/**
 * Baut die Momentaufnahme · rein und damit prüfbar.
 *
 * Offene Aufgaben zählen dasselbe, was auch die Erinnerung zählt: offene
 * Einheiten, fällige Wiederholungen, das Puzzle-Tagesziel und ein noch nicht
 * angefasstes Endspiel. Eine zweite Zählweise auf dem Startbildschirm wäre die
 * sicherste Art, beiden nicht mehr zu glauben.
 */
export function buildWidgetSnapshot(input: SnapshotInput): WidgetSnapshot {
  const { now, settings, data, calendar, plus, load } = input;
  const today = localDay(now);
  const week = weekDays(now);
  const todayEvents = calendar.events.filter((event) => event.day === today);
  const open = todayEvents.filter((event) => !event.completed && !event.auto_done);
  const units: WidgetUnit[] = [...open, ...todayEvents.filter((event) => !open.includes(event))]
    .slice(0, 3)
    .map((event) => ({
      title: event.template.title,
      minutes: event.planned_min > 0 ? event.planned_min : event.template.duration_min,
      done: event.completed || event.auto_done,
      area: templateAreas(event.template)[0] ?? "",
    }));

  const puzzlesLeft = Math.max(0, settings.puzzle_goal - data.today_puzzle_attempts);
  const endgameToday = (data.activity[data.activity.length - 1]?.endgame_attempts ?? 0) > 0;
  const openTasks = open.length + data.due_now + (puzzlesLeft > 0 ? 1 : 0) + (endgameToday ? 0 : 1);
  const tasks = openTaskList({
    openUnits: open.length,
    dueReviews: data.due_now,
    puzzlesLeft,
    endgameDone: endgameToday,
  });

  const weekDaysData = calendar.days.filter((day) => week.includes(day.day));
  const trainedMinutes = weekDaysData.reduce((sum, day) => sum + day.actual_minutes, 0);
  const todayMinutes = calendar.days.find((day) => day.day === today)?.actual_minutes ?? 0;
  const budgetMinutes = Math.max(0, settings.weekly_minutes);

  return {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: Math.floor(now.getTime() / 1000),
    day: today,
    locale: settings.locale,
    plus,
    today: {
      units,
      openTasks,
      tasks,
      doneMinutes: todayMinutes,
      plannedMinutes: todayEvents.reduce(
        (sum, event) => sum + (event.planned_min > 0 ? event.planned_min : event.template.duration_min),
        0
      ),
      streakDays: Math.max(0, data.streak_days),
    },
    week: {
      trainedMinutes,
      budgetMinutes,
      remainingMinutes: Math.max(0, budgetMinutes - trainedMinutes),
      trainedDays: weekDaysData.filter((day) => day.actual_minutes > 0).length,
      targetDays: trainingDayCount(settings.training_days),
      byArea: load ? weekByArea(load, week) : [],
    },
  };
}

/** Sammelt die Momentaufnahme aus den lokalen Daten. */
export async function collectWidgetSnapshot(now = new Date()): Promise<WidgetSnapshot> {
  const week = weekDays(now);
  const [settings, data, calendar, program] = await Promise.all([
    getSettings(),
    studyData(),
    getStudyCalendar(week[0], week[6]),
    // Nur für die Bereichsaufteilung · ohne sie bleibt der Balken einfarbig,
    // aber die Momentaufnahme entsteht trotzdem.
    trainingProgram().catch(() => null),
  ]);
  return buildWidgetSnapshot({
    now,
    settings,
    data,
    calendar,
    plus: featureUnlocked("widgets"),
    load: program?.days,
  });
}

/**
 * Schreibt die Momentaufnahme und lässt die Widgets neu zeichnen.
 *
 * Auf allen anderen Plattformen ist das ein stiller No-op: Desktop-Widgets sind
 * ausdrücklich nicht geplant.
 */
export async function publishWidgetSnapshot(now = new Date()): Promise<void> {
  const snapshot = await collectWidgetSnapshot(now);
  await invoke("widget_snapshot_write", { json: JSON.stringify(snapshot) });
}

/** Millisekunden bis zur nächsten lokalen Mitternacht (mindestens eine Minute). */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(60_000, next.getTime() - now.getTime());
}

/**
 * Hält die Momentaufnahme aktuell.
 *
 * Drei Anlässe, mehr nicht: eine relevante Änderung in der App, der
 * Tageswechsel und ein veränderter Plus-Status. Kein Takt, keine Abfrage im
 * Hintergrund · ein Widget, das alle fünf Minuten die Datenbank aufweckt,
 * kostet Akku und zeigt trotzdem nichts Neues.
 */
export function startWidgetSnapshots(): () => void {
  let disposed = false;
  let dayTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlus: boolean | null = null;

  const publish = () => {
    if (disposed) return;
    void publishWidgetSnapshot().catch(() => {});
  };

  const scheduleDayChange = () => {
    if (disposed) return;
    dayTimer = setTimeout(() => {
      publish();
      scheduleDayChange();
    }, msUntilNextDay(new Date()));
  };

  publish();
  scheduleDayChange();

  const stopChanges = onDataChange(publish, ["study", "puzzles", "repertoire", "analysis", "games"]);
  const stopPlus = subscribePlus((state) => {
    const entitled = state.claims?.plan === "plus";
    if (lastPlus !== null && lastPlus !== entitled) publish();
    lastPlus = entitled;
  });

  return () => {
    disposed = true;
    if (dayTimer) clearTimeout(dayTimer);
    stopChanges();
    stopPlus();
  };
}
