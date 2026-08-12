/**
 * Trainingsplan: aus Befunden werden Verordnungen.
 *
 * `findings.ts` sagt, *was* nicht stimmt. Diese Datei beantwortet die drei
 * Fragen danach: worauf entfällt wie viel Trainingszeit, was genau ist an
 * dieser Woche zu tun, und wann steht es im Kalender.
 *
 * Drei Entscheidungen prägen das Ergebnis:
 *
 * 1. **Ratingband-Priors.** Ohne Daten gibt es trotzdem eine sinnvolle
 *    Verteilung — unter 1400 dominieren Patzer, weiter oben gewinnen Eröffnung
 *    und Endspiel an Gewicht. Die Befunde *verschieben* diese Startverteilung,
 *    sie ersetzen sie nicht. Damit steht bei dünner Datenlage etwas
 *    Vernünftiges da, statt einer Empfehlung aus zwölf Partien.
 * 2. **Trainierbarkeit.** Ein Befund zählt nur so weit, wie Kiebitz ihn
 *    überhaupt trainieren kann (`Finding.lever`).
 * 3. **Priorität bleibt Priorität.** Der Soll-Anteil berücksichtigt die reale
 *    Trainingslücke; die Coaching-Insights selbst stehen strikt nach Schwere
 *    des Befunds, damit die wichtigste Baustelle immer zuerst kommt.
 *
 * Reine Funktionen ohne Backend-Zugriff · testbar wie `findings.ts`, und die
 * Seite reicht nur Rohdaten herein.
 */
import type { Key } from "./i18n";
import type { DeepInsights } from "./insights";
import { isoDay } from "./dates";
import type { LiveInsights } from "./stats";
import type { PuzzleInsights } from "./puzzles";
import type { Finding, FindingAction } from "./findings";
import type { AreaLoad, StudyTemplate, TrainingProgram } from "./study";
import { AREAS, type Area } from "./study";
import { toReference } from "./formatScale";
import { isMeaningful, recommendFormat } from "./formatChoice";

// ── Ratingband-Priors ───────────────────────────────────────────────────────

type Prior = Record<Area, number>;

/**
 * Startverteilung des Budgets je Spielstärke, in Prozent.
 *
 * Spielen bleibt überall bei 30 %: Training ohne Partien ist Theorie, und
 * Kiebitz misst seine Wirkung an Partien. Die Verschiebung passiert zwischen
 * Taktik (unten) und Eröffnung/Endspiel (oben) — das ist die
 * Standardempfehlung jedes Trainers und hier nur die Ausgangslage.
 */
const PRIORS: { upTo: number; prior: Prior }[] = [
  { upTo: 1200, prior: { play: 30, tactics: 40, openings: 10, endgames: 5, analysis: 15 } },
  { upTo: 1500, prior: { play: 30, tactics: 35, openings: 15, endgames: 5, analysis: 15 } },
  { upTo: 1800, prior: { play: 30, tactics: 28, openings: 20, endgames: 10, analysis: 12 } },
  { upTo: 2100, prior: { play: 30, tactics: 22, openings: 22, endgames: 16, analysis: 10 } },
  { upTo: Infinity, prior: { play: 30, tactics: 18, openings: 24, endgames: 20, analysis: 8 } },
];

/**
 * Spielstärke auf der Referenzskala, gewichtet nach Partien.
 *
 * Die Priors hängen an einer Zahl, also muss diese Zahl poolfrei sein: 1100
 * Blitz und 1100 Rapid stehen für verschiedene Spielstärken, und wer das
 * ignoriert, bekommt je nach Lieblingsformat ein anderes Trainingsprogramm.
 */
export function referenceRating(deep: DeepInsights): number | null {
  let weighted = 0;
  let games = 0;
  for (const format of deep.formats.formats) {
    if (format.rating == null || format.games <= 0) continue;
    const scaled = toReference(format.rating, format.source, format.time_class);
    if (scaled == null) continue;
    weighted += scaled.value * format.games;
    games += format.games;
  }
  return games > 0 ? Math.round(weighted / games) : null;
}

