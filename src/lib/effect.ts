/**
 * Wirkungsmessung: hat sich eine Kennzahl wirklich verändert?
 *
 * Der Kern ist die Rauschgrenze. Eine Punktausbeute über zwanzig Partien
 * schwankt von allein um mehrere Prozentpunkte; wer solche Ausschläge als
 * Fortschritt liest, misst nur Zufall. Deshalb bekommt jeder Vergleich eine
 * Grenze aus der tatsächlichen Streuung, und ein Urteil gibt es erst, wenn die
 * Veränderung darüber liegt.
 *
 * Vier Urteile, nie mehr. „Unverändert" ist der häufigste und ehrlichste ·
 * „noch nicht messbar" ist eine Antwort, keine Lücke: dort steht dann, wie viel
 * Material noch fehlt, und das macht „spiel weiter" zu einer konkreten Ansage.
 *
 * Reine Funktionen ohne Backend-Zugriff · die Fenster kommen aus
 * `study_metrics` (siehe `insights.ts`).
 */
import type { MetricValue, MetricWindow, RatingPoint } from "./insights";
import { toReference, type Confidence } from "./formatScale";

export type Verdict = "improved" | "unchanged" | "worse" | "insufficient";

export interface EffectResult {
  key: string;
  verdict: Verdict;
  /** Wert vor dem Zyklus (null, wenn es keine Grundlage gibt). */
  before: number | null;
  after: number | null;
  /** after − before, in der Einheit der Kennzahl. */
  delta: number | null;
  /** Ab dieser Größe ist die Veränderung mehr als Rauschen. */
  noise: number | null;
  /** Ist die Veränderung eine Verbesserung? Berücksichtigt die Richtung. */
  better: boolean | null;
  /** Stichprobe im aktuellen Fenster. */
  n: number;
  /** Fehlende Stichprobe bis zur Messbarkeit (0, wenn sie reicht). */
  missing: number;
  unit: MetricValue["unit"];
  lowerIsBetter: boolean;
}

/**
 * Mindeststichproben je Einheit. Sie sind die zweite Sicherung neben der
 * Rauschgrenze: bei winzigem n kann eine Grenze rechnerisch klein ausfallen,
 * ohne dass die Aussage etwas taugt.
 */
const MIN_SAMPLE: Record<MetricValue["unit"], number> = {
  // Partien bzw. Versuche.
  pct: 20,
  // Züge · eine Fehlerrate braucht deutlich mehr Material.
  per100: 400,
  elo: 20,
};

/**
 * Standardfehler einer Kennzahl.
 *
 * Wo die Streuung der Einzelwerte mitgeliefert wird (Punktausbeute,
 * Genauigkeit, Puzzle-Rating), ist es der klassische SD/√n. Für Ereignisraten
 * je 100 Züge gilt das Poisson-Modell: die Zahl der Ereignisse streut mit ihrer
 * eigenen Wurzel. Für Anteile ohne mitgelieferte Streuung greift der
 * Binomial-Fehler.
 */
function standardError(value: MetricValue): number | null {
  if (value.value == null || value.n <= 1) return null;
  if (value.sd != null) return value.sd / Math.sqrt(value.n);
  if (value.unit === "per100") {
    const events = (value.value / 100) * value.n;
    if (events <= 0) return 100 / value.n;
    return (Math.sqrt(events) / value.n) * 100;
  }
  const p = Math.min(100, Math.max(0, value.value)) / 100;
  return Math.sqrt(Math.max(p * (1 - p), 0.01) / value.n) * 100;
}

/**
 * Rauschgrenze eines Vergleichs: die Standardfehler beider Fenster addieren
 * sich quadratisch, und erst knapp zwei Standardfehler Abstand sind mehr als
 * Zufall. Das ist bewusst näher an „vorsichtig" als an „signifikant" · eine
 * Trainingsempfehlung ist keine Publikation, aber sie soll nicht bei jedem
 * Ausreißer Erfolg melden.
 */
const NOISE_FACTOR = 1.8;

