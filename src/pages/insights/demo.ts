/**
 * Demo-Daten für die Web-Vorschau.
 *
 * Die Zahlen sind erfunden, aber plausibel und untereinander stimmig · sie
 * sollen zeigen, wie die Seite mit echten Daten aussieht, und die Befund-Engine
 * so füttern, dass tatsächlich Befunde entstehen.
 */
import type { DeepInsights } from "../../lib/insights";
import type { GameRecord } from "../../lib/db";
import type { PhaseErrors } from "../../lib/analysis";
import type { PuzzleInsights } from "../../lib/puzzles";

const DEMO_OPENINGS = [
  "Italian Game",
  "Sicilian Defense",
  "Queen's Gambit",
  "Caro-Kann Defense",
  "London System",
];

export const DEMO_RECORDS: GameRecord[] = Array.from({ length: 96 }, (_, index) => {
  const playedTs = Math.floor(Date.now() / 1000) - (95 - index) * 3 * 86_400;
  const result = index % 7 < 3 ? "win" : index % 7 < 5 ? "loss" : "draw";
  const color = index % 2 === 0 ? "white" : "black";
  return {
    id: index + 1,
    source: index % 3 === 0 ? "lichess" : "chess.com",
    source_id: `demo-${index}`,
    url: "",
    played_at: new Date(playedTs * 1000).toISOString().slice(0, 10),
    played_ts: playedTs,
    time_class: index % 4 === 0 ? "blitz" : "rapid",
    color,
    opponent: `Opponent ${index + 1}`,
    opp_elo: 1380 + (index % 240),
    my_elo: 1460 + Math.floor(index / 8),
    result,
    opening: DEMO_OPENINGS[index % DEMO_OPENINGS.length],
    eco: "",
    moves_count: 16 + (index % 38),
    accuracy: 72 + (index % 19),
    accuracy_opening: 78 + (index % 14),
    accuracy_middlegame: 70 + (index % 20),
    accuracy_endgame: index % 3 === 0 ? 74 + (index % 16) : null,
    moves: "",
    note: "",
    tags: [],
    analyzed: index % 8 !== 0,
  } as GameRecord;
});

export const DEMO_ERRORS: PhaseErrors[] = [
  { phase: "opening", inaccuracy: 18, mistake: 7, blunder: 3 },
  { phase: "middlegame", inaccuracy: 29, mistake: 14, blunder: 8 },
  { phase: "endgame", inaccuracy: 12, mistake: 9, blunder: 5 },
];

export function demoPuzzleInsights(): PuzzleInsights {
  const today = Math.floor(Date.now() / 1000 / 86_400);
  const themes = [
    ["fork", 64, 47],
    ["pin", 51, 33],
    ["backRankMate", 38, 31],
    ["skewer", 30, 17],
    ["discoveredAttack", 27, 14],
    ["hangingPiece", 24, 20],
    ["deflection", 19, 8],
  ] as const;
  return {
    personal_rating: 1568,
    attempts: 312,
    solved: 214,
    avg_puzzle_rating: 1520,
    avg_solved_rating: 1462,
    best_run: 11,
    current_run: 3,
    themes: themes.map(([theme, attempts, solved]) => ({ theme, attempts, solved })),
    by_rating: [800, 1200, 1600, 2000].map((key, index) => ({
      key,
      attempts: [46, 118, 106, 42][index],
      solved: [42, 92, 63, 17][index],
    })),
    by_weekday: [...Array(7)].map((_, key) => ({
      key,
      attempts: [58, 41, 47, 39, 33, 52, 42][key],
      solved: [41, 27, 33, 26, 19, 38, 30][key],
    })),
    by_hour: [...Array(24)].map((_, key) => {
      const attempts = key >= 7 && key <= 22 ? 8 + ((key * 7) % 17) : 1;
      return { key, attempts, solved: Math.round(attempts * (0.45 + ((key * 3) % 9) / 20)) };
    }),
    timeline: [...Array(30)].map((_, index) => ({
      day_ts: (today - 29 + index) * 86_400,
      attempts: index % 4 === 0 ? 0 : 4 + ((index * 3) % 9),
      solved: index % 4 === 0 ? 0 : 2 + ((index * 2) % 6),
      rating: 1480 + index * 3 + ((index * 7) % 11),
    })),
  };
}

