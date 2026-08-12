/**
 * Typen und Aufruf für die Tiefenanalyse aus `insights.rs`.
 *
 * Die Struktur spiegelt das Rust-Modul eins zu eins (snake_case wie
 * serialisiert). Gerechnet wird alles dort · hier steht nur, was ankommt.
 */
import { invoke } from "@tauri-apps/api/core";
import { onDataChange } from "./changes";

export type Phase = "opening" | "middlegame" | "endgame";

export interface Coverage {
  games: number;
  analyzed: number;
  with_clocks: number;
  moves_judged: number;
  first_ts: number;
  last_ts: number;
}

// ── Block A · Zeitmanagement ────────────────────────────────────────────────

export type SpeedKey = "instant" | "quick" | "normal" | "long";

export interface SpeedBucket {
  key: SpeedKey;
  moves: number;
  errors: number;
  blunders: number;
  errors_per_100: number;
  /** Mittlerer Winrate-Verlust in Prozentpunkten. */
  avg_loss: number;
  share_pct: number;
}

export interface TimeFocus {
  balanced_share: number;
  decided_share: number;
  balanced_moves: number;
  decided_moves: number;
  error_share: number;
  ok_share: number;
}

export interface TimeTrouble {
  moves: number;
  share_pct: number;
  errors_per_100: number;
  baseline_per_100: number;
  games: number;
  games_pct: number;
  first_move: number;
  flag_losses: number;
  score_in_trouble: number;
  score_without: number;
}

export interface ClockEdge {
  games: number;
  ahead_games: number;
  ahead_score: number;
  behind_games: number;
  behind_score: number;
  avg_diff: number;
}

export interface TheoryTime {
  games: number;
  book_share_pct: number;
  book_moves: number;
  book_avg_share: number;
  own_avg_share: number;
}

export interface IncrementBalance {
  games: number;
  moves: number;
  over_increment_pct: number;
  avg_spent: number;
  increment: number;
}

export interface DriftPoint {
  index: number;
  games: number;
  avg_share: number;
  score_pct: number;
}

export interface PhaseTime {
  phase: Phase;
  moves: number;
  clock_pct: number;
  avg_share: number;
}

export interface TimeInsights {
  games: number;
  moves: number;
  by_speed: SpeedBucket[];
  focus: TimeFocus;
  trouble: TimeTrouble;
  edge: ClockEdge;
  theory: TheoryTime;
  increment: IncrementBalance;
  drift: DriftPoint[];
  by_phase: PhaseTime[];
}

// ── Block C · Partieinhalt ──────────────────────────────────────────────────

export interface Conversion {
  games: number;
  won: number;
  drawn: number;
  lost: number;
  score_pct: number;
  lost_at_move: number;
  phase: Phase;
}

export interface Defense {
  games: number;
  saved: number;
  save_pct: number;
}

export interface PhaseShare {
  phase: Phase;
  games: number;
  share_pct: number;
}

export interface Decisive {
  games: number;
  avg_move: number;
  by_phase: PhaseShare[];
}

export interface MissedPunishment {
  chances: number;
  missed: number;
  missed_pct: number;
}

export interface PieceErrors {
  piece: "P" | "N" | "B" | "R" | "Q" | "K";
  errors: number;
  moves: number;
  errors_per_100: number;
}

export interface Anatomy {
  errors: number;
  forcing_missed: number;
  forcing_pct: number;
  forcing_base_pct: number;
  by_piece: PieceErrors[];
  forcing_loss: number;
  quiet_loss: number;
  forcing_moves: number;
  quiet_moves: number;
}

export type EndgameKey =
  | "pawn"
  | "queen"
  | "queen+rook"
  | "rook"
  | "rook+minor"
  | "minor"
  | "opposite-bishops"
  | "other";

export interface EndgameType {
  key: EndgameKey;
  games: number;
  score_pct: number;
  accuracy: number | null;
}

export interface ContentInsights {
  games: number;
  conversion: Conversion;
  defense: Defense;
  decisive: Decisive;
  punishment: MissedPunishment;
  anatomy: Anatomy;
  endgames: EndgameType[];
}

// ── Block D · Feld-Vergleich ────────────────────────────────────────────────

export interface PhaseMetric {
  phase: Phase;
  moves: number;
  blunders_per_100: number;
  avg_loss: number;
}

export interface SideMetrics {
  moves: number;
  avg_loss: number;
  errors_per_100: number;
  blunders_per_100: number;
  accuracy: number | null;
  by_phase: PhaseMetric[];
  avg_share: number | null;
  trouble_pct: number | null;
}

export interface BenchmarkInsights {
  games: number;
  avg_opp_elo: number;
  me: SideMetrics | null;
  field: SideMetrics | null;
}

// ── Block E · Sessions ──────────────────────────────────────────────────────

export interface SessionIndex {
  index: number;
  games: number;
  score_pct: number;
  accuracy: number | null;
}

export interface Requeue {
  fast_games: number;
  fast_score: number;
  slow_games: number;
  slow_score: number;
  threshold: number;
}

export interface Warmup {
  first_games: number;
  first_score: number;
  rest_games: number;
  rest_score: number;
  primed_games: number;
  primed_score: number;
  cold_games: number;
  cold_score: number;
}

export interface SessionDamage {
  sessions: number;
  total_loss: number;
  worst3_pct: number;
  worst_delta: number;
}

