import { Chessboard } from "react-chessboard";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { moveTargetStyles, selectionStyles } from "../lib/boardMoves";
import { soundsForTransition } from "../lib/boardSound";
import { playBoardSound } from "../lib/sound";

const boardTheme = {
  customDarkSquareStyle: { backgroundColor: "#6f8155" },
  customLightSquareStyle: { backgroundColor: "#e6e3d3" },
  customBoardStyle: {
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--color-line)",
  },
};

function isAndroidWebView(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

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
  silent = false,
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
  /** Gemeinsamer WebView-Drag fuer Maus, Stift und Touch statt react-dnd. */
  mouseDrag?: boolean;
  /** Reine Vorschaubretter bleiben stumm, auch wenn Ton aktiviert ist. */
  silent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(width);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const dropRef = useRef(onPieceDrop);
  const draggableRef = useRef(draggable);
  const fenRef = useRef(fen);
  const suppressClickUntilRef = useRef(0);

  dropRef.current = onPieceDrop;
  draggableRef.current = draggable;
  fenRef.current = fen;

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

  /**
   * Zug- und Schlagklänge hängen an der Stellung, nicht am Eingabeweg: so
   * klingen der eigene Zug, die Engine-Antwort, der Setup-Zug einer Aufgabe
   * und das Blättern in der Zugliste gleichermaßen · und jedes Brett der App
   * bekommt den Ton, ohne ihn selbst anzumelden.
   */
  const soundFenRef = useRef(fen);
  useEffect(() => {
    const previous = soundFenRef.current;
    soundFenRef.current = fen;
    if (silent) return;
    soundsForTransition(previous, fen).forEach((kind) => playBoardSound(kind));
  }, [fen, silent]);

  /**
   * Windows WebView2 and Android WebView do not consistently deliver the
   * HTML5/react-dnd event sequence.  The affected boards therefore use one
   * small Pointer Events implementation for mouse, pen and touch alike.
   *
   * We keep the drag preview outside React so showing the legal targets cannot
   * rebuild the drag source while the pointer is already moving.
   */
  useEffect(() => {
    if (!mouseDrag) return;
    const board = ref.current;
    if (!board) return;

    type DragSession = {
      pointerId: number;
      source: string;
      piece: HTMLElement;
      ghost: HTMLElement | null;
      started: boolean;
      startX: number;
      startY: number;
      offsetX: number;
      offsetY: number;
    };

    let session: DragSession | null = null;

    const removePreview = () => {
      if (!session) return;
      session.piece.style.visibility = "";
      session.ghost?.remove();
      session = null;
      setDragSource(null);
    };

    type DragEvent = PointerEvent | MouseEvent;
    const eventId = (event: DragEvent) => ("pointerId" in event ? event.pointerId : -1);

    const movePreview = (event: DragEvent) => {
      if (!session?.ghost) return;
      session.ghost.style.transform = `translate3d(${
        event.clientX - session.offsetX
      }px, ${event.clientY - session.offsetY}px, 0)`;
    };

    const beginPreview = (event: DragEvent) => {
      if (!session || session.started) return;
      session.started = true;
      // Falls die WebView beim ersten Pixel bereits eine Koordinate markiert
      // hat, wird diese Auswahl beim tatsächlichen Drag sofort entfernt.
      window.getSelection()?.removeAllRanges();

      const rect = session.piece.getBoundingClientRect();
      const ghost = session.piece.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: "0",
        opacity: "0.94",
        pointerEvents: "none",
        transition: "none",
        zIndex: "2147483000",
        cursor: "grabbing",
      });
      document.body.appendChild(ghost);
      session.ghost = ghost;
      session.piece.style.visibility = "hidden";
      setDragSource(session.source);
      movePreview(event);
    };

    const onDragDown = (event: DragEvent) => {
      if (
        session
        || !draggableRef.current
        || !dropRef.current
        || event.button !== 0
        || ("isPrimary" in event && event.isPrimary === false)
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const piece = target?.closest<HTMLElement>("[data-piece]");
      const square = piece?.closest<HTMLElement>("[data-square]");
      const source = square?.dataset.square;
      if (!piece || !source || !board.contains(piece)) return;
      if (Object.keys(moveTargetStyles(fenRef.current, source)).length === 0) return;

      const rect = piece.getBoundingClientRect();
      session = {
        pointerId: eventId(event),
        source,
        piece,
        ghost: null,
        started: false,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
    };

    const onDragMove = (event: DragEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      if (
        !session.started
        && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 4
      ) {
        return;
      }
      beginPreview(event);
      event.preventDefault();
      event.stopPropagation();
      movePreview(event);
    };

    const onDragUp = (event: DragEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      if (!session.started) {
        session = null;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const source = session.source;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-square]")
        ?.dataset.square;

      // Android kann den zum Pointer-Up gehörenden Kompatibilitäts-Klick erst
      // deutlich später senden. Er darf den eben ausgeführten Zug nicht noch
      // einmal als Click-&-Move-Eingabe behandeln.
      const delayedCompatibilityClick =
        isAndroidWebView() || ("pointerType" in event && event.pointerType === "touch");
      suppressClickUntilRef.current = Date.now() + (delayedCompatibilityClick ? 600 : 50);
      removePreview();
      if (target) dropRef.current?.(source, target);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!session || eventId(event) !== session.pointerId) return;
      removePreview();
    };

    board.addEventListener("pointerdown", onDragDown, true);
    board.addEventListener("mousedown", onDragDown, true);
    window.addEventListener("pointermove", onDragMove, { capture: true, passive: false });
    window.addEventListener("mousemove", onDragMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onDragUp, { capture: true, passive: false });
    window.addEventListener("mouseup", onDragUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      removePreview();
      board.removeEventListener("pointerdown", onDragDown, true);
      board.removeEventListener("mousedown", onDragDown, true);
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("mousemove", onDragMove, true);
      window.removeEventListener("pointerup", onDragUp, true);
      window.removeEventListener("mouseup", onDragUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [mouseDrag]);

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
      className={`kiebitz-board ${shake ? "animate-shake " : ""}${draggable && mouseDrag ? "board-pointer-drag" : ""}`}
      style={{ width: "100%", maxWidth: width }}
      onClickCapture={(event) => {
        if (Date.now() > suppressClickUntilRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClickUntilRef.current = 0;
      }}
      onDragStartCapture={(event) => event.preventDefault()}
    >
      <div className="relative" style={{ width: w, height: w }}>
        <Chessboard
          id={boardId}
          position={fen}
          boardWidth={w}
          arePiecesDraggable={draggable && !mouseDrag}
          onPieceDrop={!mouseDrag && onPieceDrop ? (s, t) => onPieceDrop(s, t) : undefined}
          onPieceDragBegin={draggable && !mouseDrag ? (_piece, source) => setDragSource(source) : undefined}
          onPieceDragEnd={draggable && !mouseDrag ? () => setDragSource(null) : undefined}
          onSquareClick={onSquareClick}
          customSquareStyles={{
            ...selectionStyles(fen, dragSource),
            ...squareStyles,
          }}
          customArrows={arrows as never}
          boardOrientation={orientation}
          animationDuration={isAndroidWebView() ? 0 : 150}
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
