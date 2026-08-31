/**
 * Der Wochenbericht: was sich verändert hat, was das Training gebracht hat,
 * was jetzt dran ist.
 *
 * Alles andere im Study-Reiter beantwortet die Frage „was mache ich heute". Der
 * Bericht beantwortet die einzige, die man nur einmal pro Woche stellen kann:
 * *hat es etwas gebracht?* Er vergleicht dafür zwei abgeschlossene Wochen —
 * dieselben Kennzahlen, derselbe Zuschnitt — und stellt die gemessene
 * Trainingszeit daneben.
 *
 * Drei Entscheidungen prägen ihn:
 *
 * 1. **Rauschen zuerst.** Wochenzahlen schwanken heftig; zwanzig Partien
 *    ergeben eine Punktausbeute mit einer Streuung, neben der jede
 *    Wochenveränderung klein ist. Jede Kennzahl bekommt deshalb eine
 *    Rauschgrenze aus ihrer eigenen Stichprobe, und was darunter bleibt, wird
 *    als Rauschen ausgewiesen statt als Fortschritt verkauft. Ein Bericht, der
 *    jede Woche einen Erfolg meldet, ist nach vier Wochen wertlos.
 * 2. **Zusammenhang, keine Ursache.** Trainingszeit und Kennzahl stehen
 *    nebeneinander, weil beide gemessen sind — nicht, weil die eine die andere
 *    erklärt. Dieselbe Zurückhaltung wie im Lag-Vergleich (`balance.ts`).
 * 3. **Er endet mit einer Handlung.** Ein Rückblick ohne „und jetzt?" ist eine
 *    Statistik. Der Bericht schließt deshalb mit der obersten Verordnung des
 *    Coaches für die begonnene Woche.
 *
 * Reine Funktionen ohne Backend-Zugriff · die Fenster kommen aus
 * `study_metrics`, die Tageslasten aus `training_program`.
 */
import type { Key, TFunc } from "./i18n";
import { de, deInt } from "./format";
import type { MetricUnit, MetricValue, MetricWindow } from "./insights";
import { measureRating, ratingNoise, type RatingEffect } from "./effect";
import type { AreaNeed, Prescription } from "./plan";
import { AREAS, dayMinutes, type Area, type LoadDay } from "./study";
import { weekStartOf } from "./week";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const WEEK_SECONDS = 7 * 86_400;

// ── Der berichtete Zeitraum ─────────────────────────────────────────────────

export interface ReportWeek {
  /** Montag 00:00 UTC der berichteten Woche (Unix-Sekunden). */
  start: number;
  /** Montag der Folgewoche · das Fenster ist halboffen [start, end). */
  end: number;
}

/**
 * Die Woche, über die berichtet wird: die zuletzt *abgeschlossene*.
 *
 * Bewusst nicht die laufende. Ein Rückblick auf eine Woche, die noch drei Tage
 * vor sich hat, vergleicht einen halben Zeitraum mit einem ganzen und meldet
 * verlässlich einen Einbruch. Der Bericht steht deshalb ab Montag und redet
 * über Montag bis Sonntag davor.
 */
export function reportWeek(now: Date): ReportWeek {
  const start = weekStartOf(now).getTime() - WEEK_MS;
  return { start: Math.floor(start / 1000), end: Math.floor(start / 1000) + WEEK_SECONDS };
}

/** Die Woche davor · die Vergleichsbasis desselben Berichts. */
export function previousWeek(week: ReportWeek): ReportWeek {
  return { start: week.start - WEEK_SECONDS, end: week.start };
}

// ── Veränderungen ───────────────────────────────────────────────────────────

/**
 * Kennzahlen, die im Bericht auftauchen dürfen · in dieser Reihenfolge bei
 * Gleichstand.
 *
 * Nicht alle fünfzehn: Der Bericht soll in zehn Sekunden lesbar sein, und
 * „Genauigkeit Mittelspiel" neben „Genauigkeit" beantwortet dieselbe Frage
 * zweimal. Die Phasenkennzahlen kommen nur über ihren Bereich herein (siehe
 * `AREA_METRIC`), wo sie etwas erklären.
 */