function priorFor(rating: number | null): Prior {
  // Ohne Rating die mittlere Verteilung · sie ist der beste blinde Tipp.
  const value = rating ?? 1500;
  return (PRIORS.find((band) => value < band.upTo) ?? PRIORS[PRIORS.length - 1]).prior;
}

// ── Allokation ──────────────────────────────────────────────────────────────

export interface AreaNeed {
  area: Area;
  /** Empfohlener Anteil am Wochenbudget in Prozent. */
  target: number;
  /** Tatsächlicher Anteil der letzten 28 Tage in Prozent. */
  actual: number;
  /** Empfohlene Minuten pro Woche. */
  minutes: number;
  /** Minuten pro Woche, die zuletzt tatsächlich anfielen. */
  actualMinutes: number;
  /** Summierte Evidenz aus den Befunden · nur für die Sortierung. */
  evidence: number;
}

/** Wie stark die Befunde die Startverteilung verschieben dürfen. */
const EVIDENCE_GAIN = 0.6;

export function buildAllocation(
  findings: Finding[],
  load: AreaLoad[],
  weeklyMinutes: number,
  rating: number | null
): AreaNeed[] {
  const prior = priorFor(rating);
  const evidence: Record<Area, number> = {
    play: 0,
    tactics: 0,
    openings: 0,
    endgames: 0,
    analysis: 0,
  };
  for (const finding of findings) {
    // Lob verschiebt kein Budget · es steht in der Liste, damit die Seite nicht
    // nur aus Mängeln besteht, aber es ist kein Trainingsbedarf.
    if (finding.tone === "good" || !finding.lever) continue;
    evidence[finding.lever.area] += (finding.severity / 100) * finding.lever.trainability;
  }

  const weights = AREAS.map((area) => ({
    area,
    weight: prior[area] * (1 + EVIDENCE_GAIN * evidence[area]),
  }));
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0) || 1;

  // Ist-Anteil aus den letzten 28 Tagen, auf eine Woche heruntergerechnet.
  const loadByArea = new Map(load.map((entry) => [entry.area, entry.minutes]));
  const loadTotal = load.reduce((sum, entry) => sum + entry.minutes, 0);

  return weights.map(({ area, weight }) => {
    const share = (weight / total) * 100;
    const actualMinutes = Math.round((loadByArea.get(area) ?? 0) / 4);
    return {
      area,
      target: Math.round(share),
      actual: loadTotal > 0 ? Math.round(((loadByArea.get(area) ?? 0) / loadTotal) * 100) : 0,
      minutes: Math.round((share / 100) * weeklyMinutes),
      actualMinutes,
      evidence: Math.round(evidence[area] * 100) / 100,
    };
  });
}

// ── Verordnungen ────────────────────────────────────────────────────────────

/** Eine konkrete, quantifizierte Anweisung. */
export interface Prescription {
  id: string;
  area: Area;
  /** Der Befund dahinter · liefert Titel, Text und Zahlen. */
  finding: Finding;
  /** Die Dosis als eigener Satz: „15 Puzzles/Tag im Band 1420–1580". */
  doseKey: Key | null;
  doseParams: Record<string, string | number>;
  action?: FindingAction;
  /** Kennzahl für die Wirkungsmessung (aus dem Befund übernommen). */
  metricKey?: string;
}

/** Empfohlenes Ratingband und die Tagesdosis für den Puzzle-Trainer. */
export interface PuzzleDose {
  minRating: number;
  maxRating: number;
  perDay: number;
  /** Motiv, falls ein schwaches erkennbar ist. */
  theme?: string;
}

/**
 * Lichess-Tags, die als Motiv nichts taugen: sie beschreiben Länge, Phase oder
 * Herkunft einer Aufgabe, nicht das Muster, das man üben könnte.
 */
