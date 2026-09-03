/**
 * Die offenen Posten — die Zahlen, die im Register neben den Kapiteln stehen.
 *
 * Das Register des Diagramm-Modus beantwortet zwei Fragen in einer Zeile:
 * wohin es geht, und was dort offen ist. Dafür braucht die Hülle Zahlen, und
 * zwar auf jedem Tab dieselben.
 *
 * Eine einzige Abfrage: `study_data` liefert fällige Wiederholungen, Partien
 * ohne Analyse, das Puzzle-Tagesziel und den heutigen Stand in einem Zug —
 * dieselbe Auskunft, aus der auch die Erinnerung ihre Fälligkeiten liest
 * (lib/notify.ts). Der Bestand der Datenbank kommt aus `dbStats`, das die
 * Hülle ohnehin schon holt.
 *
 * Der Zustand liegt im Modul, nicht in der Komponente: Die Hülle steht auf
 * jedem Tab, und ein Wechsel des Tabs soll die Zahlen nicht neu abfragen.
 */
import { useEffect, useSyncExternalStore } from "react";
import { onDataChange } from "./changes";
import { studyData } from "./study";

export interface OpenItems {
  /** Fällige Repertoire-Wiederholungen. */
  repertoire: number;
  /** Partien ohne Auto-Analyse. */
  analysis: number;
  /** Heutige Puzzle-Versuche und das Tagesziel. */
  puzzles: number;
  puzzleGoal: number;
}

let items: OpenItems | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  if (running) return running;
  running = studyData()
    .then((data) => {
      items = {
        repertoire: data.due_now,
        analysis: data.unanalyzed,
        puzzles: data.today_puzzle_attempts,
        puzzleGoal: data.puzzle_goal,
      };
      notify();
    })
    .catch(() => {
      // Ohne Backend (Web-Vorschau) bleibt das Register ohne Zahlen · eine
      // leere Spalte ist ehrlicher als eine erfundene Null.
    })
    .finally(() => {
      running = null;
    });
  return running;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => items;

/**
 * Die offenen Posten · `null`, solange nichts vorliegt.
 *
 * Neu geholt wird, was sich geändert haben kann: nach einem Import, nach einer
 * Analyse, nach einer Trainingseinheit. Dieselben Meldungen, auf die auch die
 * Seiten hören.
 */
export function useOpenItems(): OpenItems | null {
  useEffect(() => {
    void load();
    return onDataChange(() => {
      void load().then(notify);
    });
  }, []);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Nur für Tests · setzt den Modulzustand zurück. */
export function resetOpenItemsForTests(): void {
  items = null;
  running = null;
}
