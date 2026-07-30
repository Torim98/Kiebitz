/**
 * Kurze, trockene Brettklänge ohne mitgelieferte Samples.
 *
 * Jeder Klang wird beim ersten Gebrauch als kleiner PCM-Puffer gerendert:
 * ein breitbandiger Kontaktimpuls regt mehrere unharmonische, rasch
 * abklingende Resonanzen an. Das wirkt eher wie Holz auf Holz als wie ein
 * gestimmter Synthesizer. Wie beim Lichess-Standardset bleiben nur drei
 * Ereignisse bewusst einfach und wiedererkennbar: Zug, Schlag und Fehler.
 */

export type BoardSoundKind =
  | "move"
  | "capture"
  | "error";

type AudioContextCtor = new () => AudioContext;

interface Mode {
  frequency: number;
  gain: number;
  decayMs: number;
}

interface Strike {
  /** Start innerhalb des Gesamtklangs. */
  atMs: number;
  gain: number;
  /** Durchlassbereich des kurzen Kontaktgeräuschs. */
  noiseLowHz: number;
  noiseHighHz: number;
  noiseGain: number;
  noiseDecayMs: number;
  modes: Mode[];
}

interface SoundDesign {
  durationMs: number;
  /** Zielspitze vor dem gemeinsamen Lautstärkeregler. */
  peak: number;
  strikes: Strike[];
}

/**
 * Keine Tonhöhenfahrten und keine langen Wellenformen: Unterschiede entstehen
 * ausschließlich durch Härte, Gewicht und Resonanz desselben Materials.
 */
const DESIGNS: Record<BoardSoundKind, SoundDesign> = {
  move: {
    durationMs: 170,
    peak: 0.36,
    strikes: [
      {
        atMs: 0,
        gain: 1,
        noiseLowHz: 740,
        noiseHighHz: 4800,
        noiseGain: 0.84,
        noiseDecayMs: 5.2,
        modes: [
          { frequency: 255, gain: 0.18, decayMs: 46 },
          { frequency: 720, gain: 0.13, decayMs: 33 },
          { frequency: 1540, gain: 0.05, decayMs: 18 },
        ],
      },
    ],
  },
  capture: {
    durationMs: 220,
    peak: 0.48,
    strikes: [
      {
        atMs: 0,
        gain: 1,
        noiseLowHz: 480,
        noiseHighHz: 5900,
        noiseGain: 0.96,
        noiseDecayMs: 6.8,
        modes: [
          { frequency: 185, gain: 0.26, decayMs: 58 },
          { frequency: 520, gain: 0.18, decayMs: 42 },
          { frequency: 1180, gain: 0.08, decayMs: 25 },
        ],
      },
    ],
  },
  error: {
    durationMs: 150,
    peak: 0.3,
    strikes: [
      {
        atMs: 0,
        gain: 1,
        noiseLowHz: 180,
        noiseHighHz: 1700,
        noiseGain: 0.52,
        noiseDecayMs: 7.5,
        modes: [
          { frequency: 125, gain: 0.22, decayMs: 54 },
          { frequency: 280, gain: 0.12, decayMs: 36 },
        ],
      },
    ],
  },
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.7;
let unavailable = false;
const buffers = new Map<string, AudioBuffer>();

export function setBoardSoundEnabled(on: boolean): void {
  enabled = on;
}

export function boardSoundEnabled(): boolean {
  return enabled;
}

/** 0 … 1; selbst bei 100 % bleibt ausreichend Headroom für schnelle Folgen. */
export function setBoardSoundVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  if (master && context) {
    master.gain.setValueAtTime(masterGain(volume), context.currentTime);
  }
}

function masterGain(value: number): number {
  // Der leicht gekrümmte Verlauf gibt dem unteren Teil des Reglers mehr Raum.
  return Math.pow(value, 1.2) * 0.62;
}

function audioCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
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
    gain.gain.value = masterGain(volume);
    gain.connect(ctx.destination);
    context = ctx;
    master = gain;
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

/** Kleiner deterministischer Generator für reproduzierbare Klangvarianten. */
function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function filterCoefficient(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
}

