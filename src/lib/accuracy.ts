import type { MoveEvalRow } from "./analysis";

export type AccuracyPhase = "opening" | "middlegame" | "endgame";

export interface PlayerAccuracy {
  overall: number | null;
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

/** Dieselbe Lichess-basierte Formel wie in der nativen Auto-Analyse. */
export function accuracyFromLosses(losses: number[]): number | null {
  if (losses.length === 0) return null;
  const meanPercent = losses.reduce((sum, loss) => sum + loss, 0) / losses.length * 100;
  const accuracy = 103.1668 * Math.exp(-0.04354 * meanPercent) - 3.1669;
  return Math.round(Math.max(0, Math.min(100, accuracy)) * 10) / 10;
}

function positionWinProbability(row: Pick<MoveEvalRow, "eval_cp" | "mate_in">): number {
  if (row.mate_in != null) return row.mate_in > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-0.004 * (row.eval_cp ?? 0)));
}

function emptyLosses(): Record<"overall" | AccuracyPhase, number[]> {
  return { overall: [], opening: [], middlegame: [], endgame: [] };
}

function finish(losses: ReturnType<typeof emptyLosses>): PlayerAccuracy {
  return {
    overall: accuracyFromLosses(losses.overall),
    opening: accuracyFromLosses(losses.opening),
    middlegame: accuracyFromLosses(losses.middlegame),
    endgame: accuracyFromLosses(losses.endgame),
  };
}

/**
 * Rekonstruiert beide Genauigkeiten aus gespeicherten Zugbewertungen.
 * Das dient zugleich als Fallback fuer Analysen aus Datenbanken, die vor den
 * gegnerischen Accuracy-Spalten angelegt wurden.
 */
export function accuraciesFromMoveEvals(
  rows: MoveEvalRow[],
  myColor: "white" | "black"
): { mine: PlayerAccuracy; opponent: PlayerAccuracy } {
  const white = emptyLosses();
  const black = emptyLosses();
  // Die Analyse-Oberflaeche und Stockfish starten typischerweise bei ca. +0,2.
  let previous = 1 / (1 + Math.exp(-0.004 * 20));

  for (const row of [...rows].sort((a, b) => a.ply - b.ply)) {
    if (row.ply < 1) continue;
    const current = positionWinProbability(row);
    const byWhite = row.ply % 2 === 1;
    const loss = byWhite
      ? Math.max(0, previous - current)
      : Math.max(0, current - previous);
    const target = byWhite ? white : black;
    target.overall.push(loss);
    // Sehr alte bzw. von einer älteren Gegenstelle synchronisierte
    // move_evals können noch phase = "" tragen. Die Gesamtgenauigkeit bleibt
    // daraus berechenbar; nur eine nicht bekannte Phase darf nicht zugeordnet
    // werden und vor allem den Analysis-Tab nicht abbrechen.
    if (row.phase === "opening" || row.phase === "middlegame" || row.phase === "endgame") {
      target[row.phase].push(loss);
    }
    previous = current;
  }

  const mine = myColor === "white" ? white : black;
  const opponent = myColor === "white" ? black : white;
  return { mine: finish(mine), opponent: finish(opponent) };
}
