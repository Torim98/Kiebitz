import { Chessboard } from "react-chessboard";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { lastMoveStyles, moveTargetStyles, selectionStyles } from "../lib/boardMoves";
import { DEFAULT_PIECE_SET, PIECE_VIEWBOX, pieceGlyphs, type PieceSetId } from "../lib/pieces/sets";
import { usePieceSet } from "../lib/pieces/usePieceSet";
import { soundsForTransition } from "../lib/boardSound";
import { playBoardSound } from "../lib/sound";

/**
 * Feldfarben kommen aus dem Thema (src/themes.css) · react-chessboard setzt
 * sie als CSS-Eigenschaft, deshalb trägt eine Variable hier genauso wie ein
 * Farbwert, und der Themenwechsel braucht kein Neurendern des Bretts.
 */
const boardTheme = {
  customDarkSquareStyle: { backgroundColor: "var(--color-board-dark)" },
  customLightSquareStyle: { backgroundColor: "var(--color-board-light)" },
  customBoardStyle: {
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 0 0 1px var(--color-line)",
  },
};

/** Nebenvariante · dasselbe Brett, entsättigt. */
const mutedBoardTheme = {
  customDarkSquareStyle: { backgroundColor: "var(--color-board-dark-muted)" },
  customLightSquareStyle: { backgroundColor: "var(--color-board-light-muted)" },
};

/**
 * Die Figuren eines gewählten Sets für `react-chessboard`.
 *
 * Der klassische Satz bekommt bewusst *nichts*: Dann zeichnet das Brett seine
 * eigenen Figuren, so wie bisher — ein Umweg über eigene Komponenten wäre für
 * dieselben Zeichnungen nur ein Risiko. Erst ein gewähltes Set legt eine
 * eigene Zeichnung über jedes Feld.
 *
 * Gebaut wird je Set genau einmal: Die Zeichnungen sind unveränderlich, und
 * das Brett fragt bei jedem Zug erneut.
 */
/** Der Typ steht nicht im Paketexport · deshalb aus den Props abgelesen. */
type CustomPieces = NonNullable<ComponentProps<typeof Chessboard>["customPieces"]>;

const customPieceCache = new Map<PieceSetId, CustomPieces>();

function customPiecesFor(set: PieceSetId): CustomPieces | undefined {
  if (set === DEFAULT_PIECE_SET) return undefined;
  const cached = customPieceCache.get(set);
  if (cached) return cached;
  const glyphs = pieceGlyphs(set);
  const pieces: CustomPieces = {};
  for (const [code, glyph] of Object.entries(glyphs)) {
    pieces[code as keyof CustomPieces] = ({ squareWidth }) => (
      <svg
        viewBox={PIECE_VIEWBOX}
        width={squareWidth}
        height={squareWidth}
        // Im Repo erzeugte Zeichnungen · keine Fremdeingabe.
        dangerouslySetInnerHTML={{ __html: glyph }}
      />
    );
  }
  customPieceCache.set(set, pieces);
  return pieces;
}

const EMPTY_ARROWS: [string, string, string?][] = [];
const EMPTY_BADGES: BoardBadge[] = [];
const EMPTY_STYLES: Record<string, CSSProperties> = {};

type BoardArrow = [string, string, string?];
type BoardBadge = { square: string; label: ReactNode; color: string; title?: string };

/**
 * Fertig aufbereitetes Partieende · das Brett übersetzt nichts und entscheidet
 * nichts. Woher Grund und Ausgang kommen, steht in `lib/boardEnd.ts`; wie sie
 * in dieser Ansicht heißen, in `useBoardEndView`.
 */
export type BoardEndView = {
  /** Feld des betroffenen Königs; ohne Feld bleibt nur der Streifen. */
  square: string | null;
  /** Kurzzeichen auf dem Königsfeld ("#", "½", ein Icon). */
  mark: ReactNode;
  /** Farbe von Marker und Ring. */
  color: string;
  /**
   * Übersetzter Satz für den Streifen ("Schwarz gewinnt durch Matt"). Leer
   * heißt: nur der Marker · so bleibt im Puzzle-Trainer das Mattzeichen auf
   * dem König, ohne dass eine gelöste Aufgabe als gewonnene Partie auftritt.
   */
  label: string;
  /** Beschriftung der Schließen-Schaltfläche. */
  dismissLabel: string;
};