export interface SessionInsights {
  sessions: number;
  avg_games: number;
  by_index: SessionIndex[];
  recommended_length: number;
  requeue: Requeue;
  warmup: Warmup;
  damage: SessionDamage;
}

// ── Block F · Fortschritt ───────────────────────────────────────────────────

export interface MonthPoint {
  month: string;
  games: number;
  score_pct: number;
  accuracy: number | null;
  rating: number | null;
  blunders_per_100: number | null;
  puzzle_attempts: number;
  puzzle_solved: number;
}

export interface ThemeProgress {
  theme: string;
  attempts: number;
  early_pct: number;
  late_pct: number;
  delta: number;
}

export interface RepEffect {
  before_games: number;
  before_score: number;
  after_games: number;
  after_score: number;
}

export interface ProgressInsights {
  months: MonthPoint[];
  themes: ThemeProgress[];
  rep_effect: RepEffect;
  accuracy_delta: number | null;
  rating_delta: number | null;
}

// ── Block B · Repertoire ────────────────────────────────────────────────────

export interface DeviationSide {
  side: "white" | "black";
  games: number;
  mine: number;
  mine_score: number;
  theirs: number;
  theirs_score: number;
  in_book: number;
  in_book_score: number;
  avg_mine_move: number;
  avg_theirs_move: number;
}

export interface ShakyLine {
  node_id: number;
  side: "white" | "black";
  line: string;
  san: string;
  lapses: number;
  reps: number;
  stability: number;
  games: number;
}

export interface RepertoireInsights {
  nodes: number;
  checked_games: number;
  plies: number;
  by_side: DeviationSide[];
  shaky: ShakyLine[];
}

// ── Block H · Zeitformate ───────────────────────────────────────────────────

export interface FormatStat {
  key: string;
  source: string;
  time_class: string;
  games: number;
  score_pct: number;
  rating: number | null;
  avg_opp_elo: number | null;
  perf_rating: number | null;
  perf_edge: number | null;
  accuracy: number | null;
  avg_loss: number | null;
  blunders_per_100: number | null;
  trouble_pct: number | null;
  minutes: number;
  analyzed: number;
  last_ts: number;
}

export interface FormatInsights {
  formats: FormatStat[];
  comparable: number;
}

export interface Spotlight {
  game_id: number;
  ply: number;
  kind: "missed_win" | "collapse";
  magnitude: number;
  opponent: string;
  played_at: string;
}

// ── Block I · Eröffnungsfamilien ────────────────────────────────────────────

export interface OpeningFamily {
  key: string;
  label: string;
  /** Meine Farbe · als Weiß meine Wahl, als Schwarz das System des Gegners. */
  color: "white" | "black";
  root: string;
  games: number;
  score_pct: number;
  accuracy: number | null;
  opening_accuracy: number | null;
  avg_loss: number;
  blunders_per_100: number;
  moves: number;
  analyzed: number;
  in_book: number;
  my_departure: number;
  avg_departure_ply: number;
  last_ts: number;
}

export interface OpeningInsights {
  families: OpeningFamily[];
  baseline_score: number;
  games: number;
}

export interface DeepInsights {
  coverage: Coverage;
  time: TimeInsights;
  content: ContentInsights;
  benchmark: BenchmarkInsights;
  sessions: SessionInsights;
  progress: ProgressInsights;
  repertoire: RepertoireInsights;
  formats: FormatInsights;
  openings: OpeningInsights;
  spotlight: Spotlight | null;
}

let deepInsightsRequest: Promise<DeepInsights> | null = null;

onDataChange(() => {
  deepInsightsRequest = null;
});

export function deepInsights(): Promise<DeepInsights> {
  if (!deepInsightsRequest) {
    const request = invoke<DeepInsights>("deep_insights");
    deepInsightsRequest = request;
    void request.catch(() => {
      if (deepInsightsRequest === request) deepInsightsRequest = null;
    });
  }
  return deepInsightsRequest;
}

// ── Block J · Wirkungsfenster ───────────────────────────────────────────────

export type MetricUnit = "pct" | "per100" | "elo";

export interface MetricValue {
  key: string;
  value: number | null;
  /** Partien, Züge oder Versuche · je nach Kennzahl. */
  n: number;
  /** Streuung der Einzelwerte, wo eine berechenbar ist. */
  sd: number | null;
  unit: MetricUnit;
  lower_is_better: boolean;
}

/** Ratingstand eines Pools · erst `formatScale.ts` macht Pools vergleichbar. */
export interface RatingPoint {
  source: string;
  time_class: string;
  first: number;
  last: number;
  games: number;
}

export interface MetricWindow {
  from_ts: number;
  to_ts: number;
  games: number;
  metrics: MetricValue[];
  ratings: RatingPoint[];
}

export function studyMetrics(
  windows: { from_ts: number; to_ts: number }[]
): Promise<MetricWindow[]> {
  return invoke<MetricWindow[]>("study_metrics", { windows });
}

// ── Kleine Ableitungen fürs Rendern ─────────────────────────────────────────

/** Genug Daten, damit eine Aussage nicht bloß Rauschen ist? */
export function enough(n: number, min: number): boolean {
  return n >= min;
}

/** Prozentpunkte-Differenz, gerundet auf eine Stelle. */
export function delta(a: number, b: number): number {
  return Math.round((a - b) * 10) / 10;
}
