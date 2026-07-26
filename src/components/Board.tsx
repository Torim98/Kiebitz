import { Chessboard } from "react-chessboard";
import { TouchBackend } from "react-dnd-touch-backend";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { selectionStyles } from "../lib/boardMoves";

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
  arrows = [],
  badges = [],
  muted = false,
  mouseDrag = false,
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
  /** Engine-/Partiezug-Pfeile im Format [von, nach, Farbe]. */
  arrows?: [string, string, string?][];
  /** Kleine Zugqualitaets-Marker auf der oberen rechten Feldecke. */
  badges?: { square: string; label: ReactNode; color: string; title?: string }[];
  /** Varianten werden durch entsaettigte Felder vom Partieverlauf abgesetzt. */
  muted?: boolean;
  /** Windows-WebView: Touch-Backend explizit auch fuer Maus-Pointer aktivieren. */
  mouseDrag?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(width);
  const [dragSource, setDragSource] = useState<string | null>(null);

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

  // A new position always ends the old drag, including moves completed by an
  // automated opponent response.
  useEffect(() => setDragSource(null), [fen]);

  // Der Marker sitzt wie bei chess.com mittig auf der oberen rechten Ecke des
  // Zielfelds und ueberlappt das Nachbarfeld nur minimal.
  const badgePosition = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    return {
      left: `${(x + 1) * 12.5}%`,
      top: `${y * 12.5}%`,
      transform: "translate(-50%, -50%)",
    };
  };

  const squareTheme = muted
    ? {
        customDarkSquareStyle: { backgroundColor: "#68716b" },
        customLightSquareStyle: { backgroundColor: "#d0d0c8" },
      }
    : boardTheme;

  return (
    <div
      ref={ref}
      className={shake ? "animate-shake" : ""}
      style={{ width: "100%", maxWidth: width }}
    >
      <div className="relative" style={{ width: w, height: w }}>
        <Chessboard
          id={boardId}
          position={fen}
          boardWidth={w}
          arePiecesDraggable={draggable}
          onPieceDrop={onPieceDrop ? (s, t) => onPieceDrop(s, t) : undefined}
          onPieceDragBegin={draggable ? (_piece, source) => setDragSource(source) : undefined}
          onPieceDragEnd={draggable ? () => setDragSource(null) : undefined}
          onSquareClick={onSquareClick}
          customSquareStyles={{
            ...selectionStyles(fen, dragSource),
            ...squareStyles,
          }}
          customArrows={arrows as never}
          customDndBackend={mouseDrag ? TouchBackend : undefined}
          customDndBackendOptions={mouseDrag ? { enableMouseEvents: true } : undefined}
          boardOrientation={orientation}
          animationDuration={150}
          {...boardTheme}
          {...squareTheme}
        />
        {badges.map((badge, index) => (
          <span
            key={`${badge.square}-${index}`}
            title={badge.title}
            className="pointer-events-none absolute z-20 flex h-[6.5%] min-h-4 w-[6.5%] min-w-4 items-center justify-center rounded-full border border-white/85 text-[clamp(7px,1.05vw,11px)] font-extrabold leading-none text-white shadow-md"
            style={{ ...badgePosition(badge.square), background: badge.color }}
          >
            {badge.label}
          </span>
        ))}
      </div>
    </div>
  );
}