type BoardProps = {
  fen: string;
  /** Maximale Brettbreite in px; der Container kann sie unterschreiten. */
  width: number;
  draggable?: boolean;
  onPieceDrop?: (from: string, to: string) => boolean;
  onSquareClick?: (square: string) => void;
  squareStyles?: Record<string, CSSProperties>;
  /**
   * Der Zug, der zur gezeigten Stellung führte · seine beiden Felder werden
   * hell hinterlegt. Die Seiten reichen ihn herein, statt ihn aus dem
   * Stellungswechsel zu erraten: Wer zurückblättert, will den Zug markiert
   * sehen, der zu dieser Stellung führte, und nicht den, der von ihr wegführt.
   */
  lastMove?: { from: string; to: string } | null;
  orientation?: "white" | "black";
  boardId: string;
  shake?: boolean;
  /** Engine-/Partiezug-Pfeile im Format [von, nach, Farbe]. */
  arrows?: BoardArrow[];
  /** Kleine Zugqualitaets-Marker auf der oberen rechten Feldecke. */
  badges?: BoardBadge[];
  /** Varianten werden durch entsaettigte Felder vom Partieverlauf abgesetzt. */
  muted?: boolean;
  /** Gemeinsamer WebView-Drag fuer Maus, Stift und Touch statt react-dnd. */
  mouseDrag?: boolean;
  /** Reine Vorschaubretter bleiben stumm, auch wenn Ton aktiviert ist. */
  silent?: boolean;
  /** Partieende; null solange gespielt wird oder das Brett zurückblättert. */
  end?: BoardEndView | null;
};

