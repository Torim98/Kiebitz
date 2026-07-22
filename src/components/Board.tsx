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
  arrows = [],
  badges = [],
  muted = false,
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
  /** Kleine Zugqualitaets-Marker auf Zielfeldern. */
  badges?: { square: string; label: string; color: string; title?: string }[];
  /** Varianten werden durch entsaettigte Felder vom Partieverlauf abgesetzt. */
  muted?: boolean;
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

  const badgePosition = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    return {
      left: `${(x + 1) * 12.5 - 5.2}%`,
      top: `${y * 12.5 + 0.8}%`,
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
          onSquareClick={onSquareClick}
          customSquareStyles={squareStyles}
          customArrows={arrows as never}
          boardOrientation={orientation}
          animationDuration={150}
          {...boardTheme}
          {...squareTheme}
        />
        {badges.map((badge, index) => (
          <span
            key={`${badge.square}-${badge.label}-${index}`}
            title={badge.title}
            className="pointer-events-none absolute z-20 flex h-[8.5%] min-h-5 w-[8.5%] min-w-5 items-center justify-center rounded-full border-2 border-white/80 text-[clamp(9px,1.4vw,14px)] font-extrabold leading-none text-white shadow-lg"
            style={{ ...badgePosition(badge.square), background: badge.color }}
          >
            {badge.label}
          </span>
        ))}
      </div>
    </div>
  );
}
