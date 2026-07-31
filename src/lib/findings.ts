/**
 * Befund-Engine.
 *
 * Aus allen Kennzahlen entsteht hier eine *sortierte* Liste konkreter Aussagen.
 * Das ist der Kern gegen die Überladung: die Reiter zeigen Zahlen, aber was
 * davon gerade wichtig ist, entscheidet diese Datei einmal zentral · der
 * Überblick zeigt die Spitze, jeder Reiter seine eigenen, und der Study-Coach
 * greift auf dieselbe Liste zu.
 *
 * Jede Regel prüft zuerst die Datenmenge. Lieber kein Befund als einer aus
 * zwölf Partien · genau daran verlieren Statistikseiten ihre Glaubwürdigkeit.
 */
import type { Key, Locale, TFunc } from "./i18n";
import type { DeepInsights, OpeningFamily } from "./insights";
import type { LiveInsights } from "./stats";
import type { Area } from "./study";
import { themeLabel } from "./puzzles";
import { tcLabel } from "./gameUi";
import { toReference } from "./formatScale";

export type FindingTab = "strength" | "time" | "openings" | "patterns" | "training";

export type Tone = "bad" | "warn" | "good";

export interface FindingAction {
  kind: "repertoire" | "puzzles" | "endgame" | "analysis" | "games";
  /** Motiv für den Puzzle-Trainer. */
  theme?: string;
  /** Ratingband für den Puzzle-Trainer. */
  minRating?: number;
  maxRating?: number;
}

/**
 * Wo ein Befund angepackt wird, und wie gut Kiebitz das kann.
 *
 * `trainability` ist der ehrliche Teil: „Zeitnot" lässt sich üben, „das
 * Gegnerfeld ist stärker geworden" nicht. Ohne diesen Faktor würde die
 * Budgetverteilung Aufwand auf Dinge lenken, an denen kein Training etwas
 * ändert. `plan.ts` gewichtet damit die Bedarfsrechnung.
 */
export interface FindingLever {
  area: Area;
  /** 0 … 1 */
  trainability: number;
}

export interface Finding {
  id: string;
  /** 0..100 · bestimmt die Reihenfolge und was der Überblick zeigt. */
  severity: number;
  tone: Tone;
  tab: FindingTab;
  titleKey: Key;
  bodyKey: Key;
  params: Record<string, string | number>;
  action?: FindingAction;
  lever?: FindingLever;
  /**
   * Kennzahl aus `study_metrics`, an der sich zeigt, ob das Training wirkt.
   * Nur gesetzt, wo die Kausalkette kurz genug ist, um sie ehrlich zu messen.
   */
  metricKey?: string;
}

/** Phase → Bereich · dieselbe Zuordnung an drei Stellen wäre eine zu viel. */
const PHASE_AREA: Record<string, Area> = {
  opening: "openings",
  middlegame: "tactics",
  endgame: "endgames",
};

