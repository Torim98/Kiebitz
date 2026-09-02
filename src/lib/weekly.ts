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
 * Gerechnet wird hier ohne Backend-Zugriff · die Fenster kommen aus
 * `study_metrics`, die Tageslasten aus `training_program`. Nur der
 * Gelesen-Merker ganz unten greift auf die Datenbank durch; er muss ein Update
 * überleben, und der WebView-Speicher tut das nicht.
 */
import type { Key, TFunc } from "./i18n";
import { de, deInt } from "./format";
import type { MetricUnit, MetricValue, MetricWindow } from "./insights";
import { measureRating, ratingNoise, type RatingEffect } from "./effect";
import type { AreaNeed, Prescription } from "./plan";
import { AREAS, dayMinutes, type Area, type LoadDay } from "./study";
import { weekStartOf } from "./week";
import { uiFlagGet, uiFlagSet } from "./db";

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
  /**
   * Dieselbe Kennzahl über die ganze Serie · gesetzt, sobald der Bereich
   * mindestens zwei Wochen in Folge trainiert wurde (siehe `areaRuns`).
   */
  run: WeeklyRun | null;
}

/**
 * Eine Serie: so viele Wochen in Folge wurde ein Bereich trainiert, und so
 * steht seine Kennzahl seither da.
 *
 * Das ist der Wirkungsnachweis des Abos, so schlank er sich machen lässt: eine
 * Zeile im Bericht, die einen längeren Bogen zeigt als die Woche daneben.
 * „Endspiele, 3. Woche in Folge · Endspiel-Genauigkeit 71 → 78" sagt mehr als
 * derselbe Vergleich über sieben Tage, und er kostet keinen neuen Bildschirm,
 * keine gespeicherte Verordnung und keine Definition von „erledigt".
 *
 * Was er nicht sagt, sagt er absichtlich nicht: dass das eine das andere
 * bewirkt hat. Der Bericht hält es hier wie überall (siehe die Kopfnotiz und
 * `AREA_METRIC`) · Trainingszeit und Kennzahl stehen nebeneinander, weil
 * beide gemessen sind. Die Rauschgrenze entscheidet weiter darüber, ob die
 * Bewegung überhaupt eine Aussage ist.
 */
export interface WeeklyRun {
  /** Wochen in Folge mit nennenswerter Zeit in diesem Bereich · mindestens 2. */
  weeks: number;
  /** Die Kennzahl von der Woche vor der Serie bis zur berichteten Woche. */
  change: WeeklyChange;
}

/** Ab so vielen Wochen in Folge ist eine Serie eine Serie und keine Woche. */
const MIN_RUN_WEEKS = 2;

/** So weit zurück wird nach einer Serie gesucht · ein Vierteljahr reicht. */
const MAX_RUN_WEEKS = 13;

/** Eine Serie samt der Woche davor · die Vergleichsbasis ihrer Kennzahl. */
export interface AreaRun {
  area: Area;
  weeks: number;
  /** Die volle Woche vor dem Beginn der Serie. */
  before: ReportWeek;
}

/**
 * Welche Bereiche gerade eine Serie haben · aus den gemessenen Tagen.
 *
 * Bewusst aus `training_program` und nicht aus einer gespeicherten Verordnung:
 * Verordnungen werden bei jedem Rendern neu aus den Befunden abgeleitet und
 * haben weder Beginn noch Abschluss. Die gemessene Trainingszeit hat beides,
 * liegt für 180 Tage vor und ist ohnehin schon geladen. Sie beantwortet
 * dieselbe Frage — *woran wird seit Wochen gearbeitet* — ohne dass irgendwo
 * ein zweiter Zustand gepflegt werden müsste.
 *
 * Gezählt wird rückwärts ab der berichteten Woche, und dieselbe Schwelle wie
 * überall sonst entscheidet, ob eine Woche zählt (`AREA_MIN_MINUTES`): Ein
 * Klick ist keine Trainingswoche.
 */
