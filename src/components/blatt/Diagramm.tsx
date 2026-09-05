/**
 * Das gedruckte Diagramm.
 *
 * Haarlinienrahmen, Koordinaten außerhalb, Bildunterschrift darunter — die
 * Form, in der ein Diagramm in jedem Schachbuch steht. Es ist kein Brett: Man
 * liest es, man zieht nicht daran.
 *
 * Gedruckt oder gespielt. Genau dieser Unterschied steckt in `live`:
 *
 * · Ein Abdruck (Start, Partien-Eintrag, Repertoire-Buchstellung) nimmt die
 *   gedämpften Feldfarben, die die App für Nebenbretter längst benutzt.
 * · Ein Brett, an dem gezogen wird (Analyse, Endspiele, Puzzles, Repertoire-
 *   Training), nimmt die Feldfarben des Themas — wie heute.
 *
 * Der Unterschied ist sofort zu sehen und sagt dem Nutzer, womit er es zu tun
 * hat. Beides sind Tokens; der Modus tauscht keine Farbe.
 *
 * Die Figuren kommen aus dem Set, das gerade gilt — dieselben Zeichnungen wie
 * auf dem Brett daneben, nicht ein zweiter Satz.
 */
import type { ReactNode } from "react";
import { fenSquares } from "../../lib/boardSound";
import { usePieceGlyphs } from "../../lib/pieces/usePieceSet";
import { glyphKey } from "../../lib/pieces/sets";
import { PIECE_VIEWBOX } from "../pieceGlyphs";
import "./blatt.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;

export interface DiagrammProps {
  fen: string;
  /**
   * Kantenlänge des Bretts in Bildpunkten. Ohne Angabe nimmt das Diagramm die
   * Breite, die es bekommt, und bleibt quadratisch · so steht es auf dem
   * Telefon, wo die Spalte das Maß vorgibt.
   */
  size?: number | string;
  /** Breite der Koordinatenspalte links · im Entwurf 15 px, mobil 13. */
  gutter?: number;
  orientation?: "white" | "black";
  /** Brett zum Ziehen statt Abdruck · siehe oben. */
  live?: boolean;
  /** Felder, die den letzten Zug tragen · leer lassen heißt: keine Marke. */
  highlight?: readonly string[];
}

/**
 * Nur die 64 Felder · ohne Rahmen, Koordinaten und Unterschrift. Sie füllen,
 * was ihnen der Aufrufer an Fläche gibt.
 */
