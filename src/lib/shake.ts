/**
 * Schütteln als Abkürzung zur Rückmeldung.
 *
 * Wer auf dem Handy über einen Fehler stolpert, hat die Hand schon in Bewegung ·
 * kräftiges Schütteln öffnet deshalb direkt die Feedback-Seite. Die Erkennung
 * läuft über `devicemotion`: es zählt, wie oft sich der Beschleunigungsbetrag
 * kurz hintereinander stark ändert. Ein einzelner Ruck (Tasche, Hinsetzen)
 * reicht nicht, drei Richtungswechsel in anderthalb Sekunden schon.
 */

/** Mindeständerung des Beschleunigungsbetrags, die als Ruck zählt (m/s²). */
const JOLT_THRESHOLD = 14;
/** So viele Rucke müssen zusammenkommen. */
const JOLTS_NEEDED = 3;
/** Zeitfenster für die Rucke. */
const WINDOW_MS = 1_500;
/** Danach löst dieselbe Geste erst nach dieser Pause wieder aus. */
const COOLDOWN_MS = 4_000;
/** Zwischen zwei gezählten Rucken liegt mindestens diese Zeit. */
const MIN_GAP_MS = 120;

interface MotionLike {
  accelerationIncludingGravity?: {
    x: number | null;
    y: number | null;
    z: number | null;
  } | null;
}

/**
 * Meldet kräftiges Schütteln an `onShake`. Gibt eine Abmeldefunktion zurück ·
 * auf Geräten ohne Bewegungssensor passiert nichts.
 */
export function onDeviceShake(onShake: () => void): () => void {
  if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
    return () => {};
  }

  let previous: number | null = null;
  let lastJolt = 0;
  let firstJolt = 0;
  let jolts = 0;
  let mutedUntil = 0;

  const handler = (event: Event) => {
    const motion = event as MotionLike;
    const acceleration = motion.accelerationIncludingGravity;
    if (!acceleration) return;
    const magnitude = Math.hypot(
      acceleration.x ?? 0,
      acceleration.y ?? 0,
      acceleration.z ?? 0
    );
    if (previous == null) {
      previous = magnitude;
      return;
    }
    const change = Math.abs(magnitude - previous);
    previous = magnitude;

    const now = Date.now();
    if (now < mutedUntil || change < JOLT_THRESHOLD || now - lastJolt < MIN_GAP_MS) return;

    // Ein zu spät gekommener Ruck beginnt ein neues Fenster.
    if (jolts === 0 || now - firstJolt > WINDOW_MS) {
      firstJolt = now;
      jolts = 0;
    }
    lastJolt = now;
    jolts += 1;
    if (jolts >= JOLTS_NEEDED) {
      jolts = 0;
      mutedUntil = now + COOLDOWN_MS;
      onShake();
    }
  };

  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}
