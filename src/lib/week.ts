/**
 * Die laufende Woche als eine Zahl.
 *
 * Das Trainingsbudget beantwortete bisher jede Frage außer der einzigen, die
 * ein Budget gut beantwortet: *wie stehe ich diese Woche?* Es verglich einen
 * Soll-Anteil pro Woche mit einem Ist-Anteil der letzten 28 Tage — zwei
 * verschiedene Zeiträume, aus denen sich nichts ableiten ließ, was heute zu tun
 * wäre.
 *
 * Hier steht deshalb die Woche selbst: was ist angefallen, was war vorgesehen,
 * was fehlt. Die Lücke je Bereich ist zugleich der Übertrag in die nächste
 * Woche · so wird aus einer Empfehlung ein Regelkreis.
 *
 * Reine Funktionen auf `TrainingProgram.days` · dieselben gemessenen Minuten,
 * die auch der Kalender zeigt.
 */
import type { AreaNeed } from "./plan";
import { AREAS, dayMinutes, type Area, type LoadDay } from "./study";

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;

/** Montag der Woche, in der `date` liegt · UTC wie alle Tagesgrenzen. */
export function weekStartOf(date: Date): Date {
  const weekday = date.getUTCDay() || 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - weekday + 1)
  );
}

export interface WeekArea {
  area: Area;
  /** Gemessene Minuten dieser Woche. */
  minutes: number;
  /** Vorgesehene Minuten aus der Allokation. */
  target: number;
  /** Empfohlener Anteil am Wochenbudget in Prozent. */
  share: number;
  /** Was noch fehlt; nie negativ · mehr als geplant ist kein Fehlbetrag. */
  gap: number;
  /** Befund-Evidenz für die Priorisierung des Wochenvorschlags. */
  evidence?: number;
}

export interface WeekBudget {
  /** Montag dieser Woche (UTC). */
  start: Date;
  minutes: number;
  target: number;
  /** Anteil des Ziels in Prozent, gedeckelt bei 100 für die Balkenbreite. */
  progress: number;
  /** Heute bereits angefallene Minuten. */
  today: number;
  byArea: WeekArea[];
  /**
   * Was am Wochenbudget noch fehlt · schlicht Ziel minus Ist.
   *
   * Bewusst *nicht* die Summe der Bereichslücken: wer im Spielen 60 Minuten
   * über dem Soll liegt und im Endspiel 20 darunter, hat sein Wochenbudget
   * erfüllt. Die Bereichslücke steht daneben in der Legende, wo sie hingehört.
   */
  open: number;
  /**
   * Summe der Bereichslücken · die Grundlage des Übertrags in die nächste
   * Woche, nicht die Zahl neben dem Balken. Sie kann größer sein als `open`,
   * weil ein Überschuss in einem Bereich einen Rückstand im anderen nicht
   * ausgleicht: eine Stunde Blitz ersetzt kein Turmendspiel.
   */
  remaining: number;
}

function inRange(day: LoadDay, from: number, to: number): boolean {
  return day.day_ts >= from && day.day_ts < to;
}

/**
 * Wochenbilanz aus den Tageslasten.
 *
 * `start` ist der Montag der gewünschten Woche, `allocation` liefert das Soll
 * je Bereich. Tage außerhalb der Woche bleiben unberücksichtigt, fehlende Tage
 * zählen als null · das ist die Aussage, nicht eine Lücke in den Daten.
 */
export function buildWeekBudget(
  days: LoadDay[],
  allocation: AreaNeed[],
  start: Date,
  now: Date
): WeekBudget {
  const from = Math.floor(start.getTime() / 1000);
  const to = from + 7 * DAY_SECONDS;
  const week = days.filter((day) => inRange(day, from, to));
  const todayStart = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
  );

  const needs = new Map(allocation.map((need) => [need.area, need]));
  const byArea: WeekArea[] = AREAS.map((area) => {
    const minutes = week.reduce((sum, day) => sum + day[area], 0);
    const need = needs.get(area);
    const target = need?.minutes ?? 0;
    return {
      area,
      minutes,
      target,
      share: need?.target ?? 0,
      gap: Math.max(0, target - minutes),
      evidence: need?.evidence ?? 0,
    };
  });

  const minutes = week.reduce((sum, day) => sum + dayMinutes(day), 0);
  const target = byArea.reduce((sum, entry) => sum + entry.target, 0);
  return {
    start,
    minutes,
    target,
    progress: target > 0 ? Math.min(100, Math.round((minutes / target) * 100)) : 0,
    today: week.filter((day) => day.day_ts === todayStart).reduce((sum, day) => sum + dayMinutes(day), 0),
    byArea,
    open: Math.max(0, target - minutes),
    remaining: byArea.reduce((sum, entry) => sum + entry.gap, 0),
  };
}

/**
 * Was die Vorwoche schuldig geblieben ist.
 *
 * Der Übertrag geht in den nächsten Wochenvorschlag: eine ausgefallene
 * Endspielwoche taucht dadurch in der folgenden wieder auf, statt spurlos zu
 * verschwinden. Gedeckelt auf das Wochensoll — wer drei Wochen nichts getan
 * hat, bekommt keine Dreifachwoche vorgesetzt, sondern eine normale.
 */
export function lastWeekDeficit(
  days: LoadDay[],
  allocation: AreaNeed[],
  start: Date,
  now: Date
): Partial<Record<Area, number>> {
  const previous = new Date(start.getTime() - 7 * DAY_MS);
  const budget = buildWeekBudget(days, allocation, previous, now);
  const out: Partial<Record<Area, number>> = {};
  for (const entry of budget.byArea) {
    // Kleinkram ist kein Rückstand · unter einer Viertelstunde lohnt der
    // Hinweis nicht und die Planung ändert sich davon ohnehin nicht.
    if (entry.gap >= 15) out[entry.area] = Math.min(entry.gap, entry.target);
  }
  return out;
}
