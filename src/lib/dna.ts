/**
 * Spieler-DNA: sechs Achsen, die aus der Tiefenanalyse ein Profil machen.
 *
 * Der Zweck ist Orientierung, nicht Präzision. Jede Achse sagt, wie gut etwas
 * *im Verhältnis zum eigenen Anspruch* läuft, auf einer Skala von 0 bis 100 mit
 * fest verdrahteten Grenzen. Wo das eigene Gegnerfeld ausgewertet werden kann,
 * steht dessen Wert daneben · das ist der aussagekräftigere Vergleich, weil er
 * aus denselben Partien stammt.
 *
 * Achsen ohne belastbare Datenmenge werden als `reliable: false` markiert und
 * in der Oberfläche gedämpft dargestellt, statt eine Zahl zu erfinden.
 */
import type { DeepInsights } from "./insights";
import type { LiveInsights } from "./stats";

export type DnaKey =
  | "tactics"
  | "opening"
  | "conversion"
  | "defense"
  | "time"
  | "consistency";

export interface DnaAxis {
  key: DnaKey;
  value: number;
  /** Derselbe Wert für das eigene Gegnerfeld; null, wenn nicht berechenbar. */
  field: number | null;
  reliable: boolean;
  /** Rohwert für den Tooltip, schon formatiert übergeben. */
  detail: string;
}

/** Linear auf 0..100 abbilden · `worst` und `best` dürfen invertiert sein. */
function scale(value: number, worst: number, best: number): number {
  if (worst === best) return 50;
  const t = (value - worst) / (best - worst);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

function avg(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function buildDna(deep: DeepInsights, live: LiveInsights): DnaAxis[] {
  const { content, benchmark, time, repertoire, sessions } = deep;

  // ── Taktik: wie oft geht etwas kaputt ─────────────────────────────────────
  const myBlunders = benchmark.me?.blunders_per_100 ?? null;
  const tactics: DnaAxis = {
    key: "tactics",
    // 6 Patzer je 100 Züge ist das untere Ende, 0,5 das obere.
    value: myBlunders == null ? 50 : scale(myBlunders, 6, 0.5),
    field:
      benchmark.field == null ? null : scale(benchmark.field.blunders_per_100, 6, 0.5),
    reliable: (benchmark.me?.moves ?? 0) >= 400,
    detail: myBlunders == null ? "—" : `${myBlunders}`,
  };

  // ── Eröffnung: Vorbereitung greift, wenn man im Buch bleibt ───────────────
  const openingAccuracy = live.phaseAccuracy.find((p) => p.phase === "opening");
  const bookGames = repertoire.by_side.reduce((sum, s) => sum + s.in_book, 0);
  const bookTotal = repertoire.by_side.reduce((sum, s) => sum + s.games, 0);
  const bookShare = bookTotal > 0 ? (bookGames / bookTotal) * 100 : null;
  const openingParts: number[] = [];
  if (openingAccuracy?.accuracy != null) {
    openingParts.push(scale(openingAccuracy.accuracy, 62, 94));
  }
  if (bookShare != null && repertoire.nodes > 0) {
    openingParts.push(scale(bookShare, 10, 75));
  }
  const opening: DnaAxis = {
    key: "opening",
    value: openingParts.length > 0 ? Math.round(avg(openingParts)) : 50,
    field: null,
    reliable: openingParts.length > 0 && (openingAccuracy?.games ?? 0) >= 15,
    detail:
      bookShare != null && repertoire.nodes > 0
        ? `${Math.round(bookShare)} %`
        : openingAccuracy?.accuracy != null
          ? `${openingAccuracy.accuracy} %`
          : "—",
  };

  // ── Verwertung: gewonnene Stellungen auch gewinnen ────────────────────────
  const conversion: DnaAxis = {
    key: "conversion",
    value: scale(content.conversion.score_pct, 55, 95),
    field: null,
    reliable: content.conversion.games >= 12,
    detail: `${content.conversion.score_pct} %`,
  };

  // ── Verteidigung: verlorene Stellungen noch retten ────────────────────────
  const defense: DnaAxis = {
    key: "defense",
    value: scale(content.defense.save_pct, 2, 35),
    field: null,
    reliable: content.defense.games >= 12,
    detail: `${content.defense.save_pct} %`,
  };

  // ── Zeit: Zeitnot vermeiden und dort denken, wo es zählt ──────────────────
  const timeParts: number[] = [];
  if (time.moves > 0) {
    timeParts.push(scale(time.trouble.share_pct, 25, 2));
    // Wer auf Fehlzügen weniger Zeit verbraucht als auf den übrigen, entscheidet
    // die kritischen Momente im Vorbeigehen.
    if (time.focus.ok_share > 0) {
      timeParts.push(scale(time.focus.error_share / time.focus.ok_share, 0.5, 1.3));
    }
  }
  const timeAxis: DnaAxis = {
    key: "time",
    value: timeParts.length > 0 ? Math.round(avg(timeParts)) : 50,
    field:
      benchmark.field?.trouble_pct == null
        ? null
        : scale(benchmark.field.trouble_pct, 25, 2),
    reliable: time.games >= 15 && time.moves >= 300,
    detail: time.moves > 0 ? `${time.trouble.share_pct} %` : "—",
  };

  // ── Konstanz: schwankt die Leistung, hält die Sitzung ─────────────────────
  const consistencyParts: number[] = [];
  if (live.accuracyConsistency != null) {
    consistencyParts.push(scale(live.accuracyConsistency, 15, 4));
  }
  const firstBucket = sessions.by_index[0];
  const lastBucket = sessions.by_index[sessions.by_index.length - 1];
  if (firstBucket && lastBucket && lastBucket.index > firstBucket.index && lastBucket.games >= 8) {
    consistencyParts.push(scale(firstBucket.score_pct - lastBucket.score_pct, 18, -4));
  }
  const consistency: DnaAxis = {
    key: "consistency",
    value: consistencyParts.length > 0 ? Math.round(avg(consistencyParts)) : 50,
    field: null,
    reliable: consistencyParts.length > 0 && live.totalGames >= 30,
    detail: live.accuracyConsistency == null ? "—" : `± ${live.accuracyConsistency}`,
  };

  return [tactics, opening, conversion, defense, timeAxis, consistency];
}

/** Die schwächste belastbare Achse · treibt die Empfehlung im Überblick. */
export function weakestAxis(axes: DnaAxis[]): DnaAxis | null {
  const usable = axes.filter((a) => a.reliable);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => a.value - b.value)[0];
}