const GENERIC_THEMES = new Set([
  "short", "long", "veryLong", "oneMove", "advantage", "crushing", "equality",
  "mate", "middlegame", "opening", "endgame", "master", "masterVsMaster", "superGM",
]);

/** Schwächstes Motiv mit belastbarer Zahl an Versuchen. */
export function weakestTheme(
  themes: { theme: string; attempts: number; solved: number }[],
  minAttempts = 8
): string | undefined {
  return themes
    .filter((entry) => !GENERIC_THEMES.has(entry.theme) && entry.attempts >= minAttempts)
    .map((entry) => ({ theme: entry.theme, rate: (entry.solved / entry.attempts) * 100 }))
    .filter((entry) => entry.rate < 70)
    .sort((a, b) => a.rate - b.rate)[0]?.theme;
}

/**
 * Das Band, in dem Training wirkt: schwer genug, dass es weh tut, leicht
 * genug, dass es gelingt. Gemessen an der eigenen Trefferquote, nicht an einer
 * Faustregel — die Buckets aus `puzzle_insights` sind genau dafür da.
 */
export function puzzleDose(
  puzzles: PuzzleInsights | null,
  minutesPerWeek: number,
  trainingDays: number
): PuzzleDose | null {
  if (!puzzles) return null;
  const rating = puzzles.personal_rating || 1500;
  const bucket = puzzles.by_rating.find(
    (entry) => rating >= entry.key && rating < entry.key + 400 && entry.attempts >= 10
  );
  const rate = bucket && bucket.attempts > 0 ? (bucket.solved / bucket.attempts) * 100 : null;

  // Unter 50 % ist das Material zu schwer (nur noch Frust), über 80 % zu
  // leicht (nur noch Bestätigung).
  const [low, high] =
    rate == null
      ? [rating - 100, rating + 150]
      : rate < 50
        ? [rating - 250, rating]
        : rate > 80
          ? [rating, rating + 250]
          : [rating - 100, rating + 150];

  const perWeek = minutesPerWeek / 1.5;
  const days = Math.max(1, trainingDays);
  return {
    minRating: Math.max(400, Math.round(low)),
    maxRating: Math.round(high),
    perDay: Math.min(60, Math.max(5, Math.round(perWeek / days))),
    theme: weakestTheme(puzzles.themes),
  };
}

/**
 * Bis zu drei Fokusse. Mehr wäre keine Empfehlung mehr, sondern eine Liste ·
 * und drei gleichzeitige Baustellen sind für die Wirkungsmessung schon viel.
 */
const MAX_FOCUSES = 3;

export function buildPrescriptions(
  findings: Finding[],
  allocation: AreaNeed[],
  dose: PuzzleDose | null,
  trainingDays: number
): Prescription[] {
  const candidates = findings.filter((finding) => finding.tone !== "good" && finding.lever);

  // Die Befund-Engine berechnet die Priorität bereits aus Effekt und
  // Stichprobenvertrauen. Die Ist-/Soll-Lücke verändert das Budget, aber nicht
  // die Reihenfolge der Aussagen.
  const ranked = [...candidates].sort(
    (a, b) => b.severity - a.severity || a.id.localeCompare(b.id)
  );

  const out: Prescription[] = [];
  const usedAreas = new Set<Area>();
  for (const finding of ranked) {
    const area = finding.lever!.area;
    // Je Bereich höchstens eine Verordnung · sonst stehen drei Varianten
    // desselben Problems nebeneinander.
    if (usedAreas.has(area)) continue;
    usedAreas.add(area);
    out.push(toPrescription(finding, area, dose, allocation, trainingDays));
    if (out.length >= MAX_FOCUSES) break;
  }
  return out;
}

function minutesOf(allocation: AreaNeed[], area: Area): number {
  return allocation.find((need) => need.area === area)?.minutes ?? 0;
}

