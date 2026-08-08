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
// Der Wert ist ein fertiger BCP-47-Tag (siehe LOCALE_TAGS in i18n.tsx) · das
// Modul kennt die Sprachliste bewusst nicht, sonst importierten sich util und
// i18n gegenseitig.
let formatLocale = "en-US";

export function setFormatLocale(tag: string): void {
  formatLocale = tag;
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

/** Extracts a readable message from native/Tauri errors as well as JS errors. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nativeMessage = (error as { message?: unknown }).message;
    if (typeof nativeMessage === "string" && nativeMessage.trim()) {
      return nativeMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through for exotic/circular host objects.
    }
  }
  return String(error);
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
