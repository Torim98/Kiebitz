/**
 * Uhrendaten einer Partie.
 *
 * Gespeichert wird eine Zahl je Halbzug: die Restzeit der Seite, die den Zug
 * gerade gemacht hat, in Hundertstelsekunden · genau die Semantik der
 * `%clk`-Kommentare in einer PGN und der `clocks`-Liste der Lichess-API.
 * Index 0 gehört zum ersten Halbzug (Weiß), Index 1 zum zweiten (Schwarz).
 */

/** Bedenkzeit-Vorgabe einer Partie, aus dem PGN-Feld TimeControl. */
export interface TimeControl {
  /** Grundzeit in Sekunden. */
  initial: number;
  /** Zeitzuschlag pro Zug in Sekunden. */
  increment: number;
}

/** Restzeiten in Hundertstelsekunden; leere oder kaputte Eingabe ergibt []. */
export function parseClocks(raw: string): number[] {
  if (!raw) return [];
  const values: number[] = [];
  for (const part of raw.trim().split(/\s+/)) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return [];
    values.push(Math.round(value));
  }
  return values;
}

/** Restzeiten als Speicherformat · Gegenstück zu `parseClocks`. */
export function serializeClocks(clocks: number[]): string {
  return clocks.map((value) => Math.max(0, Math.round(value))).join(" ");
}

/**
 * "600+5", "300", "40/7200:1800" oder "-" · nur die erste Stufe interessiert,
 * weil daraus die Startzeit auf der Uhr wird.
 */
export function parseTimeControl(raw: string): TimeControl | null {
  const value = raw?.trim();
  if (!value || value === "-" || value === "?") return null;
  const first = value.split(":")[0];
  const match = /^(?:\d+\/)?(\d+)(?:\+(\d+(?:\.\d+)?))?$/.exec(first.trim());
  if (!match) return null;
  return { initial: Number(match[1]), increment: Number(match[2] ?? 0) };
}

/** "10+5" bzw. "10" (Minuten) für die Kopfzeile; null ohne bekannte Vorgabe. */
export function timeControlLabel(raw: string): string | null {
  const control = parseTimeControl(raw);
  if (!control) return null;
  const minutes = control.initial / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return control.increment > 0 ? `${base}+${control.increment}` : base;
}

/**
 * Hundertstelsekunden als `%clk`-Zeitstempel ("0:09:57.9").
 * Gegenstück zu `parseClockStamp` · so schreiben chess.com und Lichess es auch.
 */
export function clockStamp(centiseconds: number): string {
  const total = Math.max(0, Math.round(centiseconds));
  const hours = Math.floor(total / 360_000);
  const minutes = Math.floor((total % 360_000) / 6_000);
  const seconds = (total % 6_000) / 100;
  const whole = Math.floor(seconds);
  const tenths = Math.round((seconds - whole) * 10);
  const tail = tenths > 0 ? `.${tenths}` : "";
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}${tail}`;
}

/** "0:09:57.9", "1:23", "97.4" → Hundertstelsekunden; null bei Unsinn. */
export function parseClockStamp(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length === 0 || parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    const number = Number(part);
    if (!Number.isFinite(number) || number < 0) return null;
    total = total * 60 + number;
  }
  return Math.round(total * 100);
}

/**
 * Uhrenstände aus dem Zugtext einer PGN.
 *
 * chess.com und Lichess schreiben nach jedem Halbzug `{[%clk 0:09:57.9]}`; ein
 * PGN-Export mit `%emt` nennt stattdessen die verbrauchte Zeit, aus der sich mit
 * bekannter Bedenkzeit-Vorgabe dasselbe rekonstruieren lässt. Liegt keins von
 * beidem vor, bleibt die Liste leer und die Partie hat einfach keine Uhren.
 */
export function clocksFromPgn(pgn: string, control: TimeControl | null): number[] {
  const stamps = [...pgn.matchAll(/\[%clk\s+([0-9:.]+)\]/g)]
    .map((match) => parseClockStamp(match[1]))
    .filter((value): value is number => value != null);
  if (stamps.length > 0) return stamps;

  const elapsed = [...pgn.matchAll(/\[%emt\s+([0-9:.]+)\]/g)]
    .map((match) => parseClockStamp(match[1]))
    .filter((value): value is number => value != null);
  if (elapsed.length === 0 || !control) return [];
  const start = control.initial * 100;
  const increment = control.increment * 100;
  const remaining = [start, start];
  return elapsed.map((used, index) => {
    const side = index % 2;
    remaining[side] = Math.max(0, remaining[side] + increment - used);
    return remaining[side];
  });
}

/** Restzeit als "1:07", "12:04" oder "0:08,4" · Zehntel erst unter 20 Sekunden. */
export function formatClock(centiseconds: number, locale: "de" | "en" = "de"): string {
  const total = Math.max(0, centiseconds);
  const seconds = total / 100;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds - hours * 3600 - minutes * 60;
  const decimal = locale === "de" ? "," : ".";
  if (total < 2000) {
    const shown = rest.toFixed(1).replace(".", decimal);
    const pad = rest < 10 ? "0" : "";
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${pad}${shown}`
      : `${minutes}:${pad}${shown}`;
  }
  const whole = Math.floor(rest);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}`
    : `${minutes}:${String(whole).padStart(2, "0")}`;
}

export interface ClockView {
  /** Restzeiten in Hundertstelsekunden; null, wenn für die Seite nichts vorliegt. */
  white: number | null;
  black: number | null;
  /** Verbrauchte Zeit des Halbzugs, der zu `ply` gehört (null = unbekannt). */
  spent: number | null;
}

/**
 * Uhrenstand nach `ply` Halbzügen.
 *
 * Für jede Seite gilt der letzte Wert, den sie bis dahin auf die Uhr gebracht
 * hat; vor ihrem ersten Zug steht die Grundzeit aus der Bedenkzeit-Vorgabe.
 * `spent` ist die Differenz zum vorletzten Wert derselben Seite, korrigiert um
 * den Zuschlag · das ist die Zeit, die dieser Zug gekostet hat.
 */
export function clocksAtPly(
  clocks: number[],
  ply: number,
  control: TimeControl | null
): ClockView {
  if (clocks.length === 0) return { white: null, black: null, spent: null };
  const start = control ? control.initial * 100 : null;
  const at = (index: number): number | null =>
    index >= 1 && index <= clocks.length ? clocks[index - 1] : null;

  /** Letzter Halbzug dieser Seite bis `ply` (Weiß zieht ungerade Halbzüge). */
  const lastPly = (white: boolean): number => {
    const parity = white ? 1 : 0;
    for (let candidate = Math.min(ply, clocks.length); candidate >= 1; candidate--) {
      if (candidate % 2 === parity) return candidate;
    }
    return 0;
  };
  const whitePly = lastPly(true);
  const blackPly = lastPly(false);

  const current = at(Math.min(ply, clocks.length));
  const previousSame = at(Math.min(ply, clocks.length) - 2);
  const base = previousSame ?? start;
  const increment = control ? control.increment * 100 : 0;
  const spent =
    current != null && base != null ? Math.max(0, base + increment - current) : null;

  return {
    white: whitePly > 0 ? at(whitePly) : start,
    black: blackPly > 0 ? at(blackPly) : start,
    spent: ply >= 1 && ply <= clocks.length ? spent : null,
  };
}