/**
 * Rendert exakt den Puffer, der später abgespielt wird. Der Export hält die
 * Synthese ohne AudioContext testbar.
 */
export function renderBoardSound(kind: BoardSoundKind, sampleRate: number): Float32Array {
  const design = DESIGNS[kind];
  const safeRate = Math.max(8000, Math.round(sampleRate));
  const output = new Float32Array(Math.ceil((design.durationMs / 1000) * safeRate));
  const kindSeed = Array.from(kind).reduce(
    (seed, character) => Math.imul(seed ^ character.charCodeAt(0), 16777619),
    0x4b494542
  );
  const random = randomGenerator(kindSeed);

  for (const strike of design.strikes) {
    const start = Math.round((strike.atMs / 1000) * safeRate);
    const lowAlpha = filterCoefficient(strike.noiseLowHz, safeRate);
    const highAlpha = filterCoefficient(strike.noiseHighHz, safeRate);
    let lowState = 0;
    let highState = 0;
    const phases = strike.modes.map(() => random() * Math.PI * 2);
    const detunes = strike.modes.map(() => 0.994 + random() * 0.012);

    for (let index = start; index < output.length; index++) {
      const seconds = (index - start) / safeRate;
      const ms = seconds * 1000;
      const white = random() * 2 - 1;
      lowState += lowAlpha * (white - lowState);
      highState += highAlpha * (white - highState);
      const contact =
        (highState - lowState) *
        strike.noiseGain *
        Math.exp(-ms / strike.noiseDecayMs);

      // Ein sehr kurzer Anstieg verhindert einen digitalen Sample-Klick,
      // ohne den eigentlichen Anschlag weichzuspülen.
      const attack = Math.min(1, ms / 0.45);
      let resonance = 0;
      for (let modeIndex = 0; modeIndex < strike.modes.length; modeIndex++) {
        const mode = strike.modes[modeIndex];
        resonance +=
          Math.sin(
            2 * Math.PI * mode.frequency * detunes[modeIndex] * seconds +
              phases[modeIndex]
          ) *
          mode.gain *
          attack *
          Math.exp(-ms / mode.decayMs);
      }
      output[index] += (contact + resonance) * strike.gain;
    }
  }

  // DC entfernen und die Summe sanft verdichten. Das hält Doppelschläge
  // kontrolliert, ohne den Kontaktimpuls hart abzuschneiden.
  let previousInput = 0;
  let previousOutput = 0;
  let peak = 0;
  for (let index = 0; index < output.length; index++) {
    const input = Math.tanh(output[index] * 1.08);
    const highPassed = input - previousInput + 0.995 * previousOutput;
    previousInput = input;
    previousOutput = highPassed;
    output[index] = highPassed;
    peak = Math.max(peak, Math.abs(highPassed));
  }

  const scale = peak > 0 ? design.peak / peak : 0;
  const fadeSamples = Math.min(output.length, Math.round(safeRate * 0.006));
  for (let index = 0; index < output.length; index++) {
    const remaining = output.length - 1 - index;
    const fade = remaining < fadeSamples ? remaining / fadeSamples : 1;
    output[index] *= scale * fade;
  }
  return output;
}

function soundBuffer(ctx: AudioContext, kind: BoardSoundKind): AudioBuffer {
  const key = `${ctx.sampleRate}:${kind}`;
  const cached = buffers.get(key);
  if (cached) return cached;
  const samples = renderBoardSound(kind, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  buffers.set(key, buffer);
  return buffer;
}

/**
 * Spielt einen Brettklang. Fehlt Web Audio oder ist der Ton abgeschaltet,
 * passiert nichts; Aufrufer müssen das nicht prüfen.
 */
export function playBoardSound(kind: BoardSoundKind, delaySeconds = 0): void {
  if (!enabled) return;
  const ctx = ensureContext();
  if (!ctx || !master) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const at = ctx.currentTime + 0.005 + Math.max(0, delaySeconds);
  try {
    const source = ctx.createBufferSource();
    source.buffer = soundBuffer(ctx, kind);
    source.connect(master);
    source.start(at);
  } catch {
    /* Ein fehlgeschlagener Klang darf keinen Zug unterbrechen. */
  }
}
