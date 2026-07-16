import { Chess } from "chess.js";
import type { Result } from "../data/demo";

export function fenAfter(sans: string[] | undefined, count?: number): string {
  const chess = new Chess();
  if (!sans) return chess.fen();
  const n = count ?? sans.length;
  try {
    for (let i = 0; i < n && i < sans.length; i++) chess.move(sans[i]);
  } catch {
    // Demo-Daten: bei ungültigem Zug einfach die letzte gültige Stellung zeigen
  }
  return chess.fen();
}

// Aktive Anzeige-Locale für Zahlen/Daten; der LocaleProvider setzt sie.
let formatLocale = "de-DE";

export function setFormatLocale(locale: "de" | "en"): void {
  formatLocale = locale === "en" ? "en-US" : "de-DE";
}

export function dateLocale(): string {
  return formatLocale;
}

/** Zahl mit fester Nachkommastellen-Zahl in der aktiven Locale. */
export function de(n: number, digits = 1): string {
  return n.toLocaleString(formatLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Ganzzahl mit Tausendertrennung in der aktiven Locale. */
export function deInt(n: number): string {
  return n.toLocaleString(formatLocale);
}

export function evalLabel(cp: number): string {
  const p = Math.abs(cp) / 100;
  return `${cp >= 0 ? "+" : "−"}${de(p, 1)}`;
}

/** Weiß-Gewinnwahrscheinlichkeit in % aus Centipawns (für die Eval-Bar) */
export function winProb(cp: number): number {
  return 100 / (1 + Math.exp(-0.004 * cp));
}

export const resultColor: Record<Result, string> = {
  win: "var(--color-win)",
  loss: "var(--color-loss)",
  draw: "var(--color-draw)",
};

export const nagColor: Record<string, string> = {
  "!!": "#22c08a",
  "!": "#3987e5",
  "!?": "#9085e9",
  "?!": "#d9a028",
  "?": "#e08a3c",
  "??": "#e66767",
};
