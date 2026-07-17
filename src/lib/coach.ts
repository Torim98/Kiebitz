/**
 * Coach: leitet aus den vorhandenen Daten (Partien, Puzzle-Versuche,
 * Fehlerstatistik) Trainingsempfehlungen ab. Reine Funktionen ohne
 * Backend-Zugriff — die Seite liefert die Rohdaten und rendert die Texte.
 */
import type { GameRecord } from "./db";
import type { PhaseErrors } from "./analysis";
import type { ThemeStat } from "./puzzles";

export interface OpeningRec {
  name: string;
  games: number;
  /** Punkte in % (Sieg = 1, Remis = 0,5). */
  scorePct: number;
}

export interface MotifRec {
  theme: string;
  attempts: number;
  solvedPct: number;
}

export interface TiltRec {
  /** 4-Stunden-Fenster, z. B. "20–24". */
  slot: string;
  games: number;
  winPct: number;
  overallPct: number;
}

export interface PhaseRec {
  phase: "opening" | "middlegame" | "endgame";
  blunders: number;
  mistakes: number;
  /** Anteil an allen schweren Fehlern in %. */
  sharePct: number;
}

export interface CoachReport {
  openings: OpeningRec[];
  motif: MotifRec | null;
  tilt: TiltRec | null;
  phase: PhaseRec | null;
}

/** Generische Lichess-Tags, die als "Motiv" nichts taugen. */
const GENERIC_THEMES = new Set([
  "short", "long", "veryLong", "oneMove", "advantage", "crushing", "equality",
  "mate", "middlegame", "opening", "endgame", "master", "masterVsMaster", "superGM",
]);

const SLOT_LABELS = ["0–4", "4–8", "8–12", "12–16", "16–20", "20–24"];

function scorePct(games: GameRecord[]): number {
  if (games.length === 0) return 0;
  const pts = games.reduce(
    (s, g) => s + (g.result === "win" ? 1 : g.result === "draw" ? 0.5 : 0),
    0
  );
  return Math.round((pts / games.length) * 1000) / 10;
}

/** Eröffnungen mit genug Partien und klar unterdurchschnittlichem Score. */
export function weakestOpenings(records: GameRecord[], minGames = 8): OpeningRec[] {
  const byOpening = new Map<string, GameRecord[]>();
  for (const g of records) {
    const name = g.opening.trim();
    if (!name) continue;
    byOpening.set(name, [...(byOpening.get(name) ?? []), g]);
  }
  return [...byOpening.entries()]
    .filter(([, gs]) => gs.length >= minGames)
    .map(([name, gs]) => ({ name, games: gs.length, scorePct: scorePct(gs) }))
    .filter((o) => o.scorePct < 48)
    .sort((a, b) => a.scorePct - b.scorePct)
    .slice(0, 2);
}

/** Schwächstes Puzzle-Motiv mit genug Versuchen. */
export function weakestMotif(themes: ThemeStat[], minAttempts = 5): MotifRec | null {
  const candidates = themes
    .filter((t) => !GENERIC_THEMES.has(t.theme) && t.attempts >= minAttempts)
    .map((t) => ({
      theme: t.theme,
      attempts: t.attempts,
      solvedPct: Math.round((t.solved / t.attempts) * 100),
    }))
    .filter((t) => t.solvedPct < 70)
    .sort((a, b) => a.solvedPct - b.solvedPct);
  return candidates[0] ?? null;
}

/** Tageszeit-Fenster mit deutlich schlechterer Siegquote als der Schnitt. */
export function tiltSlot(records: GameRecord[], minGames = 20): TiltRec | null {
  const timed = records.filter((g) => g.played_ts > 0);
  if (timed.length < minGames * 2) return null;
  const overall = Math.round(
    (timed.filter((g) => g.result === "win").length / timed.length) * 100
  );

  let worst: TiltRec | null = null;
  for (let slot = 0; slot < 6; slot++) {
    const gs = timed.filter(
      (g) => Math.floor(new Date(g.played_ts * 1000).getHours() / 4) === slot
    );
    if (gs.length < minGames) continue;
    const win = Math.round((gs.filter((g) => g.result === "win").length / gs.length) * 100);
    if (win <= overall - 7 && (!worst || win < worst.winPct)) {
      worst = { slot: SLOT_LABELS[slot], games: gs.length, winPct: win, overallPct: overall };
    }
  }
  return worst;
}

/** Spielphase, in der die schweren Fehler gehäuft passieren. */
export function worstPhase(stats: PhaseErrors[]): PhaseRec | null {
  const weighted = stats.map((s) => ({
    phase: s.phase,
    blunders: s.blunder,
    mistakes: s.mistake,
    w: s.blunder * 3 + s.mistake,
  }));
  const total = weighted.reduce((s, p) => s + p.w, 0);
  const serious = stats.reduce((s, p) => s + p.blunder + p.mistake, 0);
  if (serious < 5 || total === 0) return null;
  const top = [...weighted].sort((a, b) => b.w - a.w)[0];
  const sharePct = Math.round((top.w / total) * 100);
  // Ohne klaren Schwerpunkt (< 40 %) lieber keine Empfehlung.
  if (sharePct < 40) return null;
  return { phase: top.phase, blunders: top.blunders, mistakes: top.mistakes, sharePct };
}

export function buildCoach(
  records: GameRecord[],
  themes: ThemeStat[],
  phaseErrors: PhaseErrors[]
): CoachReport {
  return {
    openings: weakestOpenings(records),
    motif: weakestMotif(themes),
    tilt: tiltSlot(records),
    phase: worstPhase(phaseErrors),
  };
}