export function DiagrammFelder({
  fen,
  orientation = "white",
  live = false,
  highlight,
}: Omit<DiagrammProps, "gutter" | "size">) {
  const glyphs = usePieceGlyphs();
  const board = fenSquares(fen) ?? Array.from({ length: 64 }, () => "");
  const marked = new Set(highlight ?? []);
  const light = live ? "var(--color-board-light)" : "var(--color-board-light-muted)";
  const dark = live ? "var(--color-board-dark)" : "var(--color-board-dark-muted)";
  const order = orientation === "white" ? board : [...board].reverse();

  return (
    <div
      className="kiebitz-board grid h-full w-full"
      style={{ gridTemplateColumns: "repeat(8, 1fr)", gridTemplateRows: "repeat(8, 1fr)" }}
    >
      {order.map((piece, index) => {
        const boardIndex = orientation === "white" ? index : 63 - index;
        const file = FILES[boardIndex % 8];
        const rank = 8 - Math.floor(boardIndex / 8);
        const square = `${file}${rank}`;
        const isLight = (Math.floor(boardIndex / 8) + (boardIndex % 8)) % 2 === 0;
        const glyph = piece ? glyphs[glyphKey(piece)] : undefined;
        return (
          <div
            key={square}
            data-square={square}
            className="relative"
            style={{ background: isLight ? light : dark }}
          >
            {/* Der letzte Zug bekommt keine Fläche, sondern einen Rahmen ·
                eine eingefärbte Fläche nähme dem Abdruck die Ruhe, und im
                Druck markiert man mit einem Kasten. */}
            {marked.has(square) && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 border border-ink"
              />
            )}
            {glyph && (
              <svg
                viewBox={PIECE_VIEWBOX}
                className="h-full w-full"
                aria-hidden="true"
                // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
                dangerouslySetInnerHTML={{ __html: glyph }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Das Diagramm mit Rahmen und Koordinaten · ohne Bildunterschrift.
 *
 * Ohne `size` nimmt es die Breite, die es bekommt, und bleibt quadratisch ·
 * das ist der Fall auf dem Telefon, wo die Spalte die Größe vorgibt. Mit
 * `size` steht es auf dem angegebenen Maß, wie im Entwurf für den Rechner.
 */
export function Diagramm({
  fen,
  size,
  gutter = 15,
  orientation = "white",
  live = false,
  highlight,
}: DiagrammProps) {
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();
  const files = orientation === "white" ? FILES : [...FILES].reverse();
  return (
    // Ein Diagramm sieht in jeder Sprache gleich aus · Koordinaten links,
    // a bis h von links nach rechts. `.kiebitz-board` hält die Felder selbst
    // schon von links nach rechts; hier geht es um den Rahmen darum.
    <div
      dir="ltr"
      className={`flex flex-col ${size == null ? "w-full" : "items-center"}`}
    >
      <div className="flex">
        {/* Ohne eigene Höhe · die Spalte zieht sich auf die des Bretts. */}
        <div
          className="blatt-zahl flex flex-col text-[9.5px] text-ink3"
          style={{ width: gutter, flex: "none" }}
          aria-hidden
        >
          {ranks.map((rank) => (
            <span key={rank} className="flex flex-1 items-center justify-center">
              {rank}
            </span>
          ))}
        </div>
        {/* Der Rahmen liegt auf dem Maß, nicht darum herum · sonst stünden
            die Koordinaten daneben um zwei Bildpunkte versetzt. */}
        <div
          className={`border border-ink ${size == null ? "aspect-square min-w-0 flex-1" : ""}`}
          style={size == null ? undefined : { width: size, height: size }}
        >
          <DiagrammFelder
            fen={fen}
            orientation={orientation}
            live={live}
            highlight={highlight}
          />
        </div>
      </div>
      <div
        className="blatt-zahl flex pt-1 text-[9.5px] text-ink3"
        style={{ marginLeft: gutter, width: size }}
        aria-hidden
      >
        {files.map((file) => (
          <span key={file} className="flex-1 text-center">
            {file}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Die Bildunterschrift unter einem Diagramm.
 *
 * Nummer, Titelzeile, kursive Beizeile, und darunter, wer am Zug ist — die
 * Reihenfolge, in der eine Bildunterschrift im Schachbuch steht. Sie ist so
 * breit wie das Brett und um die Koordinatenspalte eingerückt, damit sie
 * darunter bündig sitzt und nicht über sie hinausragt.
 */
export function Bildunterschrift({
  nummer,
  zeilen,
  amZug,
  breite,
  gutter = 15,
}: {
  nummer: string;
  /**
   * Erste Zeile trägt den Titel, weitere stehen kursiv darunter. Kein reiner
   * Text: In der Titelzeile kann ein Name zugleich ein Filtergriff sein.
   */
  zeilen: readonly ReactNode[];
  amZug?: { farbe: "white" | "black"; text: string };
  breite?: number | string;
  gutter?: number;
}) {
  return (
    // Der Einzug ist physisch links, nicht „am Anfang": Er richtet die
    // Unterschrift auf ein Diagramm aus, das in jeder Sprache von links nach
    // rechts steht.
    <div className="buch pt-[13px] text-center" style={{ marginLeft: gutter, width: breite }}>
      <div className="blatt-feld tracking-[0.18em] text-ink3">{nummer}</div>
      {zeilen.map((zeile, index) => (
        <div
          key={index}
          className={
            index === 0 ? "mt-[7px] text-[14px] text-ink" : "mt-[3px] text-[13px] italic text-ink2"
          }
        >
          {zeile}
        </div>
      ))}
      {amZug && (
        <div className="mt-2 flex items-center justify-center gap-[7px] text-[13px] text-ink">
          <span
            aria-hidden
            className="inline-block h-[9px] w-[9px] flex-none border border-ink"
            style={{ background: amZug.farbe === "black" ? "var(--color-ink)" : "transparent" }}
          />
          <span>{amZug.text}</span>
        </div>
      )}
    </div>
  );
}
