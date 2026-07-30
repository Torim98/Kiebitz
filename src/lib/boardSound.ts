/**
 * Welcher Klang zu einem Stellungswechsel gehört.
 *
 * Die Bretter melden keine Züge, sondern nur eine neue FEN · das gilt für den
 * eigenen Zug genauso wie für die Antwort der Engine, den Setup-Zug einer
 * Puzzle-Aufgabe oder das Blättern in der Zugliste. Deshalb wird der Klang aus
 * dem Unterschied zweier Stellungen abgeleitet: ein einzelner Zug verändert
 * höchstens vier Felder (Rochade), und mehr als eine Figur kann er nicht vom
 * Brett nehmen. Alles darüber ist ein Stellungswechsel · neue Aufgabe, anderes
 * Brett, Reset · und bleibt stumm.
 */
import { Chess } from "chess.js";
import type { BoardSoundKind } from "./sound";

const OFFICERS = "QRBNqrbn";

/** FEN-Stellungsteil als 64 Felder, a8 zuerst; null bei ungültiger Eingabe. */
export function fenSquares(fen: string): string[] | null {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return null;
  const rows = placement.split("/");
  if (rows.length !== 8) return null;
  const squares: string[] = [];
  for (const row of rows) {
    let filled = 0;
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        const empty = Number(char);
        for (let i = 0; i < empty; i++) squares.push("");
        filled += empty;
      } else if (/[pnbrqkPNBRQK]/.test(char)) {
        squares.push(char);
        filled += 1;
      } else {
        return null;
      }
    }
    if (filled !== 8) return null;
  }
  return squares;
}

function sideToMove(fen: string): "w" | "b" | null {
  const field = fen.trim().split(/\s+/)[1];
  return field === "w" || field === "b" ? field : null;
}

function fileOf(index: number): number {
  return index % 8;
}

function isBackRank(index: number): boolean {
  return index < 8 || index >= 56;
}

function count(squares: string[], piece: string): number {
  return squares.reduce((sum, value) => sum + (value === piece ? 1 : 0), 0);
}

/**
 * Klänge für den Übergang von `previous` nach `next`, in Abspielreihenfolge.
 * Ein Schlag im Schach ergibt zwei Klänge · so klingt es auch auf lichess.
 * Leeres Ergebnis heißt: kein einzelner Zug, also kein Ton.
 */
export function soundsForTransition(previous: string, next: string): BoardSoundKind[] {
  if (!previous || !next || previous === next) return [];
  const before = fenSquares(previous);
  const after = fenSquares(next);
  if (!before || !after) return [];

  const changed: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (before[i] !== after[i]) changed.push(i);
  }
  // Ein Zug bewegt eine Figur (2 Felder), schlägt en passant (3) oder
  // rochiert (4). Mehr Änderungen sind ein Stellungswechsel.
  if (changed.length === 0 || changed.length > 4) return [];

  const pieces = (squares: string[]) => squares.filter(Boolean).length;
  const removed = pieces(before) - pieces(after);
  if (removed < 0 || removed > 1) return [];

  // Ein echter Zug wechselt die Seite am Zug. Ohne dieses Feld (reine
  // Stellungsangabe) wird nicht geprüft.
  const from = sideToMove(previous);
  const to = sideToMove(next);
  if (from && to && from === to) return [];

  const kinds: BoardSoundKind[] = [];

  // Rochade: der König steht zwei Dateien weiter als vorher.
  const king = from === "b" ? "k" : "K";
  const kingBefore = before.indexOf(king);
  const kingAfter = after.indexOf(king);
  const castled =
    kingBefore >= 0 &&
    kingAfter >= 0 &&
    Math.abs(fileOf(kingAfter) - fileOf(kingBefore)) === 2;

  // Umwandlung: ein Bauer der ziehenden Seite ist weg, dafür steht ein
  // Offizier auf der Grundreihe, der vorher nicht dort stand.
  const pawn = from === "b" ? "p" : "P";
  const promoted =
    count(after, pawn) < count(before, pawn) &&
    changed.some(
      (index) =>
        isBackRank(index) &&
        OFFICERS.includes(after[index]) &&
        (from === "b" ? after[index] === after[index].toLowerCase() : after[index] === after[index].toUpperCase())
    );

  if (promoted) kinds.push("promote");
  else if (removed === 1) kinds.push("capture");
  else if (castled) kinds.push("castle");
  else kinds.push("move");

  try {
    if (new Chess(next).inCheck()) kinds.push("check");
  } catch {
    /* Stellungen ohne vollständige FEN sagen nichts über Schach aus. */
  }
  return kinds;
}
