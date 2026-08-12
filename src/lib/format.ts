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