const REPORT_METRICS: readonly string[] = [
  "blunders_per100",
  "acc_overall",
  "score_pct",
  "errors_per100",
  "puzzle_solve_pct",
  "in_book_pct",
  "trouble_pct",
  "avg_loss",
];

/**
 * Die Kennzahl, an der ein Trainingsbereich sichtbar wird.
 *
 * Sie ist die ehrlichste verfügbare Nachbarschaft, nicht ein Beweis: Wer eine
 * Woche lang Endspiele geübt hat, sollte es am ehesten an der Genauigkeit im
 * Endspiel sehen — sehen *muss* er es dort nicht.
 */
const AREA_METRIC: Record<Area, string> = {
  play: "score_pct",
  tactics: "blunders_per100",
  openings: "in_book_pct",
  endgames: "acc_endgame",
  analysis: "errors_per100",
};

/** Vielfaches der Rauschgrenze, ab dem eine Veränderung eine Aussage ist. */
const NOISE_FACTOR = 1.6;

/** Unter so vielen Minuten ist ein Bereich keine Trainingswoche, sondern ein Klick. */
const AREA_MIN_MINUTES = 10;

/** So viele Veränderungen stehen höchstens im Bericht. */
const MAX_CHANGES = 3;

export interface WeeklyChange {
  /** Schlüssel der Kennzahl · übersetzt über `metric.<key>`. */
  key: string;
  /** Wert der Vorwoche. */
  from: number;
  /** Wert der berichteten Woche. */
  to: number;
  delta: number;
  unit: MetricUnit;
  lowerIsBetter: boolean;
  /** Stichprobe der berichteten Woche (Partien, Züge oder Versuche). */
  n: number;
  /** Rauschgrenze beider Fenster zusammen · |delta| darunter sagt nichts. */
  noise: number;
  /** Liegt die Veränderung über der Rauschgrenze? */
  moved: boolean;
  /** Ging es in die gewünschte Richtung? Nur bei `moved` eine Aussage. */
  better: boolean;
}

/**
 * Rauschgrenze einer einzelnen Messung · ein Standardfehler.
 *
 * Wo das Backend eine Streuung mitschickt (Punktausbeute, Genauigkeit,
 * Zugverlust, Puzzle-Schwierigkeit), ist sie die Grundlage. Für Raten ohne
 * Streuung wird sie aus dem Verteilungsmodell gerechnet: Ereignisse je 100
 * Züge sind Zähldaten (Poisson), Prozentsätze sind Anteile (Binomial). Ohne
 * dieses Modell hätte genau die Hälfte der Kennzahlen keine Grenze — und ohne
 * Grenze ist jede Zahl ein Fortschritt.
 */
export function metricNoise(metric: MetricValue): number | null {
  if (metric.value == null || metric.n <= 0) return null;
  if (metric.sd != null && metric.n >= 2) return metric.sd / Math.sqrt(metric.n);
  if (metric.unit === "per100") {
    // Zählt Ereignisse über `n` Züge · die Unsicherheit von null Ereignissen
    // ist nicht null, deshalb der Boden bei einem.
    return Math.sqrt((Math.max(metric.value, 1) * 100) / metric.n);
  }
  if (metric.unit === "pct") {
    // Anteil aus `n` Versuchen · an den Rändern (0 %, 100 %) würde die reine
    // Formel eine Grenze von null liefern, deshalb der Klemmbereich.
    const share = Math.min(Math.max(metric.value / 100, 0.02), 0.98);
    return Math.sqrt((share * (1 - share)) / metric.n) * 100;
  }
  return null;
}

function find(window: MetricWindow, key: string): MetricValue | undefined {
  return window.metrics.find((entry) => entry.key === key);
}

/** Eine Kennzahl über zwei Fenster · `null`, wenn sie sich nicht vergleichen lässt. */
export function compareMetric(
  previous: MetricWindow,
  current: MetricWindow,
  key: string
): WeeklyChange | null {
  const before = find(previous, key);
  const after = find(current, key);
  if (!before || !after) return null;
  if (before.value == null || after.value == null) return null;
  const noiseBefore = metricNoise(before);
  const noiseAfter = metricNoise(after);
  if (noiseBefore == null || noiseAfter == null) return null;

  // Zwei unabhängige Messungen · ihre Unsicherheiten addieren sich quadratisch.
  const noise = Math.sqrt(noiseBefore ** 2 + noiseAfter ** 2) * NOISE_FACTOR;
  const delta = after.value - before.value;
  const moved = Math.abs(delta) > noise;
  return {
    key,
    from: before.value,
    to: after.value,
    delta: Math.round(delta * 10) / 10,
    unit: after.unit,
    lowerIsBetter: after.lower_is_better,
    n: after.n,
    noise: Math.round(noise * 10) / 10,
    moved,
    better: after.lower_is_better ? delta < 0 : delta > 0,
  };
}

