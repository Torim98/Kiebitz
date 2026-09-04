/**
 * Was am freien Üben nachprüfbar sein muss.
 *
 * Der Stapel entsteht hier im Frontend und nicht im Backend, also gibt es auch
 * keinen Rust-Test, der ihn abdeckt. Wichtig sind drei Dinge: dass eine
 * Stellung mit zwei Buchzügen *eine* Frage bleibt, dass der Weg zur Stellung
 * stimmt (sonst fragt der Trainer die falsche Stellung ab), und dass die
 * Reihenfolge tatsächlich gewürfelt wird.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { repFreeItems, type RepNode } from "./repertoire";

function node(over: Partial<RepNode> & Pick<RepNode, "id" | "parent_id" | "san">): RepNode {
  return {
    side: "white",
    name: "",
    note: "",
    fen_key: "",
    depth: 1,
    reps: 3,
    lapses: 0,
    due_ts: 0,
    stability: 1,
    sort_order: 0,
    my_move: false,
    ...over,
  };
}

/** 1.e4 e5 2.Nf3 (Buch: auch 2.Bc4) · zwei eigene Züge, ein Gegnerzug. */
const BOOK: RepNode[] = [
  node({ id: 1, parent_id: 0, san: "e4", my_move: true, name: "Offene Spiele", depth: 1 }),
  node({ id: 2, parent_id: 1, san: "e5", depth: 2 }),
  node({ id: 3, parent_id: 2, san: "Nf3", my_move: true, depth: 3 }),
  node({ id: 4, parent_id: 2, san: "Bc4", my_move: true, depth: 3, reps: 0 }),
  node({ id: 5, parent_id: 3, san: "Nc6", depth: 4 }),
  node({ id: 6, parent_id: 5, san: "Bb5", my_move: true, name: "Spanisch", depth: 5 }),
];

describe("repFreeItems", () => {
  it("asks every position where I am to move, once", () => {
    const items = repFreeItems(BOOK, () => 0);
    // Drei eigene Stellungen: Grundstellung, nach 1...e5, nach 2...Nc6.
    // 2.Nf3 und 2.Bc4 sind zwei Antworten auf dieselbe Frage, keine zwei Fragen.
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.expected_san).sort()).toEqual(["Bb5", "Nf3", "e4"]);
  });

  it("carries the moves that lead to the position", () => {
    const items = repFreeItems(BOOK, () => 0);
    const spanish = items.find((i) => i.expected_san === "Bb5");
    expect(spanish?.prompt_sans).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(items.find((i) => i.expected_san === "e4")?.prompt_sans).toEqual([]);
  });

  it("names the line the way the tree does · the nearest named move above", () => {
    const items = repFreeItems(BOOK, () => 0);
    expect(items.find((i) => i.expected_san === "Bb5")?.line).toBe("Spanisch");
    // 2.Nf3 trägt selbst keinen Namen · dann gilt der Name darüber.
    expect(items.find((i) => i.expected_san === "Nf3")?.line).toBe("Offene Spiele");
  });

  it("takes moves that were never seen along, without asking the scheduler", () => {
    // Der Plan ließe 2.Bc4 als "neu" durchgehen; frei geübt wird es genauso,
    // und der Trainer darf es als neu kennzeichnen.
    const items = repFreeItems([BOOK[3]], () => 0);
    expect(items[0].is_new).toBe(true);
  });

  it("shuffles · the same book does not come in book order every time", () => {
    // Ein Würfel, der immer die letzte Stelle zieht, dreht die Liste um · das
    // reicht als Beweis, dass überhaupt gemischt wird.
    const straight = repFreeItems(BOOK, () => 0).map((i) => i.expected_san);
    const mixed = repFreeItems(BOOK, () => 0.999999).map((i) => i.expected_san);
    expect(mixed).not.toEqual(straight);
    expect([...mixed].sort()).toEqual([...straight].sort());
  });

  it("returns nothing when the book has no move of my own", () => {
    expect(repFreeItems([node({ id: 1, parent_id: 0, san: "e4" })])).toEqual([]);
  });
});
