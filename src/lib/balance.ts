/**
 * Trainingsbilanz: Aufwand gegen Wirkung über die Zeit.
 *
 * Die Frage „bringt mein Training etwas" lässt sich über einen langen Zeitraum
 * nur schwach beantworten — dafür gibt es den Fokus-Zyklus mit festem
 * Vorher-Nachher. Was hier entsteht, ist das schwächere, aber breitere Bild:
 * wie viel Zeit wohin ging, und wie sich die Leitkennzahl daneben entwickelt
 * hat.
 *
 * Der Lag-Vergleich ist die Verallgemeinerung von `sessions.warmup`, das
 * dasselbe schon für einen einzelnen Tag macht: Wochen mit viel Training gegen
 * Wochen mit wenig, gemessen an der *folgenden* Woche. Das ist ein
 * Zusammenhang und keine Ursache · genau so ist er auch beschriftet.
 */
import type { MetricWindow } from "./insights";
import type { LoadDay } from "./study";
import { dayMinutes } from "./study";

const WEEK = 7 * 86_400;

export interface WeekLoad {
  /** Unix-Sekunden des Wochenbeginns (Montag, UTC). */
  from_ts: number;
  to_ts: number;
  play: number;
  tactics: number;
  openings: number;
  endgames: number;
  analysis: number;
  total: number;
}

/** Montag der Woche, in die `ts` fällt (UTC). */
export function weekStart(ts: number): number {
  const date = new Date(ts * 1000);
  const weekday = (date.getUTCDay() + 6) % 7;
  return (
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - weekday) / 1000
  );
}

/** Tageslast zu Wochen zusammenfassen · Wochen ohne Aktivität bleiben leer. */
export function weeklyLoad(days: LoadDay[], weeks = 16): WeekLoad[] {
  const buckets = new Map<number, WeekLoad>();
  for (const day of days) {
    const from = weekStart(day.day_ts);
    const entry = buckets.get(from) ?? {
      from_ts: from,
      to_ts: from + WEEK,
      play: 0,
      tactics: 0,
      openings: 0,
      endgames: 0,
      analysis: 0,
      total: 0,
    };
    entry.play += day.play;
    entry.tactics += day.tactics;
    entry.openings += day.openings;
    entry.endgames += day.endgames;
    entry.analysis += day.analysis;
    entry.total += dayMinutes(day);
    buckets.set(from, entry);
  }
  return [...buckets.values()]
    .sort((a, b) => a.from_ts - b.from_ts)
    .slice(-weeks);
}

export interface LagComparison {
  /** Leitkennzahl in Wochen *nach* viel Training. */
  high: number;
  low: number;
  highWeeks: number;
  lowWeeks: number;
  /** Trennlinie (Minuten pro Woche), an der geteilt wurde. */
  threshold: number;
  metricKey: string;
  lowerIsBetter: boolean;
}

/**
 * Vergleicht die Leitkennzahl der Folgewoche zwischen trainingsstarken und
 * trainingsschwachen Wochen.
 *
 * `windows` muss dieselbe Reihenfolge und Länge haben wie `weeks` · jeder
 * Eintrag ist das Messfenster genau dieser Woche.
 */
export function lagComparison(
  weeks: WeekLoad[],
  windows: MetricWindow[],
  metricKey: string,
  minWeeks = 8
): LagComparison | null {
  if (weeks.length < minWeeks || windows.length !== weeks.length) return null;

  // Median als Trennlinie · ein fester Minutenwert würde bei einem fleißigen
  // und einem gelegentlichen Spieler völlig Verschiedenes bedeuten.
  const totals = weeks.map((week) => week.total).sort((a, b) => a - b);
  const threshold = totals[Math.floor(totals.length / 2)];
  if (threshold <= 0) return null;

  const high: number[] = [];
  const low: number[] = [];
  let lowerIsBetter = false;
  // Die *nächste* Woche zählt · deshalb endet die Schleife eins früher.
  for (let index = 0; index < weeks.length - 1; index++) {
    const metric = windows[index + 1].metrics.find((entry) => entry.key === metricKey);
    if (!metric || metric.value == null || metric.n === 0) continue;
    lowerIsBetter = metric.lower_is_better;
    (weeks[index].total >= threshold ? high : low).push(metric.value);
  }
  if (high.length < 3 || low.length < 3) return null;

  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    high: Math.round(mean(high) * 10) / 10,
    low: Math.round(mean(low) * 10) / 10,
    highWeeks: high.length,
    lowWeeks: low.length,
    threshold,
    metricKey,
    lowerIsBetter,
  };
}
