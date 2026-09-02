// Active display locale for numbers and dates. Kept independent from chess and
// other domain helpers so the application shell stays lightweight.
let formatLocale = "en-US";

export function setFormatLocale(tag: string): void {
  formatLocale = tag;
}

export function dateLocale(): string {
  return formatLocale;
}

export function de(n: number, digits = 1): string {
  return n.toLocaleString(formatLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function deInt(n: number): string {
  return n.toLocaleString(formatLocale);
}

/**
 * Große Zahlen so kurz, dass sie in eine Tabellenspalte passen.
 *
 * Der Online-Bestand des Eröffnungs-Explorers zählt in Milliarden;
 * ausgeschrieben ist das eine dreizehnstellige Zahl, die jede Spalte sprengt,
 * die daneben noch etwas anderes zeigen soll. Bis zehn Millionen bleibt die
 * Zahl deshalb genau — dort ist jede Stelle noch eine Auskunft und passt —, ab
 * dort rundet `Intl` sie in der Sprache des Nutzers ("4,6 Mrd.", "4.6B").
 */
export function deShort(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 10_000_000) return deInt(n);
  return n.toLocaleString(formatLocale, { notation: "compact", maximumFractionDigits: 1 });
}