function toPrescription(
  finding: Finding,
  area: Area,
  dose: PuzzleDose | null,
  allocation: AreaNeed[],
  trainingDays: number
): Prescription {
  const minutes = minutesOf(allocation, area);
  const perSession = Math.max(10, Math.round(minutes / Math.max(1, trainingDays)));
  // Das Motiv des Befunds hat Vorrang · es ist das konkretere. Sonst nimmt die
  // Dosis das schwächste gemessene Motiv.
  const theme = finding.action?.theme ?? dose?.theme;

  switch (area) {
    case "tactics":
      return {
        id: finding.id,
        area,
        finding,
        doseKey: dose ? (theme ? "plan.dosePuzzlesTheme" : "plan.dosePuzzles") : null,
        doseParams: dose
          ? { n: dose.perDay, lo: dose.minRating, hi: dose.maxRating, theme: theme ?? "" }
          : {},
        action: dose
          ? {
              kind: "puzzles",
              theme,
              minRating: dose.minRating,
              maxRating: dose.maxRating,
            }
          : (finding.action ?? { kind: "puzzles" }),
        metricKey: finding.metricKey,
      };
    case "openings":
      return {
        id: finding.id,
        area,
        finding,
        doseKey: "plan.doseOpenings",
        doseParams: { m: perSession, d: trainingDays },
        action: finding.action ?? { kind: "repertoire" },
        metricKey: finding.metricKey,
      };
    case "endgames":
      return {
        id: finding.id,
        area,
        finding,
        // Endspiele wirken über Wiederholung, nicht über Masse · zwei
        // Einheiten pro Woche sind realistisch und reichen.
        doseKey: "plan.doseEndgames",
        doseParams: { m: Math.max(15, perSession), n: Math.min(3, Math.max(1, trainingDays - 3)) },
        action: finding.action ?? { kind: "endgame" },
        metricKey: finding.metricKey,
      };
    case "analysis":
      return {
        id: finding.id,
        area,
        finding,
        doseKey: "plan.doseAnalysis",
        doseParams: { m: perSession },
        action: finding.action ?? { kind: "analysis" },
        metricKey: finding.metricKey,
      };
    default:
      return {
        id: finding.id,
        area,
        finding,
        doseKey: "plan.dosePlay",
        doseParams: { m: minutes },
        action: finding.action,
        metricKey: finding.metricKey,
      };
  }
}

// ── Spielhygiene ────────────────────────────────────────────────────────────

/** Kein Trainingsinhalt, sondern *wie* gespielt wird · oft der schnellste Hebel. */
export interface HygieneTip {
  id: string;
  key: Key;
  params: Record<string, string | number>;
}

