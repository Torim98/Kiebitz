import { Chessboard } from "react-chessboard";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const boardTheme = {
  customDarkSquareStyle: { backgroundColor: "#6f8155" },
  customLightSquareStyle: { backgroundColor: "#e6e3d3" },
  customBoardStyle: {
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--color-line)",
  },
};

/**
 * Schachbrett mit responsiver Breite: `width` ist die Maximalbreite; auf
 * schmalen Screens (Mobile) schrumpft das Brett auf die Containerbreite.
 */
export default function Board({
  fen,
  width,
  draggable = false,
  onPieceDrop,
  onSquareClick,
  squareStyles,
  orientation = "white",
  boardId,
  shake = false,
}: {
  fen: string;
  /** Maximale Brettbreite in px; der Container kann sie unterschreiten. */
  width: number;
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
  squareStyles?: Record<string, CSSProperties>;
  orientation?: "white" | "black";
  boardId: string;
  shake?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(width);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      setW(avail > 0 ? Math.min(width, avail) : width);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={ref}
      className={shake ? "animate-shake" : ""}
      style={{ width: "100%", maxWidth: width }}
    >
      <Chessboard
        id={boardId}
        position={fen}
        boardWidth={w}
        arePiecesDraggable={draggable}
        onPieceDrop={onPieceDrop ? (s, t) => onPieceDrop(s, t) : undefined}
        onSquareClick={onSquareClick}
        customSquareStyles={squareStyles}
        boardOrientation={orientation}
        animationDuration={150}
        {...boardTheme}
      />
    </div>
  );
}
