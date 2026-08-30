/**
 * Kurzzeitgedächtnis der Seiten über einen Absprung hinweg.
 *
 * Wer im Coach auf „Puzzles" tippt, springt eine Ebene tiefer · der Zurück-
 * Pfeil bringt ihn zwar auf dieselbe Seite zurück, aber sie wird dabei neu
 * eingehängt. Ohne Gedächtnis beginnt sie oben, und der Befund, aus dem der
 * Absprung kam, steht wieder irgendwo weiter unten.
 *
 * Gemerkt wird deshalb genau für die Dauer eines Absprungs: `rememberScroll`
 * beim Hinunterspringen, `takeScroll` beim Zurückkommen, `forgetPages` beim
 * Tabwechsel. Der Tabwechsel bleibt damit, was er war · jeder Tab beginnt
 * oben, das ist gewollt.
 *
 * Der Schlüssel ist die Stapeltiefe (siehe nav.ts). Eine gemerkte Position
 * kann nur auf zwei Wegen wieder erreicht werden: zurück (dann gilt sie) oder
 * über einen Tabwechsel (der sie vorher vergisst). Verwechseln kann sie sich
 * dadurch nicht.
 */
import { useCallback, useState } from "react";

/** So lange halten wir an der gemerkten Position fest, während nachgeladen wird. */
const RESTORE_MS = 2_000;

/** Diese Gesten gehören dem Nutzer · danach schiebt niemand mehr an ihm vorbei. */
const ABORT_EVENTS = ["wheel", "touchstart", "pointerdown"] as const;

/** Die Scroll-Position je verlassener Stapelebene. */
const scrollByDepth = new Map<number, number>();
/** Seitenzustand, der einen Absprung überleben soll (z. B. der offene Reiter). */
const stateByKey = new Map<string, unknown>();

/** Absprung in eine Detailebene: Position der verlassenen Ebene merken. */
export function rememberScroll(depth: number, top: number): void {
  scrollByDepth.set(depth, top > 0 ? top : 0);
}

/** Rückkehr auf eine Ebene: die gemerkte Position, falls es eine gibt. */
export function takeScroll(depth: number): number | undefined {
  const top = scrollByDepth.get(depth);
  scrollByDepth.delete(depth);
  return top;
}

/** Tabwechsel · alles vergessen, jeder Tab fängt oben und im Grundzustand an. */
export function forgetPages(): void {
  scrollByDepth.clear();
  stateByKey.clear();
}

/** Nur für Tests · setzt beide Gedächtnisse zurück. */
export const resetPageMemoryForTests = forgetPages;

/** Der Ausschnitt eines Scroll-Containers, den wir wirklich brauchen. */
export type ScrollBox = Pick<
  HTMLElement,
  "scrollTop" | "addEventListener" | "removeEventListener"
>;

/**
 * Setzt den Container auf `top` und hält daran fest, solange die Seite ihre
 * Daten noch nachlädt · vor dem ersten Inhalt ist sie zu kurz, um überhaupt so
 * weit scrollen zu können. Nach {@link RESTORE_MS}, bei erreichtem Ziel oder
 * sobald der Nutzer selbst anfasst, ist Schluss. Gibt eine Abbruchfunktion
 * zurück.
 */
export function keepScroll(box: ScrollBox, top: number): () => void {
  box.scrollTop = top;
  if (top <= 0 || box.scrollTop === top) return () => {};

  let frame = 0;
  let stopped = false;
  const deadline = Date.now() + RESTORE_MS;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    for (const type of ABORT_EVENTS) box.removeEventListener(type, stop);
  };
  const tick = () => {
    if (stopped) return;
    box.scrollTop = top;
    if (box.scrollTop === top || Date.now() >= deadline) return stop();
    frame = requestAnimationFrame(tick);
  };

  for (const type of ABORT_EVENTS) box.addEventListener(type, stop, { passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}

/**
 * Wie `useState`, nur dass der Wert einen Absprung übersteht. Gedacht für die
 * eine Auswahl, ohne die eine wiederhergestellte Scroll-Position nichts wert
 * wäre · den offenen Reiter der Insights etwa. Beim Tabwechsel ist der Wert
 * weg, dann beginnt die Seite wieder im Grundzustand.
 */
export function usePageMemory<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() =>
    stateByKey.has(key) ? (stateByKey.get(key) as T) : initial
  );
  const set = useCallback(
    (next: T) => {
      stateByKey.set(key, next);
      setValue(next);
    },
    [key]
  );
  return [value, set];
}