export function buildHygiene(deep: DeepInsights, live: LiveInsights): HygieneTip[] {
  const out: HygieneTip[] = [];
  const { sessions, time } = deep;

  // Das schwächste belastbar vergleichbare Format ist der Trainingsfokus. Die
  // Vergleichslogik selbst bleibt poolbereinigt; nur das Ziel ist bewusst
  // nicht mehr „spiele dort, wo du ohnehin schon am besten bist“.
  const format = recommendFormat(deep.formats.formats);
  if (format && isMeaningful(format)) {
    const alreadyFocused = format.weakest.key === format.busiest.key;
    out.push({
      id: "format",
      key: alreadyFocused ? "plan.hygieneFormatContinue" : "plan.hygieneFormatTrain",
      params: {
        best: format.best.timeClass,
        weak: format.weakest.timeClass,
        p: format.weakestShare,
      },
    });
  }

  if (sessions.recommended_length > 0 && sessions.by_index.length > 1) {
    out.push({
      id: "length",
      key: "plan.hygieneLength",
      params: { n: sessions.recommended_length },
    });
  }
  if (sessions.requeue.fast_games >= 10 && sessions.requeue.fast_score < sessions.requeue.slow_score - 6) {
    out.push({
      id: "requeue",
      key: "plan.hygieneRequeue",
      params: {
        m: Math.max(5, Math.round(sessions.requeue.threshold / 60)),
        p: Math.round(sessions.requeue.slow_score - sessions.requeue.fast_score),
      },
    });
  }
  if (sessions.warmup.primed_games >= 10 && sessions.warmup.primed_score > sessions.warmup.cold_score + 4) {
    out.push({
      id: "warmup",
      key: "plan.hygieneWarmup",
      params: { p: Math.round(sessions.warmup.primed_score - sessions.warmup.cold_score) },
    });
  }
  const bestSlot = [...live.byTimeSlot]
    .filter((slot) => slot.games >= 20)
    .sort((a, b) => b.scorePct - a.scorePct)[0];
  const worstSlot = [...live.byTimeSlot]
    .filter((slot) => slot.games >= 20)
    .sort((a, b) => a.scorePct - b.scorePct)[0];
  if (bestSlot && worstSlot && bestSlot.slot !== worstSlot.slot && bestSlot.scorePct - worstSlot.scorePct >= 8) {
    out.push({
      id: "slot",
      key: "plan.hygieneSlot",
      params: {
        best: bestSlot.slot,
        worst: worstSlot.slot,
        p: bestSlot.scorePct,
        o: worstSlot.scorePct,
      },
    });
  }
  if (time.trouble.share_pct >= 12 && time.trouble.first_move > 0) {
    out.push({
      id: "clock",
      key: "plan.hygieneClock",
      params: { m: Math.round(time.trouble.first_move), p: Math.round(time.trouble.share_pct) },
    });
  }
  return out;
}

// ── Wochenplan ──────────────────────────────────────────────────────────────

export interface PlannedUnit {
  /** ISO-Tag "YYYY-MM-DD". */
  day: string;
  templateId: number;
  templateTitle: string;
  area: Area;
  minutes: number;
}

/** Ordnet eine Vorlage einem Bereich zu · über ihr Werkzeug, sonst über den Titel. */
export function templateArea(template: StudyTemplate): Area | null {
  const haystack = `${template.tool} ${template.title}`.toLowerCase();
  if (haystack.includes("repertoire") || haystack.includes("opening") || haystack.includes("eröffnung")) {
    return "openings";
  }
  if (haystack.includes("endgame") || haystack.includes("endspiel")) return "endgames";
  if (haystack.includes("puzzle") || haystack.includes("tact") || haystack.includes("taktik")) {
    return "tactics";
  }
  // Die Standardvorlage „Game + analysis“ erfüllt primär das stets
  // eingeplante Spielbudget. Reine Analysevorlagen landen weiterhin darunter.
  if (haystack.includes("game") || haystack.includes("partie")) return "play";
  if (haystack.includes("analys")) return "analysis";
  return null;
}

/**
 * Wochenplan-Vorschlag.
 *
 * Die drei Regeln, die ihn von "jeden Tag dasselbe" unterscheiden:
 * Wiederholungen liegen auf den Tagen mit den meisten FSRS-Fälligkeiten,
 * Partien in den Slots mit der besten Bilanz, und Taktik verteilt sich täglich
 * statt in einem Block — verteiltes Üben schlägt Massieren, und genau deshalb
 * gibt es das Repertoire-Training überhaupt in dieser Form.
 *
 * `dueWeek` ist `StudyData.due_week` (Index 0 = heute).
 */
