import { invoke } from "@tauri-apps/api/core";

/** Spiegelt repertoire::RepNodeOut aus dem Rust-Backend. */
export interface RepNode {
  id: number;
  parent_id: number; // 0 = Wurzel
  side: "white" | "black";
  san: string;
  name: string;
  depth: number; // Halbzug des Zuges (1-basiert)
  reps: number;
  lapses: number;
  due_ts: number;
  stability: number;
  my_move: boolean;
}

export interface DueItem {
  node_id: number;
  side: "white" | "black";
  prompt_sans: string[];
  expected_san: string;
  line: string;
  is_new: boolean;
}

export interface ReviewResult {
  due_ts: number;
  interval_days: number;
}

export interface RepStats {
  my_positions: number;
  due_now: number;
  coverage_pct: number;
  games_checked: number;
}

export interface Deviation {
  san: string;
  count: number;
}

export interface NodeGameStats {
  games: number;
  score_pct: number;
  book_sans: string[];
  deviations: Deviation[];
  followed_book: number;
}

export function repList(): Promise<RepNode[]> {
  return invoke<RepNode[]>("rep_list");
}

export function repAddLine(side: "white" | "black", name: string, sans: string[]): Promise<number> {
  return invoke<number>("rep_add_line", { side, name, sans });
}

export function repDelete(id: number): Promise<void> {
  return invoke("rep_delete", { id });
}

export function repDue(): Promise<DueItem[]> {
  return invoke<DueItem[]>("rep_due");
}

/** Grade: 1 = falsch, 2 = schwer, 3 = gut, 4 = leicht. */
export function repReview(nodeId: number, grade: 1 | 2 | 3 | 4): Promise<ReviewResult> {
  return invoke<ReviewResult>("rep_review", { nodeId, grade });
}

export function repStats(): Promise<RepStats> {
  return invoke<RepStats>("rep_stats");
}

export function repNodeGames(nodeId: number): Promise<NodeGameStats> {
  return invoke<NodeGameStats>("rep_node_games", { nodeId });
}
