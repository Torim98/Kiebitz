/**
 * Wirkungsmessung: hat sich das Rating wirklich verändert?
 *
 * Der Kern ist die Rauschgrenze. Ein Ratingstand schwankt von allein um
 * mehrere Punkte; wer solche Ausschläge als Fortschritt liest, misst nur
 * Zufall. Deshalb bekommt der Vergleich eine Grenze aus der Zahl der Partien,
 * und erst darüber ist die Veränderung eine Aussage.
 *
 * Reine Funktionen ohne Backend-Zugriff · die Fenster kommen aus
 * `study_metrics` (siehe `insights.ts`).
 */
import type { MetricWindow, RatingPoint } from "./insights";
import { toReference, type Confidence } from "./formatScale";

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