export function buildWeekPlan(
  allocation: AreaNeed[],
  templates: StudyTemplate[],
  dueWeek: number[],
  trainingDayMask: boolean[],
  startDay: Date
): PlannedUnit[] {
  const byArea = new Map<Area, StudyTemplate>();
  for (const template of templates) {
    const area = templateArea(template);
    if (area && !byArea.has(area)) byArea.set(area, template);
  }

  const days: { day: string; index: number; due: number; allowed: boolean }[] = [];
  for (let index = 0; index < 7; index++) {
    const date = new Date(startDay);
    date.setUTCDate(date.getUTCDate() + index);
    // Wochentag der Maske: Index 0 = Montag.
    const weekday = (date.getUTCDay() + 6) % 7;
    days.push({
      day: isoDay(date),
      index,
      due: dueWeek[index] ?? 0,
      allowed: trainingDayMask.some(Boolean) ? trainingDayMask[weekday] : true,
    });
  }
  const usable = days.filter((day) => day.allowed);
  if (usable.length === 0) return [];

  const out: PlannedUnit[] = [];
  for (const need of allocation) {
    const template = byArea.get(need.area);
    if (!template || need.minutes < template.duration_min / 2) continue;

    // Wie viele Einheiten passen ins Budget dieses Bereichs?
    const count = Math.min(
      usable.length,
      Math.max(1, Math.round(need.minutes / template.duration_min))
    );
    let chosen: typeof usable;
    if (need.area === "openings") {
      // Wiederholungen dorthin, wo die Fälligkeiten liegen.
      chosen = [...usable].sort((a, b) => b.due - a.due || a.index - b.index).slice(0, count);
    } else if (need.area === "tactics") {
      // Möglichst gleichmäßig über die Woche.
      const step = usable.length / count;
      chosen = Array.from({ length: count }, (_, i) => usable[Math.floor(i * step)]);
    } else {
      chosen = spread(usable, count);
    }

    for (const day of chosen) {
      out.push({
        day: day.day,
        templateId: template.id,
        templateTitle: template.title,
        area: need.area,
        minutes: template.duration_min,
      });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.area.localeCompare(b.area));
}

/** `count` Tage möglichst gleichmäßig aus der Liste, ohne Dopplung. */
function spread<T>(items: T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const step = items.length / count;
  return Array.from({ length: count }, (_, index) => items[Math.round(index * step)]).filter(
    (item, index, list) => list.indexOf(item) === index
  );
}

// ── Gesamtplan ──────────────────────────────────────────────────────────────

export interface PlanInput {
  deep: DeepInsights;
  live: LiveInsights;
  findings: Finding[];
  puzzles: PuzzleInsights | null;
  program: TrainingProgram | null;
  /** 0 = keine Vorgabe · dann entscheidet die beobachtete Aktivität. */
  weeklyMinutes: number;
  /** Bitmaske als Liste, Index 0 = Montag; alles false = keine Vorgabe. */
  trainingDays: boolean[];
}

export interface TrainingPlan {
  allocation: AreaNeed[];
  prescriptions: Prescription[];
  hygiene: HygieneTip[];
  dose: PuzzleDose | null;
  weeklyMinutes: number;
  /** Kam das Budget aus den Einstellungen oder aus der Beobachtung? */
  budgetFromSettings: boolean;
  rating: number | null;
  trainingDayCount: number;
}

/** Fallback-Budget, wenn weder Vorgabe noch Historie etwas hergeben. */
const DEFAULT_WEEKLY_MINUTES = 180;

export function buildPlan(input: PlanInput): TrainingPlan {
  const { deep, live, findings, puzzles, program } = input;
  const observed = program?.observed_weekly_minutes ?? 0;
  const budgetFromSettings = input.weeklyMinutes > 0;
  const weeklyMinutes = budgetFromSettings
    ? input.weeklyMinutes
    : observed > 30
      ? observed
      : DEFAULT_WEEKLY_MINUTES;

  const dayCount = input.trainingDays.some(Boolean)
    ? input.trainingDays.filter(Boolean).length
    : 7;
  const rating = referenceRating(deep);
  const allocation = buildAllocation(findings, program?.load_28d ?? [], weeklyMinutes, rating);
  const dose = puzzleDose(
    puzzles,
    allocation.find((need) => need.area === "tactics")?.minutes ?? 0,
    dayCount
  );

  return {
    allocation,
    prescriptions: buildPrescriptions(findings, allocation, dose, dayCount),
    hygiene: buildHygiene(deep, live),
    dose,
    weeklyMinutes,
    budgetFromSettings,
    rating,
    trainingDayCount: dayCount,
  };
}