export function areaRuns(days: LoadDay[], week: ReportWeek): AreaRun[] {
  const out: AreaRun[] = [];
  for (const area of AREAS) {
    let weeks = 0;
    let cursor = week;
    while (weeks < MAX_RUN_WEEKS && minutesIn(days, cursor).byArea[area] >= AREA_MIN_MINUTES) {
      weeks += 1;
      cursor = previousWeek(cursor);
    }
    // `cursor` steht jetzt auf der ersten Woche, die nicht mehr zur Serie
    // gehört · genau die ist die Vergleichsbasis.
    if (weeks >= MIN_RUN_WEEKS) out.push({ area, weeks, before: cursor });
  }
  return out;
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
  /**
   * Die Serien aus `areaRuns` samt den Kennzahlen der Woche *vor* jeder Serie.
   *
   * Sie kommen von außen, weil der Aufrufer die Fenster ohnehin in einem Zug
   * holt: `study_metrics` nimmt beliebig viele auf einmal, und die Datenbank
   * einmal je Fenster durchzugehen wäre dieselbe Runde mehrfach. Fehlen sie,
   * bleibt es beim Wochenvergleich.
   */
  runs?: { run: AreaRun; before: MetricWindow }[];
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
 * Die Serie eines Bereichs als Kennzahl · `null`, wenn es keine gibt oder die
 * Kennzahl sich über die beiden Fenster nicht vergleichen lässt.
 */
function runFor(
  runs: WeeklyInput["runs"],
  metrics: MetricWindow,
  area: Area
): WeeklyRun | null {
  const entry = runs?.find((candidate) => candidate.run.area === area);
  if (!entry) return null;
  const change = compareMetric(entry.before, metrics, AREA_METRIC[area]);
  return change ? { weeks: entry.run.weeks, change } : null;
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
    run: runFor(input.runs, metrics, area),
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
/** Derselbe Merker in der Datenbank · siehe `uiFlagGet` in lib/db.ts. */
const SEEN_FLAG = "weeklyReport.seen";

/**
 * Der Bericht ist eine Meldung, kein Reiter: Er steht einmal oben im
 * Study-Reiter und verschwindet, wenn er gelesen ist. Gemerkt wird dafür der
 * Wochenanfang · der nächste Bericht trägt einen anderen und kommt damit von
 * selbst wieder.
 *
 * Gemerkt wird er zweimal. Der `localStorage` antwortet ohne Warten und trägt
 * damit das erste Bild der Seite; die Datenbank trägt ihn über eine
 * Neuinstallation. Genau daran scheiterte es vorher: Der WebView-Speicher des
 * Desktops ist ein Profilverzeichnis neben der App, kein Datenbestand — nach
 * jedem Update stand der Bericht der laufenden Woche wieder als ungelesen da.
 */
function readLocal(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    // Ohne WebView-Speicher lieber einmal zu oft zeigen als nie.
    return null;
  }
}

function writeLocal(value: string): void {
  try {
    localStorage.setItem(SEEN_KEY, value);
  } catch {
    // Kein Speicher, kein Vorgriff · der dauerhafte Merker unten bleibt davon
    // unberührt.
  }
}

/** Der schnelle Merker · beantwortet das erste Rendern ohne Warten. */
export function weeklyReportSeen(week: ReportWeek): boolean {
  return readLocal() === String(week.start);
}

/**
 * Der dauerhafte Merker aus der Datenbank.
 *
 * Nebenbei gleicht er beide Speicher an: Was nur die Datenbank kennt, wandert
 * in den `localStorage` (nach einem Update der Normalfall), und was nur der
 * `localStorage` kennt, wandert in die Datenbank (der Übergang beim ersten
 * Start mit dieser Fassung).
 */
export async function weeklyReportSeenStored(week: ReportWeek): Promise<boolean> {
  const local = readLocal();
  let stored: string | null = null;
  try {
    stored = await uiFlagGet(SEEN_FLAG);
  } catch {
    // Ohne Backend (Browser-Vorschau) bleibt es beim schnellen Merker.
    return local === String(week.start);
  }
  if (stored == null) {
    if (local) void uiFlagSet(SEEN_FLAG, local).catch(() => {});
    return local === String(week.start);
  }
  if (stored !== local) writeLocal(stored);
  return stored === String(week.start);
}

export function markWeeklyReportSeen(week: ReportWeek): void {
  const value = String(week.start);
  writeLocal(value);
  void uiFlagSet(SEEN_FLAG, value).catch(() => {});
}
