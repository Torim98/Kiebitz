/**
 * Brett-Klänge: Zug, Schlag, Schach, Rochade, Umwandlung, Fehlzug.
 *
 * Die Klänge werden per Web Audio synthetisiert statt als Dateien
 * mitgeliefert. Zwei Gründe: die Sound-Sets von lichess stehen unter eigenen
 * Lizenzen, die Kiebitz nicht weitergeben darf, und ein Klick aus Rauschen +
 * Körper kostet keine Bytes im Bundle. Charakter und Länge sind dem
 * "standard"-Set von lichess nachempfunden · ein kurzes, trockenes Holzklopfen,
 * beim Schlag lauter und mit tieferem Körper.
 *
 * Der Kontext entsteht erst beim ersten Klang, also immer aus einer
 * Nutzeraktion heraus · Browser und WebViews starten ihn sonst nicht.
 */

export type BoardSoundKind =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "promote"
  | "error";

/** Fällt in Umgebungen ohne Web Audio (jsdom, alte WebViews) auf null zurück. */
type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;
let volume = 0.7;
/** Ein einmal fehlgeschlagener Kontext wird nicht bei jedem Zug neu versucht. */
let unavailable = false;

export function setBoardSoundEnabled(on: boolean): void {
  enabled = on;
}

export function boardSoundEnabled(): boolean {
  return enabled;
}

/** 0 … 1; die Klänge bleiben absichtlich deutlich unter Vollaussteuerung. */
export function setBoardSoundVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  if (master && context) master.gain.setValueAtTime(volume * 0.5, context.currentTime);
}

function audioCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Rauschbasis für den Anschlag · einmal erzeugt, danach nur noch abgespielt. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise) return noise;
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministischer Pseudo-Zufall: derselbe Anschlag bei jedem Start.
  let seed = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x3fffffff) - 1;
  }
  noise = buffer;
  return buffer;
}

function ensureContext(): AudioContext | null {
  if (context) return context;
  if (unavailable) return null;
  const Ctor = audioCtor();
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = volume * 0.5;
    gain.connect(ctx.destination);
    context = ctx;
    master = gain;
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

interface Layer {
  /** Bandpass-Mitte des Anschlags in Hz. */
  noiseHz: number;
  noiseQ: number;
  noiseGain: number;
  noiseDecay: number;
  /** Körper: Startfrequenz und Ziel, über die Dauer heruntergezogen. */
  bodyFrom: number;
  bodyTo: number;
  bodyGain: number;
  bodyDecay: number;
  type: OscillatorType;
}

/**
 * Die sechs Klänge als Parametersatz. Die Werte sind nach Gehör an das
 * lichess-Standardset angenähert: Zug kurz und mittig, Schlag lauter mit
 * tieferem Körper, Schach heller, Fehlzug als abfallender Zweiklang.
 */
const LAYERS: Record<BoardSoundKind, Layer[]> = {
  move: [
    {
      noiseHz: 1250,
      noiseQ: 1.1,
      noiseGain: 0.5,
      noiseDecay: 0.055,
      bodyFrom: 220,
      bodyTo: 130,
      bodyGain: 0.32,
      bodyDecay: 0.075,
      type: "triangle",
    },
  ],
  capture: [
    {
      noiseHz: 1900,
      noiseQ: 0.75,
      noiseGain: 0.85,
      noiseDecay: 0.075,
      bodyFrom: 300,
      bodyTo: 90,
      bodyGain: 0.5,
      bodyDecay: 0.13,
      type: "triangle",
    },
    {
      noiseHz: 520,
      noiseQ: 1.4,
      noiseGain: 0.45,
      noiseDecay: 0.11,
      bodyFrom: 150,
      bodyTo: 70,
      bodyGain: 0.3,
      bodyDecay: 0.16,
      type: "sine",
    },
  ],
  check: [
    {
      noiseHz: 2600,
      noiseQ: 1.6,
      noiseGain: 0.6,
      noiseDecay: 0.05,
      bodyFrom: 880,
      bodyTo: 660,
      bodyGain: 0.26,
      bodyDecay: 0.16,
      type: "sine",
    },
  ],
  castle: [
    {
      noiseHz: 1100,
      noiseQ: 1.1,
      noiseGain: 0.45,
      noiseDecay: 0.05,
      bodyFrom: 200,
      bodyTo: 120,
      bodyGain: 0.3,
      bodyDecay: 0.07,
      type: "triangle",
    },
    {
      noiseHz: 1100,
      noiseQ: 1.1,
      noiseGain: 0.4,
      noiseDecay: 0.05,
      bodyFrom: 190,
      bodyTo: 115,
      bodyGain: 0.26,
      bodyDecay: 0.07,
      type: "triangle",
    },
  ],
  promote: [
    {
      noiseHz: 1500,
      noiseQ: 1.2,
      noiseGain: 0.4,
      noiseDecay: 0.05,
      bodyFrom: 520,
      bodyTo: 1040,
      bodyGain: 0.3,
      bodyDecay: 0.2,
      type: "sine",
    },
  ],
  error: [
    {
      noiseHz: 400,
      noiseQ: 1.2,
      noiseGain: 0.3,
      noiseDecay: 0.06,
      bodyFrom: 220,
      bodyTo: 110,
      bodyGain: 0.4,
      bodyDecay: 0.22,
      type: "sawtooth",
    },
  ],
};

/** Zweite Rochaden-/Schlagschicht startet minimal später (Doppelschlag). */
const LAYER_DELAY = 0.045;

function playLayer(ctx: AudioContext, target: GainNode, layer: Layer, at: number): void {
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = layer.noiseHz;
  band.Q.value = layer.noiseQ;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(layer.noiseGain, at);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, at + layer.noiseDecay);
  noiseSource.connect(band).connect(noiseGain).connect(target);
  noiseSource.start(at);
  noiseSource.stop(at + layer.noiseDecay + 0.02);

  const osc = ctx.createOscillator();
  osc.type = layer.type;
  osc.frequency.setValueAtTime(layer.bodyFrom, at);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(20, layer.bodyTo),
    at + layer.bodyDecay
  );
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(layer.bodyGain, at);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + layer.bodyDecay);
  osc.connect(bodyGain).connect(target);
  osc.start(at);
  osc.stop(at + layer.bodyDecay + 0.02);
}

/**
 * Spielt einen Brett-Klang. Fehlt Web Audio oder ist der Ton abgeschaltet,
 * passiert nichts · Aufrufer müssen das nicht prüfen.
 *
 * `delaySeconds` staffelt mehrere Klänge desselben Zuges (Schlag + Schach),
 * damit sie nacheinander und nicht als ein Geräusch zu hören sind.
 */
export function playBoardSound(kind: BoardSoundKind, delaySeconds = 0): void {
  if (!enabled) return;
  const ctx = ensureContext();
  if (!ctx || !master) return;
  // Nach einem Tab-Wechsel steht der Kontext oft suspendiert da.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const now = ctx.currentTime + 0.005 + Math.max(0, delaySeconds);
  LAYERS[kind].forEach((layer, index) => {
    try {
      playLayer(ctx, master!, layer, now + index * LAYER_DELAY);
    } catch {
      /* Ein einzelner fehlgeschlagener Knoten darf den Zug nicht stören. */
    }
  });
}
