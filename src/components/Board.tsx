import { Chessboard } from "react-chessboard";
import type { CSSProperties } from "react";

const boardTheme = {
  customDarkSquareStyle: { backgroundColor: "#6f8155" },
  customLightSquareStyle: { backgroundColor: "#e6e3d3" },
  customBoardStyle: {
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--color-line)",
  },
};

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
  width: number;
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
  squareStyles?: Record<string, CSSProperties>;
  orientation?: "white" | "black";
  boardId: string;
  shake?: boolean;
}) {
  return (
    <div className={shake ? "animate-shake" : ""} style={{ width }}>
      <Chessboard
        id={boardId}
        position={fen}
        boardWidth={width}
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
