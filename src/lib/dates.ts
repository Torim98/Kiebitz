export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * ISO-Kalenderwoche eines Datums.
 *
 * Die Woche gehört nach ISO 8601 dem Jahr ihres Donnerstags · deshalb der
 * Umweg über ihn statt einer Rechnung ab dem 1. Januar, die den Jahreswechsel
 * regelmäßig um eine Woche verfehlt.
 */
export function isoWeek(date: Date): number {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7)
  );
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