/** Wie deutlich eine Veränderung ist · Vielfaches ihrer eigenen Rauschgrenze. */
function strength(change: WeeklyChange): number {
  return change.noise > 0 ? Math.abs(change.delta) / change.noise : 0;
}

// ── Trainingszeit ───────────────────────────────────────────────────────────

export interface WeeklyArea {
  area: Area;
  /** Gemessene Minuten der berichteten Woche. */
  minutes: number;
  /** Dieselbe Zahl der Vorwoche. */
  previous: number;
  /** Vorgesehene Minuten aus der Allokation (0 = kein Plan vorhanden). */
  target: number;
  /**
   * Die Kennzahl, an der dieser Bereich sichtbar würde · `null`, wenn sie sich
   * in diesen zwei Wochen nicht vergleichen lässt.
   */
  change: WeeklyChange | null;
}

function minutesIn(days: LoadDay[], week: ReportWeek): { total: number; byArea: Record<Area, number> } {
  const byArea = { play: 0, tactics: 0, openings: 0, endgames: 0, analysis: 0 };
  let total = 0;
  for (const day of days) {
    if (day.day_ts < week.start || day.day_ts >= week.end) continue;
    for (const area of AREAS) byArea[area] += day[area];
    total += dayMinutes(day);
  }
  return { total, byArea };
}

// ── Der Bericht ─────────────────────────────────────────────────────────────

export interface WeeklyInput {
  week: ReportWeek;
  /** Kennzahlen der berichteten Woche. */
  metrics: MetricWindow;
  /** Dieselben Kennzahlen der Vorwoche. */
  previous: MetricWindow;
  /** Gemessene Tageslasten · dieselbe Quelle wie die Wochenleiste. */
  days: LoadDay[];
  /** Soll-Verteilung aus dem Plan · leer, wenn keiner vorliegt. */
  allocation?: AreaNeed[];
  /** Verordnungen des Coaches · die erste beschließt den Bericht. */
  prescriptions?: Prescription[];
}

export interface WeeklyReport {
  week: ReportWeek;
  /** Partien der berichteten Woche und der Vorwoche. */
  games: number;
  previousGames: number;
  /** Gemessene Minuten beider Wochen. */
  minutes: number;
  previousMinutes: number;
  /** Wochenziel aus der Allokation (0 = keins). */
  target: number;
  /** Tage der Woche, an denen überhaupt etwas gemessen wurde. */
  activeDays: number;
  byArea: WeeklyArea[];
  /** Was sich bewegt hat · höchstens drei, die deutlichste zuerst. */
  changes: WeeklyChange[];
  /**
   * Die größte Bewegung, wenn keine über ihre Rauschgrenze kam · sie steht
   * dann als das da, was sie ist: noch keine Aussage.
   */
  quiet: WeeklyChange | null;
  /** Ratingveränderung derselben Woche. */
  rating: RatingEffect | null;
  /** Woran als Nächstes zu arbeiten ist. */
  next: Prescription | null;
}

/**
 * Der Bericht einer Woche · `null`, wenn in ihr nichts passiert ist.
 *
 * Eine leere Woche bekommt bewusst keinen Bericht. „Du hast nichts getan" ist
 * keine Erkenntnis, sondern ein Vorwurf, und wer eine Woche aussetzt, braucht
 * am Montag keine Meldung darüber.
 */