export function noiseFloor(before: MetricValue, after: MetricValue): number | null {
  const a = standardError(before);
  const b = standardError(after);
  if (a == null || b == null) return null;
  return Math.sqrt(a * a + b * b) * NOISE_FACTOR;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function find(window: MetricWindow | null, key: string): MetricValue | null {
  return window?.metrics.find((metric) => metric.key === key) ?? null;
}

/** Vergleicht eine Kennzahl zwischen zwei Fenstern. */
export function measureEffect(
  key: string,
  before: MetricWindow | null,
  after: MetricWindow | null
): EffectResult {
  const b = find(before, key);
  const a = find(after, key);
  const unit = a?.unit ?? b?.unit ?? "pct";
  const lowerIsBetter = a?.lower_is_better ?? b?.lower_is_better ?? false;
  const n = a?.n ?? 0;
  const need = MIN_SAMPLE[unit];
  const base: EffectResult = {
    key,
    verdict: "insufficient",
    before: b?.value ?? null,
    after: a?.value ?? null,
    delta: null,
    noise: null,
    better: null,
    n,
    missing: Math.max(0, need - n),
    unit,
    lowerIsBetter,
  };

  if (a?.value == null || n < need) return base;
  // Ohne Vergleichswert lässt sich der Stand zeigen, aber keine Wirkung.
  if (b?.value == null || b.n < need) {
    return { ...base, missing: Math.max(0, need - (b?.n ?? 0)) };
  }

  const delta = round(a.value - b.value);
  const noise = noiseFloor(b, a);
  if (noise == null) return { ...base, delta };

  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const verdict: Verdict =
    Math.abs(delta) < noise ? "unchanged" : improved ? "improved" : "worse";
  return {
    ...base,
    verdict,
    delta,
    noise: round(noise),
    better: improved,
    missing: 0,
  };
}

// ── Rating als Rückmeldung ──────────────────────────────────────────────────

export interface RatingEffect {
  /** Veränderung auf der Referenzskala (chess.com Blitz). */
  delta: number;
  /** Schwächste Verlässlichkeit aller beteiligten Umrechnungen. */
  confidence: Confidence;
  /** Pools, die in die Rechnung eingegangen sind. */
  pools: number;
  games: number;
}

const CONFIDENCE_ORDER: Confidence[] = ["measured", "extrapolated", "estimated"];

/**
 * Ratingveränderung über alle gespielten Pools.
 *
 * Ratings verschiedener Formate und Plattformen liegen in getrennten Pools:
 * 1100 Blitz ist nicht dasselbe wie 1100 Rapid. Deshalb wird jeder Stand
 * einzeln auf die Referenzskala gebracht und erst dort verglichen, gewichtet
 * nach Partien. Roh addieren würde genau den Fehler machen, den `formatScale`
 * verhindern soll.
 */
export function measureRating(windows: MetricWindow[]): RatingEffect | null {
  const points: RatingPoint[] = windows.flatMap((window) => window.ratings);
  if (points.length === 0) return null;

  // Gleiche Pools über mehrere Fenster zusammenziehen: frühester Anfang,
  // spätestes Ende.
  const merged = new Map<string, RatingPoint>();
  for (const point of points) {
    const id = `${point.source}/${point.time_class}`;
    const existing = merged.get(id);
    merged.set(
      id,
      existing
        ? {
            ...existing,
            last: point.last,
            games: existing.games + point.games,
          }
        : { ...point }
    );
  }

  let weighted = 0;
  let games = 0;
  let confidence: Confidence = "measured";
  let pools = 0;
  for (const point of merged.values()) {
    const from = toReference(point.first, point.source, point.time_class);
    const to = toReference(point.last, point.source, point.time_class);
    if (from == null || to == null || point.games === 0) continue;
    weighted += (to.value - from.value) * point.games;
    games += point.games;
    pools += 1;
    for (const result of [from, to]) {
      if (CONFIDENCE_ORDER.indexOf(result.confidence) > CONFIDENCE_ORDER.indexOf(confidence)) {
        confidence = result.confidence;
      }
    }
  }
  if (games === 0) return null;
  return { delta: Math.round(weighted / games), confidence, pools, games };
}

/**
 * Rauschgrenze einer Ratingveränderung. Eine einzelne Partie verschiebt das
 * Rating um bis zu ~16 Punkte, und der Weg dahin ist ein Random Walk · über n
 * Partien wächst die zufällige Auslenkung mit der Wurzel.
 */
export function ratingNoise(games: number): number {
  if (games <= 0) return 0;
  return Math.round(8 * Math.sqrt(games));
}

/**
 * Fenster für einen Fokus-Zyklus: gleich lang vor und nach dem Start, damit
 * beide Seiten dieselbe Chance auf Material haben.
 */
export function cycleWindows(
  startTs: number,
  cycleDays: number,
  now: number
): { before: { from_ts: number; to_ts: number }; after: { from_ts: number; to_ts: number } } {
  const span = cycleDays * 86_400;
  return {
    before: { from_ts: startTs - span, to_ts: startTs },
    after: { from_ts: startTs, to_ts: Math.max(now, startTs) + 1 },
  };
}

/** Verstrichener Anteil eines Zyklus in Prozent (0 … 100). */
export function cycleProgress(startTs: number, cycleDays: number, now: number): number {
  const span = cycleDays * 86_400;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((now - startTs) / span) * 100)));
}
