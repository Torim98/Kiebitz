import { de } from "./format";

export function evalLabel(cp: number): string {
  const pawns = Math.abs(cp) / 100;
  return `${cp >= 0 ? "+" : "−"}${de(pawns, 1)}`;
}

/** Weiß-Gewinnwahrscheinlichkeit in % aus Centipawns (für die Eval-Bar). */
export function winProb(cp: number): number {
  return 100 / (1 + Math.exp(-0.004 * cp));
}
