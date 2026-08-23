/**
 * Das Brett einer geteilten Stellung als eigenständiges SVG.
 *
 * Für die Bildkarte reicht das Brett aus der Oberfläche nicht: `react-chessboard`
 * zeichnet in ein lebendes DOM mit Zustand, Ereignissen und Webfonts, und daraus
 * lässt sich keine PNG-Datei ziehen, die auf jedem Gerät gleich aussieht. Hier
 * entsteht stattdessen eine reine Zeichenanweisung aus Feldern, Hervorhebung,
 * Figuren und Pfeil, die sich in ein Bild rastern lässt und sich in einem Test
 * ohne Browser prüfen lässt.
 *
 * Die Figuren stammen aus `components/pieceGlyphs.ts` und damit wörtlich aus
 * demselben Satz, den das Brett in der App zeigt · eine geteilte Stellung sieht
 * aus wie Kiebitz und nicht wie irgendein Brett.
 */
import { PIECE_GLYPH, PIECE_VIEWBOX } from "../../components/pieceGlyphs";
import type { ShareMove } from "./codec";

/** Feldfarben des Kiebitz-Bretts · gleich wie in `components/Board.tsx`. */
export const SQUARE_LIGHT = "#e6e3d3";
export const SQUARE_DARK = "#6f8155";
/** Der Akzent der App · Hervorhebung des letzten Zuges und Pfeilfarbe. */
export const BOARD_ACCENT = "34, 192, 138";

export interface BoardSvgOptions {
  fen: string;
  orientation: "white" | "black";
  /** Kantenlänge des Bretts in Bildpunkten. */
  size: number;
  /** Zug, dessen beide Felder eingefärbt werden. */
  lastMove?: ShareMove | null;
  /** Zug, der als Pfeil darüberliegt · Bestzug oder aufgedeckte Lösung. */
  arrow?: ShareMove | null;
}

/** Die 64 Felder eines FEN, Index 0 ist a8 · dieselbe Lesefolge wie im Codec. */
function squares(fen: string): string[] {
  const placement = fen.trim().split(/\s+/)[0] ?? "";
  const board: string[] = [];
  for (const row of placement.split("/")) {
    for (const char of row) {
      if (char >= "1" && char <= "8") {
        for (let i = 0; i < Number(char); i++) board.push("");
      } else {
        board.push(char);
      }
    }
  }
  while (board.length < 64) board.push("");
  return board.slice(0, 64);
}

/** Feldname zu Index in FEN-Lesefolge. */
function nameAt(index: number): string {
  return String.fromCharCode(97 + (index % 8)) + String(8 - Math.floor(index / 8));
}

/**
 * Bildpunkt-Ecke eines Feldes. Bei gedrehtem Brett kehrt sich beides um; die
 * Umrechnung steht nur hier, damit Felder, Hervorhebung und Pfeil nicht
 * getrennt voneinander falsch werden können.
 */
export function squareOrigin(
  square: string,
  orientation: "white" | "black",
  size: number
): { x: number; y: number } {
  const unit = size / 8;
  const file = square.charCodeAt(0) - 97;
  const rank = square.charCodeAt(1) - 49;
  const column = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  return { x: column * unit, y: row * unit };
}

/** Der Figurenbuchstabe des FEN als Schlüssel der Zeichnungen ("wP", "bK"). */
function glyphKey(piece: string): string {
  return (piece === piece.toUpperCase() ? "w" : "b") + piece.toUpperCase();
}

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Pfeil von Feld zu Feld · absichtlich schlicht: ein Schaft, der kurz vor dem
 * Zielfeld endet, und eine Spitze darauf. Bogen und Springerknick wie im Brett
 * der App wären auf einer Bildkarte eher Zierrat als Information.
 */
function arrowPath(from: string, to: string, orientation: "white" | "black", size: number): string {
  const unit = size / 8;
  const start = squareOrigin(from, orientation, size);
  const end = squareOrigin(to, orientation, size);
  const x1 = start.x + unit / 2;
  const y1 = start.y + unit / 2;
  const x2 = end.x + unit / 2;
  const y2 = end.y + unit / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;

  const head = unit * 0.42;
  const width = unit * 0.17;
  // Der Schaft endet dort, wo die Spitze beginnt, sonst blitzt seine Kante
  // seitlich unter der Spitze hervor.
  const tipX = x2 - ux * unit * 0.12;
  const tipY = y2 - uy * unit * 0.12;
  const baseX = tipX - ux * head;
  const baseY = tipY - uy * head;

  return [
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(baseX)}" y2="${round(baseY)}"`,
    ` stroke="rgba(${BOARD_ACCENT}, 0.9)" stroke-width="${round(width)}" stroke-linecap="round" />`,
    `<polygon points="${round(tipX)},${round(tipY)} `,
    `${round(baseX - uy * head * 0.42)},${round(baseY + ux * head * 0.42)} `,
    `${round(baseX + uy * head * 0.42)},${round(baseY - ux * head * 0.42)}"`,
    ` fill="rgba(${BOARD_ACCENT}, 0.9)" />`,
  ].join("");
}

/**
 * Das fertige Brett-SVG. Enthält bewusst keinen Text: Beschriftungen kommen in
 * der Bildkarte vom Canvas, weil ein als Bild geladenes SVG die Schrift der
 * App nicht kennt und sonst in einer Systemschrift danebenstünde.
 */
export function boardSvg(options: BoardSvgOptions): string {
  const { fen, orientation, size } = options;
  const unit = size / 8;
  const board = squares(fen);
  const parts: string[] = [];

  for (let i = 0; i < 64; i++) {
    const name = nameAt(i);
    const { x, y } = squareOrigin(name, orientation, size);
    // a1 ist dunkel · Datei- und Reihenindex zusammen gerade heißt hell.
    const light = (i + Math.floor(i / 8)) % 2 === 0;
    parts.push(
      `<rect x="${round(x)}" y="${round(y)}" width="${round(unit)}" height="${round(unit)}" fill="${
        light ? SQUARE_LIGHT : SQUARE_DARK
      }" />`
    );
  }

  if (options.lastMove) {
    for (const square of [options.lastMove.from, options.lastMove.to]) {
      const { x, y } = squareOrigin(square, orientation, size);
      parts.push(
        `<rect x="${round(x)}" y="${round(y)}" width="${round(unit)}" height="${round(
          unit
        )}" fill="rgba(${BOARD_ACCENT}, 0.32)" />`
      );
    }
  }

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;
    const glyph = PIECE_GLYPH[glyphKey(piece)];
    if (!glyph) continue;
    const { x, y } = squareOrigin(nameAt(i), orientation, size);
    parts.push(
      `<svg x="${round(x)}" y="${round(y)}" width="${round(unit)}" height="${round(
        unit
      )}" viewBox="${PIECE_VIEWBOX}">${glyph}</svg>`
    );
  }

  if (options.arrow) parts.push(arrowPath(options.arrow.from, options.arrow.to, orientation, size));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts.join(
    ""
  )}</svg>`;
}

/** Beschriftung der Ränder · gezeichnet wird sie außerhalb, hier steht nur die Ordnung. */
export function boardCoordinates(orientation: "white" | "black"): {
  files: string[];
  ranks: string[];
} {
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];
  return orientation === "white"
    ? { files, ranks }
    : { files: [...files].reverse(), ranks: [...ranks].reverse() };
}