export function demoDeepInsights(): DeepInsights {
  const months = [...Array(12)].map((_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (11 - index));
    return {
      month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      games: 18 + ((index * 5) % 22),
      score_pct: 46 + ((index * 3) % 11),
      accuracy: 71.5 + index * 0.4 + ((index * 7) % 5) * 0.2,
      rating: 1465 + index * 4 - ((index * 11) % 25),
      blunders_per_100: 3.4 - index * 0.09,
      puzzle_attempts: 12 + ((index * 13) % 40),
      puzzle_solved: 8 + ((index * 9) % 26),
    };
  });

  return {
    coverage: {
      games: 96,
      analyzed: 84,
      with_clocks: 71,
      moves_judged: 5_812,
      first_ts: Math.floor(Date.now() / 1000) - 290 * 86_400,
      last_ts: Math.floor(Date.now() / 1000),
    },
    time: {
      games: 71,
      moves: 2_640,
      by_speed: [
        { key: "instant", moves: 812, errors: 61, blunders: 27, errors_per_100: 7.5, avg_loss: 4.1, share_pct: 1.1 },
        { key: "quick", moves: 964, errors: 44, blunders: 15, errors_per_100: 4.6, avg_loss: 2.8, share_pct: 4.5 },
        { key: "normal", moves: 612, errors: 22, blunders: 7, errors_per_100: 3.6, avg_loss: 2.3, share_pct: 12.6 },
        { key: "long", moves: 252, errors: 9, blunders: 3, errors_per_100: 3.6, avg_loss: 2.4, share_pct: 28.4 },
      ],
      focus: {
        balanced_share: 5.8,
        decided_share: 7.2,
        balanced_moves: 1_190,
        decided_moves: 430,
        error_share: 3.4,
        ok_share: 5.9,
      },
      trouble: {
        moves: 318,
        share_pct: 12.0,
        errors_per_100: 9.7,
        baseline_per_100: 4.4,
        games: 27,
        games_pct: 38.0,
        first_move: 28.4,
        flag_losses: 4,
        score_in_trouble: 38.9,
        score_without: 53.4,
      },
      edge: {
        games: 68,
        ahead_games: 31,
        ahead_score: 58.1,
        behind_games: 37,
        behind_score: 41.9,
        avg_diff: -12.4,
      },
      theory: {
        games: 68,
        book_share_pct: 23.5,
        book_moves: 604,
        book_avg_share: 4.8,
        own_avg_share: 5.6,
      },
      increment: { games: 42, moves: 1_520, over_increment_pct: 61.2, avg_spent: 7.4, increment: 5 },
      drift: [
        { index: 1, games: 44, avg_share: 6.4, score_pct: 55.7 },
        { index: 2, games: 38, avg_share: 5.8, score_pct: 52.6 },
        { index: 3, games: 26, avg_share: 5.1, score_pct: 48.1 },
        { index: 4, games: 17, avg_share: 4.4, score_pct: 44.1 },
        { index: 5, games: 14, avg_share: 3.9, score_pct: 39.3 },
      ],
      by_phase: [
        { phase: "opening", moves: 940, clock_pct: 22.4, avg_share: 3.1 },
        { phase: "middlegame", moves: 1_180, clock_pct: 51.7, avg_share: 6.8 },
        { phase: "endgame", moves: 520, clock_pct: 19.2, avg_share: 5.4 },
      ],
    },
    content: {
      games: 84,
      conversion: {
        games: 38,
        won: 25,
        drawn: 7,
        lost: 6,
        score_pct: 75.0,
        lost_at_move: 31.5,
        phase: "endgame",
      },
      defense: { games: 31, saved: 7, save_pct: 22.6 },
      decisive: {
        games: 72,
        avg_move: 27.8,
        by_phase: [
          { phase: "opening", games: 9, share_pct: 12.5 },
          { phase: "middlegame", games: 41, share_pct: 56.9 },
          { phase: "endgame", games: 22, share_pct: 30.6 },
        ],
      },
      punishment: { chances: 96, missed: 41, missed_pct: 42.7 },
      anatomy: {
        errors: 88,
        forcing_missed: 54,
        forcing_pct: 61.4,
        forcing_base_pct: 38.2,
        by_piece: [
          { piece: "N", errors: 26, moves: 486, errors_per_100: 5.3 },
          { piece: "P", errors: 21, moves: 812, errors_per_100: 2.6 },
          { piece: "Q", errors: 16, moves: 274, errors_per_100: 5.8 },
          { piece: "B", errors: 12, moves: 398, errors_per_100: 3.0 },
          { piece: "R", errors: 9, moves: 412, errors_per_100: 2.2 },
          { piece: "K", errors: 4, moves: 258, errors_per_100: 1.6 },
        ],
        forcing_loss: 3.8,
        quiet_loss: 2.4,
        forcing_moves: 1_020,
        quiet_moves: 1_620,
      },
      endgames: [
        { key: "rook", games: 22, score_pct: 38.6, accuracy: 71.2 },
        { key: "pawn", games: 14, score_pct: 57.1, accuracy: 78.4 },
        { key: "rook+minor", games: 11, score_pct: 45.5, accuracy: 73.8 },
        { key: "minor", games: 8, score_pct: 50.0, accuracy: 74.9 },
        { key: "opposite-bishops", games: 5, score_pct: 60.0, accuracy: 76.1 },
      ],
    },
    benchmark: {
      games: 52,
      avg_opp_elo: 1494,
      me: {
        moves: 1_640,
        avg_loss: 3.1,
        errors_per_100: 6.2,
        blunders_per_100: 2.4,
        accuracy: 74.8,
        by_phase: [
          { phase: "opening", moves: 560, blunders_per_100: 1.1, avg_loss: 1.9 },
          { phase: "middlegame", moves: 740, blunders_per_100: 3.2, avg_loss: 3.8 },
          { phase: "endgame", moves: 340, blunders_per_100: 2.9, avg_loss: 3.4 },
        ],
        avg_share: 5.2,
        trouble_pct: 12.4,
      },
      field: {
        moves: 1_628,
        avg_loss: 3.4,
        errors_per_100: 6.9,
        blunders_per_100: 2.8,
        accuracy: 73.1,
        by_phase: [
          { phase: "opening", moves: 558, blunders_per_100: 1.3, avg_loss: 2.1 },
          { phase: "middlegame", moves: 736, blunders_per_100: 3.4, avg_loss: 4.0 },
          { phase: "endgame", moves: 334, blunders_per_100: 4.1, avg_loss: 4.2 },
        ],
        avg_share: 6.1,
        trouble_pct: 9.8,
      },
    },
    sessions: {
      sessions: 41,
      avg_games: 2.3,
      by_index: [
        { index: 1, games: 41, score_pct: 55.7, accuracy: 75.8 },
        { index: 2, games: 33, score_pct: 52.6, accuracy: 74.4 },
        { index: 3, games: 22, score_pct: 48.1, accuracy: 72.9 },
        { index: 4, games: 14, score_pct: 44.1, accuracy: 71.2 },
        { index: 5, games: 12, score_pct: 39.3, accuracy: 69.8 },
      ],
      recommended_length: 2,
      requeue: { fast_games: 18, fast_score: 36.1, slow_games: 24, slow_score: 51.0, threshold: 120 },
      warmup: {
        first_games: 34,
        first_score: 47.1,
        rest_games: 62,
        rest_score: 52.4,
        primed_games: 13,
        primed_score: 57.7,
        cold_games: 21,
        cold_score: 40.5,
      },
      damage: { sessions: 34, total_loss: -186, worst3_pct: 52.7, worst_delta: -41 },
    },
    progress: {
      months,
      themes: [
        { theme: "backRankMate", attempts: 38, early_pct: 63.2, late_pct: 84.2, delta: 21.0 },
        { theme: "fork", attempts: 64, early_pct: 68.8, late_pct: 78.1, delta: 9.3 },
        { theme: "pin", attempts: 51, early_pct: 65.4, late_pct: 64.0, delta: -1.4 },
        { theme: "skewer", attempts: 30, early_pct: 60.0, late_pct: 53.3, delta: -6.7 },
      ],
      rep_effect: { before_games: 22, before_score: 43.2, after_games: 19, after_score: 55.3 },
      accuracy_delta: 2.1,
      rating_delta: -12,
    },
    repertoire: {
      nodes: 148,
      checked_games: 96,
      plies: 20,
      by_side: [
        {
          side: "white",
          games: 48,
          mine: 11,
          mine_score: 40.9,
          theirs: 24,
          theirs_score: 54.2,
          in_book: 13,
          in_book_score: 61.5,
          avg_mine_move: 7.2,
          avg_theirs_move: 5.4,
        },
        {
          side: "black",
          games: 48,
          mine: 19,
          mine_score: 34.2,
          theirs: 18,
          theirs_score: 52.8,
          in_book: 11,
          in_book_score: 59.1,
          avg_mine_move: 6.1,
          avg_theirs_move: 4.8,
        },
      ],
      shaky: [
        { node_id: 12, side: "black", line: "Caro-Kann Advance", san: "c5", lapses: 5, reps: 9, stability: 3.2, games: 7 },
        { node_id: 31, side: "white", line: "Italian Game", san: "d3", lapses: 3, reps: 11, stability: 6.8, games: 5 },
        { node_id: 44, side: "black", line: "Sicilian Najdorf", san: "e5", lapses: 3, reps: 6, stability: 4.1, games: 3 },
      ],
    },
    formats: {
      comparable: 3,
      formats: [
        // Bewusst so gebaut, dass der lehrreiche Fall sichtbar wird: die
        // meisten Partien laufen im Blitz, die besseren Ergebnisse im Rapid.
        {
          key: "chess.com/blitz",
          source: "chess.com",
          time_class: "blitz",
          games: 52,
          score_pct: 46.4,
          rating: 1428,
          avg_opp_elo: 1441,
          perf_rating: 1413,
          perf_edge: -15,
          accuracy: 71.2,
          avg_loss: 3.8,
          blunders_per_100: 3.4,
          trouble_pct: 16.8,
          minutes: 214,
          analyzed: 44,
          last_ts: Math.floor(Date.now() / 1000),
        },
        {
          key: "chess.com/rapid",
          source: "chess.com",
          time_class: "rapid",
          games: 28,
          score_pct: 54.8,
          rating: 1512,
          avg_opp_elo: 1498,
          perf_rating: 1552,
          perf_edge: 40,
          accuracy: 76.4,
          avg_loss: 2.9,
          blunders_per_100: 2.1,
          trouble_pct: 9.4,
          minutes: 258,
          analyzed: 24,
          last_ts: Math.floor(Date.now() / 1000) - 4 * 86_400,
        },
        {
          key: "lichess/blitz",
          source: "lichess",
          time_class: "blitz",
          games: 16,
          score_pct: 43.8,
          rating: 1646,
          avg_opp_elo: 1662,
          perf_rating: 1612,
          perf_edge: -34,
          accuracy: 69.8,
          avg_loss: 4.2,
          blunders_per_100: 3.9,
          trouble_pct: 19.2,
          minutes: 64,
          analyzed: 14,
          last_ts: Math.floor(Date.now() / 1000) - 11 * 86_400,
        },
      ],
    },
    openings: {
      // Als Weiß die eigene Wahl, als Schwarz das System des Gegners · beide
      // Lesarten sollen in der Vorschau sichtbar sein.
      baseline_score: 49.1,
      games: 96,
      families: [
        {
          key: "name:italian game",
          label: "Italian Game",
          color: "white",
          root: "e4",
          games: 24,
          score_pct: 56.3,
          accuracy: 74.1,
          opening_accuracy: 81.4,
          avg_loss: 2.1,
          blunders_per_100: 1.2,
          moves: 288,
          analyzed: 21,
          in_book: 15,
          my_departure: 4,
          avg_departure_ply: 13.2,
          last_ts: Math.floor(Date.now() / 1000) - 3 * 86_400,
        },
        {
          key: "name:sicilian defense",
          label: "Sicilian Defense",
          color: "black",
          root: "e4",
          games: 22,
          score_pct: 36.4,
          accuracy: 68.9,
          opening_accuracy: 71.2,
          avg_loss: 4.4,
          blunders_per_100: 2.9,
          moves: 254,
          analyzed: 19,
          in_book: 5,
          my_departure: 11,
          avg_departure_ply: 11.6,
          last_ts: Math.floor(Date.now() / 1000) - 6 * 86_400,
        },
        {
          key: "name:queen's gambit",
          label: "Queen's Gambit",
          color: "black",
          root: "d4",
          games: 14,
          score_pct: 46.4,
          accuracy: 71.5,
          opening_accuracy: 76.8,
          avg_loss: 3.1,
          blunders_per_100: 1.9,
          moves: 168,
          analyzed: 12,
          in_book: 6,
          my_departure: 5,
          avg_departure_ply: 12.4,
          last_ts: Math.floor(Date.now() / 1000) - 9 * 86_400,
        },
      ],
    },
    spotlight: {
      game_id: 42,
      ply: 61,
      kind: "missed_win",
      magnitude: 48.2,
      opponent: "Opponent 42",
      played_at: "",
    },
  };
}