export function buildWeeklyReport(input: WeeklyInput): WeeklyReport | null {
  const { week, metrics, previous, days } = input;
  const current = minutesIn(days, week);
  const before = minutesIn(days, previousWeek(week));
  if (current.total === 0 && metrics.games === 0) return null;

  const allocation = input.allocation ?? [];
  const needs = new Map(allocation.map((need) => [need.area, need.minutes]));

  const byArea: WeeklyArea[] = AREAS.map((area) => ({
    area,
    minutes: current.byArea[area],
    previous: before.byArea[area],
    target: needs.get(area) ?? 0,
    // Nur wo wirklich trainiert wurde · sonst stünde neben null Minuten
    // Endspiel eine Endspielkennzahl, als hätte das eine mit dem anderen zu tun.
    change:
      current.byArea[area] >= AREA_MIN_MINUTES
        ? compareMetric(previous, metrics, AREA_METRIC[area])
        : null,
  }));

  const compared = REPORT_METRICS.map((key) => compareMetric(previous, metrics, key)).filter(
    (change): change is WeeklyChange => change != null
  );
  const moved = compared
    .filter((change) => change.moved)
    .sort((a, b) => strength(b) - strength(a))
    .slice(0, MAX_CHANGES);
  const quiet =
    moved.length === 0
      ? compared.sort((a, b) => strength(b) - strength(a))[0] ?? null
      : null;

  return {
    week,
    games: metrics.games,
    previousGames: previous.games,
    minutes: current.total,
    previousMinutes: before.total,
    target: allocation.reduce((sum, need) => sum + need.minutes, 0),
    activeDays: days.filter(
      (day) => day.day_ts >= week.start && day.day_ts < week.end && dayMinutes(day) > 0
    ).length,
    byArea,
    changes: moved,
    quiet,
    rating: measureRating([metrics]),
    next: input.prescriptions?.[0] ?? null,
  };
}

// ── Darstellung ─────────────────────────────────────────────────────────────

/** Ein Kennzahlwert in seiner Einheit · dieselbe Schreibweise überall. */
export function formatMetric(value: number, unit: MetricUnit): string {
  if (unit === "elo") return deInt(Math.round(value));
  if (unit === "pct") return `${de(value)} %`;
  return de(value);
}

/** Die Veränderung mit Vorzeichen · „+2,4" bzw. „−1,3". */
export function formatDelta(change: WeeklyChange): string {
  const sign = change.delta > 0 ? "+" : "";
  return `${sign}${de(change.delta)}${change.unit === "pct" ? " %" : ""}`;
}

/**
 * Der eine Satz, der den Bericht zusammenfasst.
 *
 * Er steht im Kopf der Karte und ist zugleich der Aufmacher der
 * Benachrichtigung · beide sollen dasselbe sagen, deshalb steht er hier und
 * nicht zweimal in der Oberfläche.
 */
export function reportHeadline(report: WeeklyReport, t: TFunc): string {
  const change = report.changes[0];
  if (change) {
    return t(change.better ? "wk.headBetter" : "wk.headWorse", {
      metric: t(`metric.${change.key}` as Key),
      from: formatMetric(change.from, change.unit),
      to: formatMetric(change.to, change.unit),
    });
  }
  if (report.rating && Math.abs(report.rating.delta) > ratingNoise(report.rating.games)) {
    return t("wk.headRating", {
      d: `${report.rating.delta > 0 ? "+" : ""}${deInt(report.rating.delta)}`,
      n: deInt(report.rating.games),
    });
  }
  return t("wk.headSteady", { m: deInt(report.minutes) });
}

// ── Gelesen-Merker ──────────────────────────────────────────────────────────

const SEEN_KEY = "kiebitz.weeklyReport.seen";

/**
 * Der Bericht ist eine Meldung, kein Reiter: Er steht einmal oben im
 * Study-Reiter und verschwindet, wenn er gelesen ist. Gemerkt wird dafür der
 * Wochenanfang · der nächste Bericht trägt einen anderen und kommt damit von
 * selbst wieder.
 */
export function weeklyReportSeen(week: ReportWeek): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === String(week.start);
  } catch {
    // Ohne WebView-Speicher lieber einmal zu oft zeigen als nie.
    return false;
  }
}

export function markWeeklyReportSeen(week: ReportWeek): void {
  try {
    localStorage.setItem(SEEN_KEY, String(week.start));
  } catch {
    // Kein Speicher, kein Merker · die Karte kommt beim nächsten Öffnen wieder.
  }
}