/** Effektstärke × Stichprobenvertrauen, gedeckelt auf 0..100. */
function severity(effect: number, sample: number, needed: number): number {
  const confidence = Math.min(1, sample / needed);
  return Math.round(Math.max(0, Math.min(100, effect)) * confidence);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildFindings(deep: DeepInsights, live: LiveInsights): Finding[] {
  const out: Finding[] = [];
  const { time, content, benchmark, sessions, progress, repertoire, formats } = deep;
  const push = (finding: Finding) => out.push(finding);

  // ── Block A · Zeit ────────────────────────────────────────────────────────

  const instant = time.by_speed.find((b) => b.key === "instant");
  const deliberate = time.by_speed.filter((b) => b.key === "normal" || b.key === "long");
  const deliberateMoves = deliberate.reduce((sum, b) => sum + b.moves, 0);
  const deliberateErrors = deliberate.reduce((sum, b) => sum + b.errors, 0);
  const deliberateRate = deliberateMoves > 0 ? (deliberateErrors / deliberateMoves) * 100 : 0;
  if (instant && instant.moves >= 150 && deliberateMoves >= 150 && instant.errors_per_100 > deliberateRate * 1.3) {
    push({
      id: "time-rush",
      lever: { area: "play", trainability: 0.8 },
      metricKey: "blunders_per100",
      severity: severity((instant.errors_per_100 - deliberateRate) * 12, instant.moves, 400),
      tone: "bad",
      tab: "time",
      titleKey: "fnd.rushTitle",
      bodyKey: "fnd.rushBody",
      params: {
        fast: round(instant.errors_per_100),
        slow: round(deliberateRate),
        n: instant.moves,
      },
    });
  }

  if (time.trouble.moves >= 100 && time.trouble.share_pct >= 8) {
    const worse = time.trouble.errors_per_100 - time.trouble.baseline_per_100;
    push({
      id: "time-trouble",
      lever: { area: "play", trainability: 0.9 },
      metricKey: "trouble_pct",
      severity: severity(time.trouble.share_pct * 2 + worse * 6, time.trouble.moves, 300),
      tone: time.trouble.share_pct >= 15 ? "bad" : "warn",
      tab: "time",
      titleKey: "fnd.troubleTitle",
      bodyKey: "fnd.troubleBody",
      params: {
        p: round(time.trouble.share_pct),
        e: round(time.trouble.errors_per_100),
        b: round(time.trouble.baseline_per_100),
        m: round(time.trouble.first_move),
      },
    });
  }

  if (time.focus.error_share > 0 && time.focus.ok_share > 0 && time.focus.error_share < time.focus.ok_share * 0.8) {
    push({
      id: "time-focus",
      lever: { area: "play", trainability: 0.6 },
      severity: severity(
        (1 - time.focus.error_share / time.focus.ok_share) * 130,
        time.focus.balanced_moves + time.focus.decided_moves,
        400
      ),
      tone: "warn",
      tab: "time",
      titleKey: "fnd.focusTitle",
      bodyKey: "fnd.focusBody",
      params: { e: round(time.focus.error_share), o: round(time.focus.ok_share) },
    });
  }

  if (time.theory.book_moves >= 60 && time.theory.book_share_pct >= 20) {
    push({
      id: "time-theory",
      lever: { area: "openings", trainability: 0.9 },
      metricKey: "in_book_pct",
      severity: severity(time.theory.book_share_pct * 2, time.theory.book_moves, 200),
      tone: "warn",
      tab: "time",
      titleKey: "fnd.theoryTitle",
      bodyKey: "fnd.theoryBody",
      params: { p: round(time.theory.book_share_pct), n: time.theory.book_moves },
      action: { kind: "repertoire" },
    });
  }

  if (time.trouble.flag_losses >= 3) {
    push({
      id: "time-flag",
      lever: { area: "play", trainability: 0.9 },
      metricKey: "trouble_pct",
      severity: severity(time.trouble.flag_losses * 8, time.games, 40),
      tone: "bad",
      tab: "time",
      titleKey: "fnd.flagTitle",
      bodyKey: "fnd.flagBody",
      params: { n: time.trouble.flag_losses, g: time.games },
    });
  }

  if (time.edge.games >= 30 && Math.abs(time.edge.ahead_score - time.edge.behind_score) >= 8) {
    push({
      id: "time-edge",
      lever: { area: "play", trainability: 0.5 },
      severity: severity(Math.abs(time.edge.ahead_score - time.edge.behind_score) * 2, time.edge.games, 80),
      tone: "warn",
      tab: "time",
      titleKey: "fnd.edgeTitle",
      bodyKey: "fnd.edgeBody",
      params: {
        a: round(time.edge.ahead_score),
        b: round(time.edge.behind_score),
        d: round(time.edge.avg_diff),
      },
    });
  }

  // ── Block B · Repertoire ──────────────────────────────────────────────────

  for (const side of repertoire.by_side) {
    if (side.mine < 8) continue;
    const gap = side.theirs_score - side.mine_score;
    if (gap < 6) continue;
    push({
      id: `rep-deviation-${side.side}`,
      lever: { area: "openings", trainability: 1 },
      metricKey: "in_book_pct",
      severity: severity(gap * 3, side.mine, 25),
      tone: "bad",
      tab: "openings",
      titleKey: "fnd.deviationTitle",
      bodyKey: "fnd.deviationBody",
      params: {
        side: side.side,
        n: side.mine,
        p: round(side.mine_score),
        o: round(side.theirs_score),
        m: round(side.avg_mine_move),
      },
      action: { kind: "repertoire" },
    });
  }

  const shaky = repertoire.shaky.filter((line) => line.games >= 3)[0];
  if (shaky) {
    push({
      id: "rep-shaky",
      lever: { area: "openings", trainability: 1.0 },
      metricKey: "in_book_pct",
      severity: severity(shaky.lapses * 10, shaky.games, 6),
      tone: "warn",
      tab: "openings",
      titleKey: "fnd.shakyTitle",
      bodyKey: "fnd.shakyBody",
      params: { line: shaky.line, n: shaky.lapses, g: shaky.games },
      action: { kind: "repertoire" },
    });
  }

  // ── Block C · Partieinhalt ────────────────────────────────────────────────

  if (content.conversion.games >= 12 && content.conversion.score_pct < 82) {
    push({
      id: "conversion",
      lever: { area: PHASE_AREA[content.conversion.phase] ?? "tactics", trainability: 0.7 },
      metricKey: "acc_endgame",
      severity: severity((82 - content.conversion.score_pct) * 2.5, content.conversion.games, 30),
      tone: content.conversion.score_pct < 70 ? "bad" : "warn",
      tab: "strength",
      titleKey: "fnd.conversionTitle",
      bodyKey: "fnd.conversionBody",
      params: {
        n: content.conversion.games,
        w: content.conversion.won,
        p: round(content.conversion.score_pct),
        m: round(content.conversion.lost_at_move),
        phase: content.conversion.phase,
      },
      action: { kind: content.conversion.phase === "endgame" ? "endgame" : "puzzles" },
    });
  }

  if (content.defense.games >= 12 && content.defense.save_pct >= 18) {
    push({
      id: "defense-good",
      severity: severity(content.defense.save_pct * 1.2, content.defense.games, 30),
      tone: "good",
      tab: "strength",
      titleKey: "fnd.defenseTitle",
      bodyKey: "fnd.defenseBody",
      params: { p: round(content.defense.save_pct), n: content.defense.games, s: content.defense.saved },
    });
  }

  if (content.punishment.chances >= 25 && content.punishment.missed_pct >= 35) {
    push({
      id: "punishment",
      lever: { area: "tactics", trainability: 0.9 },
      metricKey: "blunders_middlegame_per100",
      severity: severity(content.punishment.missed_pct * 1.4, content.punishment.chances, 60),
      tone: "bad",
      tab: "strength",
      titleKey: "fnd.punishTitle",
      bodyKey: "fnd.punishBody",
      params: {
        p: round(content.punishment.missed_pct),
        n: content.punishment.chances,
        m: content.punishment.missed,
      },
      action: { kind: "puzzles" },
    });
  }

  const anatomy = content.anatomy;
  if (anatomy.errors >= 25 && anatomy.forcing_pct > anatomy.forcing_base_pct + 10) {
    push({
      id: "forcing",
      lever: { area: "tactics", trainability: 0.9 },
      metricKey: "blunders_per100",
      severity: severity((anatomy.forcing_pct - anatomy.forcing_base_pct) * 2.5, anatomy.errors, 60),
      tone: "bad",
      tab: "strength",
      titleKey: "fnd.forcingTitle",
      bodyKey: "fnd.forcingBody",
      params: { p: round(anatomy.forcing_pct), b: round(anatomy.forcing_base_pct), n: anatomy.errors },
      action: { kind: "puzzles" },
    });
  }

  const pieces = anatomy.by_piece.filter((p) => p.moves >= 120);
  if (pieces.length >= 3) {
    const overall = anatomy.by_piece.reduce((sum, p) => sum + p.errors, 0) /
      Math.max(1, anatomy.by_piece.reduce((sum, p) => sum + p.moves, 0)) * 100;
    const worst = [...pieces].sort((a, b) => b.errors_per_100 - a.errors_per_100)[0];
    if (worst.errors_per_100 > overall * 1.5 && worst.errors >= 10) {
      push({
        id: `piece-${worst.piece}`,
        lever: { area: "tactics", trainability: 0.5 },
        severity: severity((worst.errors_per_100 - overall) * 14, worst.moves, 300),
        tone: "warn",
        tab: "strength",
        titleKey: "fnd.pieceTitle",
        bodyKey: "fnd.pieceBody",
        params: {
          piece: worst.piece,
          p: round(worst.errors_per_100),
          o: round(overall),
          n: worst.errors,
        },
      });
    }
  }

  const endgame = content.endgames.filter((e) => e.games >= 6).sort((a, b) => a.score_pct - b.score_pct)[0];
  if (endgame && endgame.score_pct < 42) {
    push({
      id: `endgame-${endgame.key}`,
      lever: { area: "endgames", trainability: 0.9 },
      metricKey: "acc_endgame",
      severity: severity((50 - endgame.score_pct) * 2, endgame.games, 15),
      tone: "warn",
      tab: "strength",
      titleKey: "fnd.endgameTitle",
      bodyKey: "fnd.endgameBody",
      params: { type: endgame.key, p: round(endgame.score_pct), n: endgame.games },
      action: { kind: "endgame" },
    });
  }

  // ── Block D · Feld-Vergleich ──────────────────────────────────────────────

  if (benchmark.me && benchmark.field && benchmark.games >= 20) {
    const mine = benchmark.me.blunders_per_100;
    const theirs = benchmark.field.blunders_per_100;
    const relative = theirs > 0 ? (mine - theirs) / theirs : 0;
    if (Math.abs(relative) >= 0.12) {
      push({
        id: "bench-blunders",
      lever: { area: "tactics", trainability: 0.8 },
      metricKey: "blunders_per100",
        severity: severity(Math.abs(relative) * 130, benchmark.me.moves, 800),
        tone: relative > 0 ? "bad" : "good",
        tab: "strength",
        titleKey: relative > 0 ? "fnd.benchWorseTitle" : "fnd.benchBetterTitle",
        bodyKey: relative > 0 ? "fnd.benchWorseBody" : "fnd.benchBetterBody",
        params: {
          m: round(mine),
          f: round(theirs),
          n: benchmark.games,
          elo: benchmark.avg_opp_elo,
        },
      });
    }

    // Die Phase, in der der Abstand zum Feld am größten ist.
    const gaps = benchmark.me.by_phase
      .map((phase) => {
        const other = benchmark.field!.by_phase.find((p) => p.phase === phase.phase);
        return other && phase.moves >= 200
          ? { phase: phase.phase, gap: phase.blunders_per_100 - other.blunders_per_100, mine: phase.blunders_per_100, theirs: other.blunders_per_100 }
          : null;
      })
      .filter((g): g is NonNullable<typeof g> => g != null)
      .sort((a, b) => b.gap - a.gap);
    if (gaps[0] && gaps[0].gap > 0.5) {
      push({
        id: `bench-phase-${gaps[0].phase}`,
        lever: { area: PHASE_AREA[gaps[0].phase] ?? "tactics", trainability: 0.8 },
        metricKey: `blunders_${gaps[0].phase}_per100`,
        severity: severity(gaps[0].gap * 22, benchmark.games, 40),
        tone: "warn",
        tab: "strength",
        titleKey: "fnd.benchPhaseTitle",
        bodyKey: "fnd.benchPhaseBody",
        params: {
          phase: gaps[0].phase,
          m: round(gaps[0].mine),
          f: round(gaps[0].theirs),
        },
        action: { kind: gaps[0].phase === "endgame" ? "endgame" : "puzzles" },
      });
    }
  }

  // ── Block E · Sessions ────────────────────────────────────────────────────

  if (sessions.recommended_length > 0) {
    const first = sessions.by_index[0];
    const drop = sessions.by_index.find((b) => b.index === sessions.recommended_length + 1);
    if (first && drop) {
      push({
        id: "session-length",
      lever: { area: "play", trainability: 0.9 },
      metricKey: "score_pct",
        severity: severity((first.score_pct - drop.score_pct) * 3, drop.games, 25),
        tone: "warn",
        tab: "patterns",
        titleKey: "fnd.sessionTitle",
        bodyKey: "fnd.sessionBody",
        params: {
          n: sessions.recommended_length,
          a: round(first.score_pct),
          b: round(drop.score_pct),
          g: drop.games,
        },
      });
    }
  }

  if (sessions.requeue.fast_games >= 10 && sessions.requeue.fast_score < sessions.requeue.slow_score - 6) {
    push({
      id: "requeue",
      lever: { area: "play", trainability: 0.9 },
      metricKey: "score_pct",
      severity: severity((sessions.requeue.slow_score - sessions.requeue.fast_score) * 3, sessions.requeue.fast_games, 30),
      tone: "bad",
      tab: "patterns",
      titleKey: "fnd.requeueTitle",
      bodyKey: "fnd.requeueBody",
      params: {
        f: round(sessions.requeue.fast_score),
        s: round(sessions.requeue.slow_score),
        n: sessions.requeue.fast_games,
        t: Math.round(sessions.requeue.threshold / 60),
      },
    });
  }

  if (sessions.warmup.primed_games >= 10 && sessions.warmup.cold_games >= 10) {
    const gap = sessions.warmup.primed_score - sessions.warmup.cold_score;
    if (Math.abs(gap) >= 5) {
      push({
        id: "warmup",
      lever: { area: "play", trainability: 0.7 },
        severity: severity(Math.abs(gap) * 3, Math.min(sessions.warmup.primed_games, sessions.warmup.cold_games), 25),
        tone: gap > 0 ? "good" : "warn",
        tab: "patterns",
        titleKey: gap > 0 ? "fnd.warmupTitle" : "fnd.warmupColdTitle",
        bodyKey: gap > 0 ? "fnd.warmupBody" : "fnd.warmupColdBody",
        params: {
          p: round(sessions.warmup.primed_score),
          c: round(sessions.warmup.cold_score),
          n: sessions.warmup.primed_games,
        },
        action: { kind: "puzzles" },
      });
    }
  }

  if (sessions.damage.sessions >= 15 && sessions.damage.worst3_pct >= 45 && sessions.damage.total_loss < -30) {
    push({
      id: "session-damage",
      lever: { area: "play", trainability: 0.7 },
      metricKey: "score_pct",
      severity: severity(sessions.damage.worst3_pct, sessions.damage.sessions, 30),
      tone: "warn",
      tab: "patterns",
      titleKey: "fnd.damageTitle",
      bodyKey: "fnd.damageBody",
      params: {
        p: round(sessions.damage.worst3_pct),
        n: sessions.damage.sessions,
        d: Math.abs(sessions.damage.worst_delta),
      },
    });
  }

  // ── Block F · Fortschritt ─────────────────────────────────────────────────

  if (progress.accuracy_delta != null && progress.rating_delta != null && progress.months.length >= 6) {
    if (progress.accuracy_delta >= 1.5 && progress.rating_delta <= 0) {
      push({
        id: "progress-lagging",
        severity: severity(progress.accuracy_delta * 12, progress.months.length, 8),
        tone: "good",
        tab: "training",
        titleKey: "fnd.progressLagTitle",
        bodyKey: "fnd.progressLagBody",
        params: { a: round(progress.accuracy_delta), r: progress.rating_delta },
      });
    } else if (progress.accuracy_delta <= -1.5) {
      push({
        id: "progress-down",
      lever: { area: "tactics", trainability: 0.5 },
      metricKey: "acc_overall",
        severity: severity(Math.abs(progress.accuracy_delta) * 14, progress.months.length, 8),
        tone: "bad",
        tab: "training",
        titleKey: "fnd.progressDownTitle",
        bodyKey: "fnd.progressDownBody",
        params: { a: round(Math.abs(progress.accuracy_delta)) },
      });
    }
  }

  const improving = progress.themes.filter((t) => t.delta >= 8)[0];
  if (improving) {
    push({
      id: `theme-${improving.theme}`,
      severity: severity(improving.delta * 2, improving.attempts, 40),
      tone: "good",
      tab: "training",
      titleKey: "fnd.themeUpTitle",
      bodyKey: "fnd.themeUpBody",
      params: {
        theme: improving.theme,
        d: round(improving.delta),
        e: round(improving.early_pct),
        l: round(improving.late_pct),
      },
      action: { kind: "puzzles", theme: improving.theme },
    });
  }

  const repEffect = progress.rep_effect;
  if (repEffect.before_games >= 10 && repEffect.after_games >= 10) {
    const gap = repEffect.after_score - repEffect.before_score;
    if (Math.abs(gap) >= 6) {
      push({
        id: "rep-effect",
      lever: { area: "openings", trainability: 0.8 },
      metricKey: "in_book_pct",
        severity: severity(Math.abs(gap) * 2.5, Math.min(repEffect.before_games, repEffect.after_games), 25),
        tone: gap > 0 ? "good" : "warn",
        tab: "training",
        titleKey: gap > 0 ? "fnd.repEffectTitle" : "fnd.repEffectFlatTitle",
        bodyKey: gap > 0 ? "fnd.repEffectBody" : "fnd.repEffectFlatBody",
        params: {
          a: round(repEffect.after_score),
          b: round(repEffect.before_score),
          n: repEffect.after_games,
        },
        action: { kind: "repertoire" },
      });
    }
  }

  // ── Block H · Zeitformate ─────────────────────────────────────────────────

  const rated = formats.formats.filter((f) => f.games >= 20 && f.perf_edge != null);
  if (rated.length >= 2) {
    const best = [...rated].sort((a, b) => (b.perf_edge ?? 0) - (a.perf_edge ?? 0))[0];
    const busiest = [...rated].sort((a, b) => b.games - a.games)[0];
    const totalGames = rated.reduce((sum, f) => sum + f.games, 0);
    if (best.key !== busiest.key && (best.perf_edge ?? 0) - (busiest.perf_edge ?? 0) >= 25) {
      push({
        id: "format-mismatch",
      lever: { area: "play", trainability: 1.0 },
        severity: severity((best.perf_edge! - busiest.perf_edge!) / 2, best.games, 40),
        tone: "warn",
        tab: "time",
        titleKey: "fnd.formatTitle",
        bodyKey: "fnd.formatBody",
        params: {
          best: best.time_class,
          busy: busiest.time_class,
          e: best.perf_edge!,
          o: busiest.perf_edge!,
          p: Math.round((busiest.games / totalGames) * 100),
        },
      });
    }
  }

  const skilled = formats.formats.filter((f) => f.analyzed >= 5 && f.blunders_per_100 != null);
  if (skilled.length >= 2) {
    const sorted = [...skilled].sort((a, b) => a.blunders_per_100! - b.blunders_per_100!);
    const cleanest = sorted[0];
    const messiest = sorted[sorted.length - 1];
    if (messiest.blunders_per_100! >= cleanest.blunders_per_100! * 1.6) {
      push({
        id: "format-skill",
      lever: { area: "play", trainability: 0.8 },
        severity: severity((messiest.blunders_per_100! - cleanest.blunders_per_100!) * 20, messiest.analyzed, 20),
        tone: "warn",
        tab: "time",
        titleKey: "fnd.formatSkillTitle",
        bodyKey: "fnd.formatSkillBody",
        params: {
          clean: cleanest.time_class,
          messy: messiest.time_class,
          c: round(cleanest.blunders_per_100!),
          m: round(messiest.blunders_per_100!),
        },
      });
    }
  }

  // Formstärke aus der bestehenden Auswertung · sie gehört mit in die Liste,
  // damit der Überblick nicht an ihr vorbeisortiert.
  if (live.recentForm.previousScorePct != null && live.recentForm.games >= 20) {
    const gap = live.recentForm.scorePct - live.recentForm.previousScorePct;
    if (Math.abs(gap) >= 8) {
      push({
        id: "form",
      lever: { area: "play", trainability: 0.4 },
        severity: severity(Math.abs(gap) * 2, live.recentForm.games, 20),
        tone: gap > 0 ? "good" : "warn",
        tab: "patterns",
        titleKey: gap > 0 ? "fnd.formUpTitle" : "fnd.formDownTitle",
        bodyKey: gap > 0 ? "fnd.formUpBody" : "fnd.formDownBody",
        params: { p: Math.abs(gap), n: live.recentForm.games },
      });
    }
  }

  // ── Block I · Eröffnungsfamilien ──────────────────────────────────────────
  //
  // Zwei Fragen, ein Datensatz: als Weiß steht hier, was die eigene Wahl
  // einbringt, als Schwarz, gegen welches System die Vorbereitung nicht hält.

  for (const family of weakestFamilies(deep.openings.families, deep.openings.baseline_score)) {
    const gap = deep.openings.baseline_score - family.score_pct;
    const asWhite = family.color === "white";
    push({
      id: `opening-${family.color}-${family.key}`,
      lever: { area: "openings", trainability: 1 },
      metricKey: "acc_opening",
      // Der Verlust zählt doppelt: wie groß der Abstand ist *und* wie oft die
      // Familie vorkommt. Eine schwache Eröffnung, die zweimal im Jahr aufs
      // Brett kommt, ist kein Trainingsziel.
      severity: severity(gap * 2 + family.games * 0.4, family.games, 14),
      tone: gap >= 12 ? "bad" : "warn",
      tab: "openings",
      titleKey: asWhite ? "fnd.openMineTitle" : "fnd.openFacedTitle",
      bodyKey: asWhite ? "fnd.openMineBody" : "fnd.openFacedBody",
      params: {
        name: family.label,
        p: round(family.score_pct),
        b: round(deep.openings.baseline_score),
        n: family.games,
        m: family.avg_departure_ply > 0 ? Math.ceil(family.avg_departure_ply / 2) : 0,
      },
      action: { kind: "repertoire" },
    });
  }

  // ── Modus: Spielstärke poolbereinigt ──────────────────────────────────────
  //
  // Ratings verschiedener Formate stehen in getrennten Pools · 1100 Blitz und
  // 1100 Rapid sind nicht dasselbe. Erst die Umrechnung auf eine Referenzskala
  // macht die Frage „wo bin ich eigentlich stärker" beantwortbar; roh
  // verglichen käme regelmäßig das Gegenteil heraus.
  const scaled = formats.formats
    .filter((format) => format.games >= 15 && format.rating != null)
    .map((format) => ({
      format,
      scale: toReference(format.rating, format.source, format.time_class),
    }))
    .filter((entry): entry is { format: (typeof formats.formats)[number]; scale: NonNullable<ReturnType<typeof toReference>> } => entry.scale != null);
  if (scaled.length >= 2) {
    const best = [...scaled].sort((a, b) => b.scale.value - a.scale.value)[0];
    const busiest = [...scaled].sort((a, b) => b.format.games - a.format.games)[0];
    const totalGames = scaled.reduce((sum, entry) => sum + entry.format.games, 0);
    const edge = best.scale.value - busiest.scale.value;
    // 60 Referenzpunkte sind rund eine Klasse · darunter lohnt kein Umzug.
    if (best.format.key !== busiest.format.key && edge >= 60) {
      push({
        id: "format-pool",
        lever: { area: "play", trainability: 1 },
        metricKey: "score_pct",
        severity: severity(edge / 2, Math.min(best.format.games, busiest.format.games), 40),
        tone: "warn",
        tab: "time",
        titleKey: "fnd.poolTitle",
        bodyKey: "fnd.poolBody",
        params: {
          best: best.format.time_class,
          busy: busiest.format.time_class,
          bestValue: best.scale.value,
          busyValue: busiest.scale.value,
          bestRaw: best.format.rating ?? 0,
          busyRaw: busiest.format.rating ?? 0,
          p: Math.round((busiest.format.games / totalGames) * 100),
          confidence: best.scale.confidence === "measured" && busiest.scale.confidence === "measured"
            ? "measured"
            : "estimated",
        },
      });
    }
  }

  // ── Analyse-Rückstand ─────────────────────────────────────────────────────
  //
  // Alles auf dieser Seite hängt an analysierten Partien. Ist die Abdeckung
  // dünn, ist der Rückstand selbst der wichtigste Befund.
  if (deep.coverage.games >= 30) {
    const covered = (deep.coverage.analyzed / deep.coverage.games) * 100;
    if (covered < 60) {
      push({
        id: "coverage-low",
        lever: { area: "analysis", trainability: 1 },
        severity: severity((60 - covered) * 1.5, deep.coverage.games, 60),
        tone: covered < 30 ? "bad" : "warn",
        tab: "training",
        titleKey: "fnd.coverageTitle",
        bodyKey: "fnd.coverageBody",
        params: {
          p: Math.round(covered),
          n: deep.coverage.games - deep.coverage.analyzed,
        },
        action: { kind: "analysis" },
      });
    }
  }

  return out.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

/**
 * Die Eröffnungsfamilien, die am meisten kosten: Abstand zum eigenen Schnitt
 * mal Häufigkeit. Je Farbe höchstens eine · sonst besteht die Liste am Ende
 * nur noch aus Eröffnungen.
 */
export function weakestFamilies(
  families: OpeningFamily[],
  baseline: number,
  minGames = 8,
  minGap = 6
): OpeningFamily[] {
  const out: OpeningFamily[] = [];
  for (const color of ["white", "black"] as const) {
    const worst = families
      .filter((family) => family.color === color && family.games >= minGames)
      .filter((family) => baseline - family.score_pct >= minGap)
      .sort(
        (a, b) =>
          (baseline - b.score_pct) * b.games - (baseline - a.score_pct) * a.games
      )[0];
    if (worst) out.push(worst);
  }
  return out;
}

/**
 * Befunde tragen Rohwerte als Parameter ("white", "endgame", "rook", "blitz"),
 * damit diese Datei ohne Übersetzer auskommt. Übersetzt wird kurz vor dem
 * Einsetzen in den Satz · Insights und Study nutzen dieselbe Funktion.
 */
export function localizeFindingParams(
  params: Record<string, string | number>,
  t: TFunc,
  locale: Locale
): Record<string, string | number> {
  const out = { ...params };
  if (typeof out.side === "string") {
    out.side = t(out.side === "white" ? "common.white" : "common.black");
  }
  if (typeof out.phase === "string") out.phase = t(`ins.phase.${out.phase}` as Key);
  if (typeof out.type === "string") out.type = t(`ins.endgame.${out.type}` as Key);
  if (typeof out.piece === "string") out.piece = t(`ins.piece.${out.piece}` as Key);
  if (typeof out.theme === "string") out.theme = themeLabel(out.theme, locale);
  for (const key of ["best", "busy", "clean", "messy"]) {
    if (typeof out[key] === "string") out[key] = tcLabel(out[key] as string, locale);
  }
  return out;
}

/** Befunde eines Reiters · die Reiter zeigen ihre eigenen oben an. */
export function findingsFor(findings: Finding[], tab: FindingTab): Finding[] {
  return findings.filter((f) => f.tab === tab);
}

/**
 * Was der Überblick zeigt: die dringendsten Probleme, aber höchstens ein
 * Lob · sonst liest sich die Seite wie eine Urkunde statt wie ein Befund.
 */
export function topFindings(findings: Finding[], limit = 4): Finding[] {
  const bad = findings.filter((f) => f.tone !== "good");
  const good = findings.filter((f) => f.tone === "good");
  return [...bad.slice(0, limit - 1), ...good.slice(0, 1)]
    .sort((a, b) => b.severity - a.severity)
    .slice(0, limit);
}