function isAndroidWebView(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function requestUiFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelUiFrame(frame: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  else window.clearTimeout(frame);
}

function sameStyleRecord(
  left: Record<string, CSSProperties>,
  right: Record<string, CSSProperties>
): boolean {
  if (left === right) return true;
  const leftSquares = Object.keys(left);
  const rightSquares = Object.keys(right);
  if (leftSquares.length !== rightSquares.length) return false;
  for (const square of leftSquares) {
    const leftStyle = left[square] as Record<string, unknown> | undefined;
    const rightStyle = right[square] as Record<string, unknown> | undefined;
    if (!leftStyle || !rightStyle) return false;
    const leftKeys = Object.keys(leftStyle);
    const rightKeys = Object.keys(rightStyle);
    if (leftKeys.length !== rightKeys.length) return false;
    if (leftKeys.some((key) => leftStyle[key] !== rightStyle[key])) return false;
  }
  return true;
}

type BoardSurfaceProps = {
  boardId: string;
  fen: string;
  width: number;
  draggable: boolean;
  mouseDrag: boolean;
  orientation: "white" | "black";
  dragSource: string | null;
  squareStyles: Record<string, CSSProperties>;
  lastMove: { from: string; to: string } | null;
  muted: boolean;
  pieceSet: PieceSetId;
  android: boolean;
  hasDropHandler: boolean;
  hasSquareClickHandler: boolean;
  onPieceDrop: (from: string, to: string) => boolean;
  onSquareClick: (square: string) => void;
  onPieceDragBegin: (piece: string, source: string) => void;
  onPieceDragEnd: () => void;
};

/**
 * `react-chessboard` places almost all state in one context. Any parent render
 * would therefore reconcile all 64 squares, even when only an engine label or
 * clock changed. This small memo boundary keeps that expensive tree completely
 * untouched until a visual board input actually changes.
 */
const BoardSurface = memo(
  function BoardSurface({
    boardId,
    fen,
    width,
    draggable,
    mouseDrag,
    orientation,
    dragSource,
    squareStyles,
    lastMove,
    muted,
    pieceSet,
    android,
    hasDropHandler,
    hasSquareClickHandler,
    onPieceDrop,
    onSquareClick,
    onPieceDragBegin,
    onPieceDragEnd,
  }: BoardSurfaceProps) {
    // Der letzte Zug liegt zuunterst: Auswahl, Zugpunkte und alles, was eine
    // Seite selbst markiert, sollen ihn überschreiben können.
    const combinedStyles = useMemo(
      () => ({
        ...lastMoveStyles(lastMove),
        ...selectionStyles(fen, dragSource),
        ...squareStyles,
      }),
      [fen, dragSource, lastMove, squareStyles]
    );

    return (
      <Chessboard
        id={boardId}
        position={fen}
        boardWidth={width}
        arePiecesDraggable={draggable && !mouseDrag}
        onPieceDrop={!mouseDrag && hasDropHandler ? onPieceDrop : undefined}
        onPieceDragBegin={draggable && !mouseDrag ? onPieceDragBegin : undefined}
        onPieceDragEnd={draggable && !mouseDrag ? onPieceDragEnd : undefined}
        onSquareClick={hasSquareClickHandler ? onSquareClick : undefined}
        customSquareStyles={combinedStyles}
        boardOrientation={orientation}
        // The shared pointer path reports a move as an external position
        // change. react-chessboard would otherwise lock that board for the
        // animation duration after every user move.
        animationDuration={mouseDrag || android ? 0 : 150}
        customPieces={customPiecesFor(pieceSet)}
        {...boardTheme}
        {...(muted ? mutedBoardTheme : {})}
      />
    );
  },
  (previous, next) =>
    previous.boardId === next.boardId
    && previous.fen === next.fen
    && previous.width === next.width
    && previous.draggable === next.draggable
    && previous.mouseDrag === next.mouseDrag
    && previous.orientation === next.orientation
    && previous.dragSource === next.dragSource
    && previous.lastMove?.from === next.lastMove?.from
    && previous.lastMove?.to === next.lastMove?.to
    && previous.muted === next.muted
    && previous.pieceSet === next.pieceSet
    && previous.android === next.android
    && previous.hasDropHandler === next.hasDropHandler
    && previous.hasSquareClickHandler === next.hasSquareClickHandler
    && sameStyleRecord(previous.squareStyles, next.squareStyles)
);

function squareCenter(square: string, orientation: "white" | "black") {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const x = orientation === "white" ? file : 7 - file;
  const y = orientation === "white" ? 7 - rank : rank;
  return { x: (x + 0.5) * 12.5, y: (y + 0.5) * 12.5 };
}

function sameArrows(left: BoardArrow[], right: BoardArrow[]): boolean {
  return left === right || (
    left.length === right.length
    && left.every((arrow, index) =>
      arrow[0] === right[index]?.[0]
      && arrow[1] === right[index]?.[1]
      && arrow[2] === right[index]?.[2]
    )
  );
}

/** Engine arrows live outside react-chessboard so a changing PV repaints one
 * SVG line instead of invalidating the board context and all 64 squares. */
const BoardArrows = memo(function BoardArrows({
    boardId,
    arrows,
    orientation,
  }: {
    boardId: string;
    arrows: BoardArrow[];
    orientation: "white" | "black";
  }) {
  if (arrows.length === 0) return null;
  const markerPrefix = `kiebitz-arrow-${boardId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const drawable = arrows.flatMap(([fromSquare, toSquare, color], index) => {
    const from = squareCenter(fromSquare, orientation);
    const to = squareCenter(toSquare, orientation);
    if (!from || !to || fromSquare === toSquare) return [];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return [];
    const sharedTarget = arrows.some(
      ([otherFrom, otherTo], otherIndex) =>
        otherIndex !== index && otherFrom !== fromSquare && otherTo === toSquare
    );
    const reducer = sharedTarget ? 6.25 : 3.125;
    return [{
      color: color ?? "rgb(255,170,0)",
      from,
      index,
      to: {
        x: from.x + (dx * (length - reducer)) / length,
        y: from.y + (dy * (length - reducer)) / length,
      },
    }];
  });
  if (drawable.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      data-testid="board-arrows"
      viewBox="0 0 100 100"
    >
      <defs>
        {drawable.map((arrow) => (
          <marker
            key={`marker-${arrow.index}`}
            id={`${markerPrefix}-${arrow.index}`}
            markerHeight="2.5"
            markerWidth="2"
            orient="auto"
            refX="1.25"
            refY="1.25"
          >
            <polygon fill={arrow.color} points="0.3 0, 2 1.25, 0.3 2.5" />
          </marker>
        ))}
      </defs>
      {drawable.map((arrow) => (
        <line
          key={arrow.index}
          data-arrow-index={arrow.index}
          markerEnd={`url(#${markerPrefix}-${arrow.index})`}
          opacity="0.65"
          stroke={arrow.color}
          strokeLinecap="round"
          strokeWidth="2.5"
          x1={arrow.from.x}
          x2={arrow.to.x}
          y1={arrow.from.y}
          y2={arrow.to.y}
        />
      ))}
    </svg>
  );
}, (previous, next) =>
  previous.boardId === next.boardId
  && previous.orientation === next.orientation
  && sameArrows(previous.arrows, next.arrows)
);

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
  lastMove = null,
  orientation = "white",
  boardId,
  shake = false,
  arrows = EMPTY_ARROWS,
  badges = EMPTY_BADGES,
  muted = false,
  mouseDrag = false,
  silent = false,
  end = null,
}: BoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pieceSet = usePieceSet();
  const [w, setW] = useState(width);
  const [dragSource, setDragSource] = useState<string | null>(null);
  const dropRef = useRef(onPieceDrop);
  const squareClickRef = useRef(onSquareClick);
  const draggableRef = useRef(draggable);
  const fenRef = useRef(fen);
  const suppressClickUntilRef = useRef(0);
  const cancelPointerDragRef = useRef<(() => void) | null>(null);

  dropRef.current = onPieceDrop;
  squareClickRef.current = onSquareClick;
  draggableRef.current = draggable;
  fenRef.current = fen;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame: number | null = null;
    const measure = () => {
      const avail = el.clientWidth;
      setW(avail > 0 ? Math.min(width, avail) : width);
    };
    const update = () => {
      if (frame != null) return;
      frame = requestUiFrame(() => {
        frame = null;
        measure();
      });
    };
    measure();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      if (frame != null) cancelUiFrame(frame);
      ro.disconnect();
    };
  }, [width]);

  // Stable proxies let BoardSurface skip parent-only renders without ever
  // retaining stale page callbacks.
  const handlePieceDrop = useCallback(
    (from: string, to: string) => dropRef.current?.(from, to) ?? false,
    []
  );
  const handleSquareClick = useCallback(
    (square: string) => squareClickRef.current?.(square),
    []
  );
  const handlePieceDragBegin = useCallback((_piece: string, source: string) => {
    startTransition(() => setDragSource(source));
  }, []);
  const handlePieceDragEnd = useCallback(() => {
    startTransition(() => setDragSource(null));
  }, []);

  // A new position always ends the old drag, including moves completed by an
  // automated opponent response.
  useEffect(() => {
    cancelPointerDragRef.current?.();
    setDragSource(null);
  }, [fen]);

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
      width: number;
      height: number;
    };

    let session: DragSession | null = null;
    let previewFrame: number | null = null;
    let previewX = 0;
    let previewY = 0;

    const removePreview = () => {
      if (previewFrame != null) {
        cancelUiFrame(previewFrame);
        previewFrame = null;
      }
      if (!session) return;
      session.piece.style.visibility = "";
      session.ghost?.remove();
      session = null;
      startTransition(() => setDragSource(null));
    };
    cancelPointerDragRef.current = removePreview;

    type DragEvent = PointerEvent | MouseEvent;
    const eventId = (event: DragEvent) => ("pointerId" in event ? event.pointerId : -1);

    const paintPreview = () => {
      previewFrame = null;
      if (!session?.ghost) return;
      session.ghost.style.transform = `translate3d(${previewX}px, ${previewY}px, 0)`;
    };

    const movePreview = (event: DragEvent, immediate = false) => {
      if (!session?.ghost) return;
      previewX = event.clientX - session.offsetX;
      previewY = event.clientY - session.offsetY;
      if (immediate) {
        if (previewFrame != null) cancelUiFrame(previewFrame);
        paintPreview();
      } else if (previewFrame == null) {
        // Pointer events can arrive much faster than the display refresh. One
        // transform write per frame keeps input dispatch practically free.
        previewFrame = requestUiFrame(paintPreview);
      }
    };

    const beginPreview = (event: DragEvent) => {
      if (!session || session.started) return;
      session.started = true;
      // Falls die WebView beim ersten Pixel bereits eine Koordinate markiert
      // hat, wird diese Auswahl beim tatsächlichen Drag sofort entfernt.
      window.getSelection()?.removeAllRanges();

      const ghost = session.piece.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: "fixed",
        left: "0",
        top: "0",
        width: `${session.width}px`,
        height: `${session.height}px`,
        margin: "0",
        opacity: "0.94",
        pointerEvents: "none",
        transition: "none",
        willChange: "transform",
        zIndex: "2147483000",
        cursor: "grabbing",
      });
      document.body.appendChild(ghost);
      session.ghost = ghost;
      session.piece.style.visibility = "hidden";
      startTransition(() => setDragSource(session?.source ?? null));
      movePreview(event, true);
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
        width: rect.width,
        height: rect.height,
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
      const targetSquare = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-square]");
      // Several pages can temporarily contain a preview board next to the
      // active one. A drag belongs exclusively to the board it started on.
      const target = targetSquare && board.contains(targetSquare)
        ? targetSquare.dataset.square
        : undefined;

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
      if (cancelPointerDragRef.current === removePreview) {
        cancelPointerDragRef.current = null;
      }
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

  /** Obere linke Ecke eines Feldes in Prozent · Bezugspunkt für den Ring. */
  const squareBox = (square: string) => {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    const x = orientation === "white" ? file : 7 - file;
    const y = orientation === "white" ? 8 - rank : rank - 1;
    return { left: `${x * 12.5}%`, top: `${y * 12.5}%` };
  };

  // Der Streifen ist eine Aussage, keine Sperre: er verschwindet auf Klick und
  // kommt bei jedem neuen Partieende zurück.
  const [endDismissed, setEndDismissed] = useState(false);
  const endKey = end ? `${end.label}|${end.square ?? ""}` : "";
  const lastEndKeyRef = useRef(endKey);
  if (lastEndKeyRef.current !== endKey) {
    lastEndKeyRef.current = endKey;
    if (endDismissed) setEndDismissed(false);
  }
  const endSquare = end?.square && /^[a-h][1-8]$/.test(end.square) ? end.square : null;

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
        <BoardSurface
          android={isAndroidWebView()}
          boardId={boardId}
          dragSource={dragSource}
          draggable={draggable}
          fen={fen}
          hasDropHandler={onPieceDrop != null}
          hasSquareClickHandler={onSquareClick != null}
          mouseDrag={mouseDrag}
          muted={muted}
          onPieceDragBegin={handlePieceDragBegin}
          onPieceDragEnd={handlePieceDragEnd}
          onPieceDrop={handlePieceDrop}
          onSquareClick={handleSquareClick}
          orientation={orientation}
          pieceSet={pieceSet}
          lastMove={lastMove}
          squareStyles={squareStyles ?? EMPTY_STYLES}
          width={w}
        />
        <BoardArrows boardId={boardId} arrows={arrows} orientation={orientation} />
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
        {end && (
          <div data-testid="board-end" aria-live="polite">
            {endSquare && (
              <>
                <span
                  aria-hidden="true"
                  key={`flash-${endKey}`}
                  className="board-end-flash pointer-events-none absolute z-20 h-[12.5%] w-[12.5%] rounded-full"
                  style={{
                    left: squareBox(endSquare).left,
                    top: squareBox(endSquare).top,
                    boxShadow: `inset 0 0 0 max(2px, 0.5vw) ${end.color}`,
                  }}
                />
                {/* Der Marker sitzt auf der oberen rechten Feldecke · dieselbe
                    Stelle wie die Zugqualitaets-Marker. Mittig auf dem Feld
                    verdeckte er die Figur, um die es gerade geht. */}
                <span
                  key={`mark-${endKey}`}
                  data-testid="board-end-mark"
                  className="board-end-mark pointer-events-none absolute z-30 flex h-[7.5%] min-h-4 w-[7.5%] min-w-4 items-center justify-center rounded-full border border-white/90 text-[clamp(8px,1.2vw,13px)] font-extrabold leading-none text-white shadow-lg"
                  style={{ ...badgePosition(endSquare), background: end.color }}
                >
                  {end.mark}
                </span>
              </>
            )}
            {end.label !== "" && !endDismissed && (
              <div className="absolute inset-x-0 bottom-[7%] z-30 flex justify-center px-3">
                <button
                  type="button"
                  key={`strip-${endKey}`}
                  onClick={() => setEndDismissed(true)}
                  title={end.dismissLabel}
                  aria-label={`${end.label} · ${end.dismissLabel}`}
                  className="board-end-strip max-w-full truncate rounded-lg border border-line2 bg-overlay px-3.5 py-1.5 text-[clamp(11px,1.25vw,13.5px)] font-semibold text-ink shadow-xl backdrop-blur-[2px] transition-colors hover:bg-bg"
                >
                  {end.label}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
