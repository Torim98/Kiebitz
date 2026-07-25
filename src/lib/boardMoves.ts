/**
 * Zughilfen fürs Brett: Zielfelder eines gewählten Steins als Punkte bzw.
 * Ringe (Schlagzug), im Kiebitz-Grün. Die Markierung läuft über
 * `customSquareStyles` von react-chessboard — kein zusätzliches DOM.
 */
import { Chess } from "chess.js";
import { useEffect, useState, type CSSProperties } from "react";

const DOT = "rgba(34, 192, 138, 0.42)";

/** Ruhiger Zug: kleiner Punkt in der Feldmitte. */
const quietStyle: CSSProperties = {
  background: `radial-gradient(circle, ${DOT} 20%, transparent 21%)`,
};

/** Schlagzug: Ring am Feldrand, damit die Figur sichtbar bleibt. */
const captureStyle: CSSProperties = {
  background: `radial-gradient(circle, transparent 56%, ${DOT} 58%)`,
};

/** Hervorhebung des gewählten Feldes. */
export const selectedStyle: CSSProperties = { background: "rgba(34, 192, 138, 0.42)" };

/**
 * Stile für alle legalen Zielfelder von `from`. Leeres Objekt, wenn dort kein
 * eigener Stein steht oder die Stellung ungültig ist.
 */
export function moveTargetStyles(fen: string, from: string | null): Record<string, CSSProperties> {
  if (!from) return {};
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ square: from as never, verbose: true }) as {
      to: string;
      captured?: string;
    }[];
    const styles: Record<string, CSSProperties> = {};
    for (const move of moves) {
      styles[move.to] = move.captured ? captureStyle : quietStyle;
    }
    return styles;
  } catch {
    return {};
  }
}

/** Gewähltes Feld plus seine Zielfelder — der übliche Aufruf in den Seiten. */
export function selectionStyles(
  fen: string,
  selected: string | null
): Record<string, CSSProperties> {
  if (!selected) return {};
  return { [selected]: selectedStyle, ...moveTargetStyles(fen, selected) };
}

/**
 * Zug per Klick: erst eigene Figur wählen, dann Zielfeld. Liefert außerdem die
 * Feldstile mit Auswahl und Zugpunkten. `play` meldet, ob der Zug zulässig war.
 */
export function useBoardSelection(
  fen: string,
  play: (from: string, to: string) => boolean,
  enabled = true
) {
  const [selected, setSelected] = useState<string | null>(null);

  // Neue Stellung (Zug, nächste Aufgabe) hebt die Auswahl auf.
  useEffect(() => setSelected(null), [fen]);

  const onSquareClick = (square: string) => {
    if (!enabled) return;
    let piece: { color: string } | undefined;
    let turn = "w";
    try {
      const chess = new Chess(fen);
      piece = chess.get(square as never);
      turn = chess.turn();
    } catch {
      return;
    }
    if (selected && selected !== square) {
      const moved = play(selected, square);
      // Fehlklick auf eine andere eigene Figur wählt diese aus.
      setSelected(moved || !piece || piece.color !== turn ? null : square);
    } else if (piece && piece.color === turn) {
      setSelected(selected === square ? null : square);
    }
  };

  return {
    selected,
    clearSelection: () => setSelected(null),
    onSquareClick,
    squareStyles: enabled ? selectionStyles(fen, selected) : {},
  };
}
