import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";

/** Spiegelt repertoire::RepNodeOut aus dem Rust-Backend. */
export interface RepNode {
  id: number;
  parent_id: number; // 0 = Wurzel
  side: "white" | "black";
  san: string;
  name: string;
  /** Freitext zur Stellung: Plan, Idee, Falle. */
  note: string;
  /** Gleiche Schlüssel auf derselben Seite sind Transpositionen. */
  fen_key: string;
  depth: number; // Halbzug des Zuges (1-basiert)
  reps: number;
  lapses: number;
  due_ts: number;
  stability: number;
  /** Selbst gezogene Position in der Variantenliste · 0 = nie sortiert. */
  sort_order: number;
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

export interface SideCoverage {
  side: "white" | "black";
  games: number;
  covered: number;
  pct: number;
}

export interface RepStats {
  my_positions: number;
  due_now: number;
  coverage_pct: number;
  games_checked: number;
  /** Prüftiefe in Halbzügen · ohne sie ist die Quote nicht zu deuten. */
  plies: number;
  by_side: SideCoverage[];
}

/** Ein Zug aus den eigenen Partien, den das Buch an dieser Stelle nicht kennt. */
export interface RepGap {
  node_id: number;
  side: "white" | "black";
  path_sans: string[];
  san: string;
  count: number;
  /** True = ich bin abgewichen; false = mir fehlt eine Antwort. */
  mine: boolean;
  score_pct: number;
  book_sans: string[];
  line: string;
}

export interface PgnImportResult {
  lines: number;
  added: number;
  skipped: number;
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
  return invoke<number>("rep_add_line", { side, name, sans }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

/**
 * Reihenfolge der Varianten einer Seite festschreiben.
 *
 * `nodeIds` ist die vollständige Liste der Linien-Endpunkte in ihrer neuen
 * Reihenfolge · das Backend schreibt daraus die Plätze 1..n.
 */
export function repReorder(side: "white" | "black", nodeIds: number[]): Promise<void> {
  return invoke<void>("rep_reorder", { side, nodeIds }).then(() => emitDataChange("repertoire"));
}

export function repDelete(id: number): Promise<void> {
  return invoke<void>("rep_delete", { id }).then(() => emitDataChange("repertoire"));
}

/** Fällige Karten einer Sitzung · 0 oder undefined heißt "ohne Grenze". */
export function repDue(dueLimit?: number, newLimit?: number): Promise<DueItem[]> {
  return invoke<DueItem[]>("rep_due", {
    dueLimit: dueLimit ?? null,
    newLimit: newLimit ?? null,
  });
}

/** Grade: 1 = falsch, 2 = schwer, 3 = gut, 4 = leicht. */
export function repReview(nodeId: number, grade: 1 | 2 | 3 | 4): Promise<ReviewResult> {
  return invoke<ReviewResult>("rep_review", { nodeId, grade }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

export function repStats(plies?: number, games?: number): Promise<RepStats> {
  return invoke<RepStats>("rep_stats", { plies: plies ?? null, games: games ?? null });
}

export function repNodeGames(nodeId: number): Promise<NodeGameStats> {
  return invoke<NodeGameStats>("rep_node_games", { nodeId });
}

/** Lücken im Buch, abgeleitet aus den eigenen Partien. */
export function repGaps(plies?: number, games?: number, limit?: number): Promise<RepGap[]> {
  return invoke<RepGap[]>("rep_gaps", {
    plies: plies ?? null,
    games: games ?? null,
    limit: limit ?? null,
  });
}

export function repSetNote(nodeId: number, note: string): Promise<void> {
  return invoke<void>("rep_set_note", { nodeId, note }).then(() => emitDataChange("repertoire"));
}

/** Knoten derselben Seite, die dieselbe Stellung erreichen (Transpositionen). */
export function repLookup(side: "white" | "black", sans: string[]): Promise<RepNode[]> {
  return invoke<RepNode[]>("rep_lookup", { side, sans });
}

export function repImportPgn(
  side: "white" | "black",
  name: string,
  pgn: string
): Promise<PgnImportResult> {
  return invoke<PgnImportResult>("rep_import_pgn", { side, name, pgn }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

/** Import aus einer Datei · das Frontend kennt nur den Pfad, nicht den Inhalt. */
export function repImportPgnFile(
  side: "white" | "black",
  name: string,
  path: string
): Promise<PgnImportResult> {
  return invoke<PgnImportResult>("rep_import_pgn_file", { side, name, path }).then((r) => {
    emitDataChange("repertoire");
    return r;
  });
}

export function repExportPgnFile(side: "white" | "black", path: string): Promise<string> {
  return invoke<string>("rep_export_pgn_file", { side, path });
}
