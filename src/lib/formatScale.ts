/**
 * Zeitformate vergleichbar machen.
 *
 * Ratings verschiedener Zeitformate und Plattformen stehen in getrennten Pools.
 * Dieselbe Zahl bedeutet dort nicht dieselbe Spielstärke, und die Richtung des
 * Unterschieds ist nicht intuitiv: auf chess.com liegt ein Rapid-Rating bei
 * schwächeren Spielern deutlich **über** dem Blitz-Rating derselben Person, und
 * der Abstand schrumpft nach oben auf null.
 *
 * Deshalb gibt es hier zwei getrennte Wege, und die Oberfläche muss beide
 * auseinanderhalten:
 *
 * 1. **Können** (`avg_loss`, Genauigkeit, Patzerquote) ist poolfrei und damit
 *    der ehrliche Vergleich. Er kommt aus den eigenen Partien.
 * 2. **Rating** lässt sich nur über eine externe Umrechnung vergleichen. Die
 *    Ankerpunkte unten stammen aus der ChessGoals-Auswertung von rund 20.000
 *    aktiven Profilen (https://chessgoals.com/rating-comparison/). Das ist eine
 *    Stichprobe fremder Spieler, kein Naturgesetz · sie driftet mit der Zeit und
 *    gilt nur ungefähr. Jede Umrechnung trägt deshalb ihre Verlässlichkeit mit.
 *
 * Referenzskala ist chess.com Blitz, weil dafür die dichtesten Daten vorliegen.
 */

export type Confidence = "measured" | "extrapolated" | "estimated";

export interface ScaleResult {
  /** Rating auf der Referenzskala (chess.com Blitz). */
  value: number;
  confidence: Confidence;
}

/** Stützstellen: [Rating im Quellpool, entsprechendes chess.com-Blitz-Rating]. */
type Anchors = [number, number][];

/**
 * Gemessene Zuordnungen. chess.com Blitz ist die Referenz und damit die
 * Identität; alles andere hängt an den ChessGoals-Stützstellen.
 */
const MEASURED: Record<string, Anchors> = {
  "chess.com/blitz": [
    [1000, 1000],
    [2000, 2000],
  ],
  // 1000 Blitz ≈ 1255 Rapid, 2000 Blitz ≈ 1995 Rapid.
  "chess.com/rapid": [
    [1255, 1000],
    [1995, 2000],
  ],
  // 1000 Blitz ≈ 920 Bullet, 2000 Blitz ≈ 1900 Bullet.
  "chess.com/bullet": [
    [920, 1000],
    [1900, 2000],
  ],
  // Lichess Blitz liegt durchgehend höher, der Abstand schrumpft nach oben.
  "lichess/blitz": [
    [1290, 800],
    [1425, 1000],
    [1885, 1700],
    [2080, 2000],
  ],
};

/**
 * Für Lichess-Rapid, -Bullet und -Klassisch liegen keine belastbaren
 * Stützstellen vor. Sie werden über Lichess-Blitz angenähert, indem der
 * chess.com-interne Abstand desselben Zeitformats übernommen wird · für
 * Klassisch zusätzlich der bekannte Befund, dass der Pool dort schwächer
 * besetzt ist und dasselbe Rating weniger Spielstärke bedeutet. Das ist eine
 * Schätzung und wird in der Oberfläche auch so ausgewiesen.
 */
const ESTIMATED_OFFSET: Record<string, number> = {
  "lichess/rapid": -150,
  "lichess/bullet": 80,
  "lichess/classical": -300,
  "lichess/daily": -200,
  "chess.com/daily": -200,
  "chess.com/classical": -100,
};

/** Lineare Interpolation zwischen den Stützstellen, außerhalb fortgesetzt. */
function interpolate(anchors: Anchors, rating: number): ScaleResult {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (rating <= first[0] || rating >= last[0]) {
    // Außerhalb der gemessenen Spanne wird die Steigung des Randsegments
    // fortgeschrieben · brauchbar, aber ausdrücklich unsicher.
    const [a, b] = rating <= first[0] ? [sorted[0], sorted[1] ?? sorted[0]] : [sorted[sorted.length - 2] ?? last, last];
    const span = b[0] - a[0];
    const slope = span === 0 ? 1 : (b[1] - a[1]) / span;
    const anchor = rating <= first[0] ? first : last;
    return {
      value: Math.round(anchor[1] + (rating - anchor[0]) * slope),
      confidence: rating === first[0] || rating === last[0] ? "measured" : "extrapolated",
    };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (rating >= x0 && rating <= x1) {
      const t = x1 === x0 ? 0 : (rating - x0) / (x1 - x0);
      return { value: Math.round(y0 + t * (y1 - y0)), confidence: "measured" };
    }
  }
  return { value: Math.round(rating), confidence: "extrapolated" };
}

/**
 * Rechnet ein Rating auf die Referenzskala um. `null`, wenn der Pool unbekannt
 * ist (PGN-Importe haben kein Rating-System).
 */
export function toReference(
  rating: number | null,
  source: string,
  timeClass: string
): ScaleResult | null {
  if (rating == null || rating <= 0) return null;
  const key = `${source}/${timeClass}`;
  const anchors = MEASURED[key];
  if (anchors) return interpolate(anchors, rating);

  const offset = ESTIMATED_OFFSET[key];
  if (offset != null) {
    const base = MEASURED[`${source}/blitz`] ?? MEASURED["lichess/blitz"];
    const viaBlitz = interpolate(base, rating + offset);
    return { value: viaBlitz.value, confidence: "estimated" };
  }
  return null;
}

/** Menschenlesbarer Name der Referenzskala · steht als Fußnote unter der Tabelle. */
export const REFERENCE_LABEL = "chess.com Blitz";

/** Quelle der Umrechnung, für die Fußnote. */
export const REFERENCE_SOURCE = "chessgoals.com/rating-comparison";
