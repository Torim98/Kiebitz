import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess } from "chess.js";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BookOpen,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ListChecks,
  Loader2,
  Save,
  Search,
  Square,
  Zap,
  RotateCcw,
} from "lucide-react";
import { featuredGame } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key, type Locale, type TFunc } from "../lib/i18n";
import { isStoreCapture } from "../lib/storeCapture";
import { useTrainingSession } from "../lib/session";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
import { getGame, listGameSummaries, setGameNote, setGameTags, type GameRecord, type GameSummary } from "../lib/db";
import { chessdbQuery, getSettings, type ChessDbResult } from "../lib/settings";
import {
  cancelAnalysis,
  gameAnalysis,
  onAnalysisDone,
  onAnalysisGameDone,
  onAnalysisProgress,
  searchPosition,
  startAnalysis,
  type AnalysisProgress,
  type MoveEvalRow,
  type PositionSearch,
} from "../lib/analysis";
import Board from "../components/Board";
import { useBoardEndView } from "../components/BoardEndView";
import { endForPosition, gameEnd } from "../lib/boardEnd";
import { BOARD_WIDTH } from "../lib/boardLayout";
import CapturedPieces from "../components/CapturedPieces";
import { capturedFromFen } from "../lib/captured";
import LiveEngine from "../components/LiveEngine";
import TagEditor from "../components/TagEditor";
import { Button, Card, ExtLink, ResultBadge } from "../components/ui";
import { PlusBadge } from "../components/PlusLock";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import { de } from "../lib/format";
import { evalLabel, winProb } from "../lib/evaluation";
import { fenAfter } from "../lib/position";
import { selectionStyles } from "../lib/boardMoves";
import {
  clocksAtPly,
  formatClock,
  parseClocks,
  parseTimeControl,
  timeControlLabel,
} from "../lib/clocks";
import { tcLabel } from "../lib/gameUi";
import { accuraciesFromMoveEvals } from "../lib/accuracy";

/** Einheitliche Zug-Sicht für Demo- und DB-Partien. */
interface ViewMove {
  san: string;
  evalCp: number | null; // nach dem Zug, aus Weiß-Sicht
  mateIn: number | null;
  nag?: string;
  bestUci?: string;
  playedUci?: string;
  judgment?: MoveJudgment;
}

type MoveJudgment =
  | "book"
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/** Buchzüge tragen wie bei chess.com ein Buch-Symbol statt eines Kürzels. */
const NAG: Record<MoveJudgment, string> = {
  book: "",
  brilliant: "!!",
  great: "!",
  best: "★",
  excellent: "✓",
  good: "•",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

const JUDGMENT_COLOR: Record<MoveJudgment, string> = {
  book: "#a88865",
  brilliant: "#22c08a",
  great: "#3987e5",
  best: "#22c08a",
  excellent: "#63bca9",
  good: "#8b8a82",
  inaccuracy: "#d9a028",
  mistake: "#e08a3c",
  blunder: "#e66767",
};

/** Bewertungen, die in der Zugliste ein Kürzel hinter dem Zug tragen. */
const MARKED_IN_LIST: MoveJudgment[] = ["brilliant", "excellent", "inaccuracy", "blunder"];

/**
 * Kürzel bzw. Symbol einer Bewertung. Das Buch bleibt so groß wie die Kürzel
 * daneben, damit alle Marker gleich wirken.
 */
function judgmentMark(judgment: MoveJudgment, size: number | string = "48%"): ReactNode {
  return judgment === "book" ? <BookOpen size={size} strokeWidth={2.6} /> : NAG[judgment];
}

function judgmentLabel(t: TFunc, judgment: string): string {
  const labels: Record<string, Parameters<TFunc>[0]> = {
    book: "an.bookMove",
    brilliant: "an.brilliant",
    great: "an.great",
    best: "an.best",
    excellent: "an.excellent",
    good: "an.good",
    inaccuracy: "an.inaccuracy",
    mistake: "an.mistake",
    blunder: "an.blunder",
  };
  return t(labels[judgment] ?? "an.good");
}

/**
 * Restzeit einer Seite an der gezeigten Stellung.
 *
 * Die Uhr ist keine laufende Uhr, sondern der Stand der Partie an genau diesem
 * Halbzug · beim Blättern läuft sie mit der Zugliste vor und zurück. Die Seite
 * am Zug ist hervorgehoben, darunter steht bei Bedarf, was ihr letzter Zug
 * gekostet hat.
 */
function ClockBadge({
  centiseconds,
  active,
  spent,
  locale,
}: {
  centiseconds: number | null;
  active: boolean;
  /** Verbrauchte Zeit des letzten Zuges dieser Seite (null = unbekannt). */
  spent: number | null;
  locale: Locale;
}) {
  if (centiseconds == null) return null;
  const low = centiseconds < 3000;
  return (
    <span className="flex items-baseline gap-1.5">
      {spent != null && (
        <span className="text-[11px] tabular-nums text-ink3">
          +{formatClock(spent, locale)}
        </span>
      )}
      <span
        className={`rounded-md border px-2 py-0.5 text-[13px] font-semibold tabular-nums ${
          active
            ? low
              ? "border-loss/50 bg-[#2a1414] text-loss"
              : "border-accent-dim bg-accent-soft text-accent"
            : "border-line bg-panel2 text-ink3"
        }`}
      >
        {formatClock(centiseconds, locale)}
      </span>
    </span>
  );
}

/** Zahl fürs Chart / die Eval-Bar: Matt zählt wie ±10 Bauern. */
function evalNum(cp: number | null, mate: number | null): number {
  if (mate != null) return mate > 0 ? 1000 : -1000;
  return cp ?? 0;
}

type Phase = "opening" | "middlegame" | "endgame";

/**
 * Halbzug, an dem Mittel- bzw. Endspiel beginnen · gleiche Regel wie
 * `chess::phase_of` im Backend: Endspiel ab höchstens sechs Offizieren,
 * Eröffnung bis Halbzug 20.
 */
function phaseStarts(sans: string[]): { middlegame: number | null; endgame: number | null } {
  const chess = new Chess();
  let middlegame: number | null = null;
  let endgame: number | null = null;
  for (let i = 0; i < sans.length; i++) {
    try {
      chess.move(sans[i]);
    } catch {
      break;
    }
    const ply = i + 1;
    const officers = chess
      .board()
      .flat()
      .filter((square) => square && "nbrq".includes(square.type)).length;
    const phase: Phase = officers <= 6 ? "endgame" : ply <= 20 ? "opening" : "middlegame";
    if (phase === "middlegame" && middlegame == null) middlegame = ply;
    if (phase === "endgame" && endgame == null) {
      endgame = ply;
      break;
    }
  }
  // Ein Endspiel, das vor Halbzug 21 beginnt, überspringt das Mittelspiel.
  if (endgame != null && middlegame != null && middlegame >= endgame) middlegame = null;
  return { middlegame, endgame };
}

function rowsToViewMoves(sans: string[], rows: MoveEvalRow[]): ViewMove[] {
  const byPly = new Map(rows.map((r) => [r.ply, r]));
  const chess = new Chess();
  let prevEval = 20;
  return sans.map((san, i) => {
    const r = byPly.get(i + 1);
    let playedUci = "";
    try {
      const played = chess.move(san);
      playedUci = `${played.from}${played.to}${played.promotion ?? ""}`;
    } catch {
      // Ungueltige Alt-Daten bleiben weiterhin sichtbar.
    }
    const currentEval = r ? evalNum(r.eval_cp, r.mate_in) : prevEval;
    const before = winProb(prevEval) / 100;
    const after = winProb(currentEval) / 100;
    const drop = i % 2 === 0 ? Math.max(0, before - after) : Math.max(0, after - before);
    const engineJudgment = r?.judgment as MoveJudgment | "" | undefined;
    const isBest = !!r?.best_uci && r.best_uci.slice(0, playedUci.length) === playedUci;
    let judgment: MoveJudgment | undefined = engineJudgment || undefined;
    if (r && !judgment) {
      if (i < 16 && drop < 0.03) judgment = "book";
      else if (isBest && i >= 16 && /[x+#=]/.test(san) && Math.abs(currentEval - prevEval) >= 40) judgment = "brilliant";
      else if (isBest) judgment = "best";
      else if (drop < 0.01) judgment = "great";
      else if (drop < 0.03) judgment = "excellent";
      else if (drop < 0.10) judgment = "good";
    }
    prevEval = currentEval;
    return {
      san,
      evalCp: r ? r.eval_cp : null,
      mateIn: r ? r.mate_in : null,
      nag: judgment ? NAG[judgment] : undefined,
      bestUci: r?.best_uci,
      playedUci,
      judgment,
    };
  });
}

/** ACPL je Seite aus der Evalkurve (Startstellung ≈ +20 cp). */
function acpl(moves: ViewMove[]): { white: number; black: number } {
  let prev = 20;
  const losses: { white: number[]; black: number[] } = { white: [], black: [] };
  moves.forEach((m, i) => {
    if (m.evalCp == null && m.mateIn == null) return;
    const cur = Math.max(-1000, Math.min(1000, evalNum(m.evalCp, m.mateIn)));
    const side = i % 2 === 0 ? "white" : "black";
    const loss = side === "white" ? prev - cur : cur - prev;
    losses[side].push(Math.max(0, Math.min(1000, loss)));
    prev = cur;
  });
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : 0);
  return { white: avg(losses.white), black: avg(losses.black) };
}

/** Kommentar zu einem annotierten Zug: Bewertungssprung + bessere Alternative. */
function commentFor(t: TFunc, sansBefore: string[], m: ViewMove, prevEval: number): string | null {
  if (!m.judgment) return null;
  if (!(["inaccuracy", "mistake", "blunder"] as MoveJudgment[]).includes(m.judgment)) {
    return t("an.qualityComment", { judgment: judgmentLabel(t, m.judgment) });
  }
  let best = "";
  if (m.bestUci) {
    try {
      const chess = new Chess();
      for (const s of sansBefore) chess.move(s);
      const move = chess.move({
        from: m.bestUci.slice(0, 2),
        to: m.bestUci.slice(2, 4),
        promotion: m.bestUci.length > 4 ? m.bestUci[4] : undefined,
      });
      best = move.san;
    } catch {
      /* Zug nicht rekonstruierbar · Kommentar ohne Alternative */
    }
  }
  const from = evalLabel(prevEval);
  const to = m.mateIn != null ? `#${m.mateIn}` : evalLabel(m.evalCp ?? 0);
  const base = t("an.comment", { judgment: judgmentLabel(t, m.judgment), from, to });
  return best ? base + t("an.commentBetter", { san: best }) : base;
}

export default function Analysis({ targetGameId }: { targetGameId: number | null }) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const desktop = backend.mode === "desktop";
  // Analysebudget: die Zeit, die vor einer Partie verbracht wird. Bisher zählte
  // nur ein im Kalender abgehakter Termin · eine Engine, die im Hintergrund
  // 1.000 Partien rechnet, hat nie ein Partie-Review ersetzt, aber wer eine
  // Stunde lang durch seine Fehler blättert, hat sie auch nicht angesammelt.
  useTrainingSession("analysis", desktop);
  const batchGate = usePlusGate("background_analysis");

  const [games, setGames] = useState<GameSummary[]>([]);
  const [game, setGame] = useState<GameRecord | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scratchSans, setScratchSans] = useState<string[]>([]);
  const [scratchSelected, setScratchSelected] = useState<string | null>(null);
  const [variation, setVariation] = useState<{ basePly: number; sans: string[] } | null>(null);
  const [rows, setRows] = useState<MoveEvalRow[] | null>(null);
  const [ply, setPly] = useState(0);
  const [liveEval, setLiveEval] = useState<{ cp: number | null; mate: number | null } | null>(null);
  const [liveBestUci, setLiveBestUci] = useState<string | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [posSearch, setPosSearch] = useState<PositionSearch | null>(null);
  const [chessdbOn, setChessdbOn] = useState(false);
  const [playerProfile, setPlayerProfile] = useState({ cc: "", li: "", display: "" });
  const [book, setBook] = useState<ChessDbResult | null>(null);
  const [bookState, setBookState] = useState<"idle" | "loading" | "error">("idle");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const reloadGames = useCallback(() => {
    return listGameSummaries().then((gs) => {
      setGames(gs.filter((g) => g.has_moves));
      return gs;
    });
  }, []);

  // Partien laden und Auswahl initialisieren.
  useEffect(() => {
    if (!desktop) return;
    reloadGames().then((gs) => {
      const withMoves = gs.filter((g) => g.has_moves);
      const pick = targetGameId != null ? withMoves.find((g) => g.id === targetGameId) : null;
      setSelectedId(pick?.id ?? null);
    });
  }, [desktop, targetGameId, reloadGames]);

  // Analyse-Events.
  useEffect(() => {
    if (!desktop) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const reg = (p: Promise<() => void>) =>
      p.then((u) => (disposed ? u() : cleanups.push(u)));
    reg(
      onAnalysisProgress((p) => {
        setRunning(true);
        setProgress(p);
      })
    );
    reg(
      onAnalysisGameDone((p) => {
        if (p.game_id === selectedRef.current) {
          gameAnalysis(p.game_id).then(setRows).catch(() => {});
        }
      })
    );
    reg(
      onAnalysisDone((p) => {
        setRunning(false);
        setProgress(null);
        const reloaded = reloadGames();
        if (!p.error && !p.canceled && p.analyzed > 0) {
          void reloaded
            .then((allGames) =>
              maybeRequestPlayReview(backend.info, {
                kind: "analysis-complete",
                totalAnalyzedGames: allGames.filter((game) => game.analyzed).length,
              })
            )
            .catch(() => {});
        }
        setNotice(
          p.error
            ? t("an.aborted", { e: p.error })
            : p.canceled
              ? t("an.stopped", { n: p.analyzed })
              : t("an.finished", { n: p.analyzed })
        );
      })
    );
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [backend.info, desktop, reloadGames, t]);

  // ChessDB-Einstellung einmalig lesen.
  useEffect(() => {
    if (!desktop) return;
    getSettings()
      .then((s) => {
        setChessdbOn(s.chessdb_enabled);
        setPlayerProfile({ cc: s.cc_user ?? "", li: s.li_user ?? "", display: s.display_name ?? "" });
      })
      .catch(() => {});
  }, [desktop]);

  useEffect(() => {
    if (!desktop || selectedId == null) {
      setGame(null);
      return;
    }
    setGame(null);
    let current = true;
    getGame(selectedId)
      .then((record) => { if (current) setGame(record); })
      .catch(() => { if (current) setGame(null); });
    return () => { current = false; };
  }, [desktop, selectedId]);

  const scratch = desktop && selectedId == null;

  // Gespeicherte Analyse der gewählten Partie laden.
  useEffect(() => {
    if (!desktop || selectedId == null) return;
    setRows(null);
    gameAnalysis(selectedId).then(setRows).catch(() => setRows([]));
  }, [desktop, selectedId]);

  // Zug-Sicht: Demo im Web, echte Partie auf dem Desktop.
  const live = desktop && game != null;
  const sans = useMemo(
    () => live
      ? game.moves.split(" ").filter(Boolean)
      : scratch
        ? scratchSans
        : featuredGame.moves.map((m) => m.san),
    [live, game, scratch, scratchSans]
  );
  const viewMoves: ViewMove[] = useMemo(() => {
    if (!desktop) {
      const byNag: Record<string, MoveJudgment> = { "?!": "inaccuracy", "?": "mistake", "??": "blunder" };
      return featuredGame.moves.map((m) => ({
        san: m.san,
        evalCp: m.eval,
        mateIn: null,
        nag: m.nag,
        judgment: m.nag ? byNag[m.nag] : undefined,
      }));
    }
    return rowsToViewMoves(sans, live ? rows ?? [] : []);
  }, [desktop, live, sans, rows]);

  const analyzedRows = live ? (rows?.length ?? 0) > 0 : true;

  // Notizen und Tags der gewählten Partie in die Eingaben übernehmen.
  useEffect(() => {
    setNoteDraft(game?.note ?? "");
    setNoteSaved(false);
    setNotesError(null);
  }, [game?.id, game?.note]);

  /** Aktualisiert die Partie lokal, damit Liste und Panel sofort stimmen. */
  const patchGame = (patch: Partial<GameRecord>) => {
    setGame((current) => current ? { ...current, ...patch } : current);
    setGames((current) => current.map((g) =>
      g.id === selectedId
        ? { ...g, ...patch, has_note: patch.note == null ? g.has_note : Boolean(patch.note.trim()) }
        : g
    ));
  };

  const saveNote = async () => {
    if (!game?.id) return;
    setNotesError(null);
    try {
      await setGameNote(game.id, noteDraft);
      patchGame({ note: noteDraft });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    } catch (e) {
      setNotesError(String(e));
    }
  };

  const saveTags = async (next: string[]) => {
    if (!game?.id) return;
    setNotesError(null);
    try {
      patchGame({ tags: await setGameTags(game.id, next) });
    } catch (e) {
      setNotesError(String(e));
    }
  };

  // Beim Partiewechsel ans Ende springen.
  useEffect(() => {
    setPly(sans.length);
    setLiveEval(null);
    setLiveBestUci(null);
    setScratchSelected(null);
    setVariation(null);
  }, [selectedId, sans.length]);

  const fen = useMemo(
    () => variation
      ? fenAfter([...sans.slice(0, variation.basePly), ...variation.sans])
      : fenAfter(sans, ply),
    [sans, ply, variation]
  );

  /**
   * Partieende · nur an der Schlussstellung der Partie selbst. Wer
   * zurückblättert oder in einer Variante steht, sieht eine Stellung, die so
   * nie das Ende war; dort wäre der Hinweis schlicht falsch.
   *
   * Bei importierten Partien schlägt der gespeicherte Grund die Ableitung: nur
   * er kennt Aufgabe und Zeitüberschreitung. Am freien Brett und in der
   * Web-Vorschau bleibt, was in der Stellung steht.
   */
  const boardEndState = useMemo(() => {
    if (variation || ply !== sans.length || sans.length === 0) return null;
    if (live && game) {
      return gameEnd({
        fen,
        termination: game.termination,
        result: game.result,
        color: game.color,
      });
    }
    return endForPosition(fen);
  }, [variation, ply, sans.length, live, game, fen]);
  const boardEnd = useBoardEndView(boardEndState);

  const playBoardMove = (from: string, to: string, promotion = "q"): boolean => {
    if (!scratch && !live) return false;
    try {
      const chess = new Chess(fen);
      const move = chess.move({ from, to, promotion });
      if (scratch) {
        const next = [...scratchSans.slice(0, ply), move.san];
        setScratchSans(next);
        setPly(next.length);
      } else {
        setVariation((current) => current
          ? { ...current, sans: [...current.sans, move.san] }
          : { basePly: ply, sans: [move.san] });
      }
      setScratchSelected(null);
      setLiveEval(null);
      setLiveBestUci(null);
      return true;
    } catch {
      return false;
    }
  };

  const onBoardSquareClick = (square: string) => {
    if (!scratch && !live) return;
    const chess = new Chess(fen);
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (scratchSelected && scratchSelected !== square) {
      const moved = playBoardMove(scratchSelected, square);
      setScratchSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setScratchSelected(scratchSelected === square ? null : square);
    }
  };

  // Tastatur-Navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setVariation(null);
        setPly((p) => Math.max(0, p - 1));
      }
      if (e.key === "ArrowRight") {
        setVariation(null);
        setPly((p) => Math.min(sans.length, p + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sans.length]);

  // Positionssuche (entprellt).
  useEffect(() => {
    if (!desktop) return;
    const timer = setTimeout(() => {
      searchPosition(fen).then(setPosSearch).catch(() => setPosSearch(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [desktop, fen]);

  // ChessDB-Eröffnungsbuch (entprellt, cache-gestützt im Backend).
  useEffect(() => {
    if (!desktop || !chessdbOn) return;
    setBookState("loading");
    let stale = false;
    const timer = setTimeout(() => {
      chessdbQuery(fen)
        .then((r) => {
          if (!stale) {
            setBook(r);
            setBookState("idle");
          }
        })
        .catch(() => {
          if (!stale) {
            setBook(null);
            setBookState("error");
          }
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [desktop, chessdbOn, fen]);

  // Eval an der aktuellen Stellung: live von der Engine, sonst gespeichert.
  const storedPly = variation?.basePly ?? ply;
  const storedEval = storedPly === 0 ? 20 : evalNum(viewMoves[storedPly - 1]?.evalCp ?? null, viewMoves[storedPly - 1]?.mateIn ?? null);
  const shownEval = liveEval ? evalNum(liveEval.cp, liveEval.mate) : storedEval;
  const whitePct = winProb(shownEval);
  const currentMove = !variation && ply > 0 ? viewMoves[ply - 1] : null;
  const currentComment = useMemo(() => {
    if (!currentMove) return null;
    if (scratch || variation) return null;
    if (!live) return featuredGame.moves[ply - 1]?.comment ?? null;
    const prevEval = ply <= 1 ? 20 : evalNum(viewMoves[ply - 2]?.evalCp ?? null, viewMoves[ply - 2]?.mateIn ?? null);
    return commentFor(t, sans.slice(0, ply - 1), currentMove, prevEval);
  }, [scratch, variation, live, currentMove, ply, sans, viewMoves, t]);

  const evalSeries = viewMoves
    .map((m, i) => ({ ply: i + 1, eval: Math.max(-600, Math.min(600, evalNum(m.evalCp, m.mateIn))) / 100 }))
    .filter((_, i) => !live || (rows ?? []).length > i);

  // Phasengrenzen und aktuelle Position für die Bewertungskurve.
  const phaseMarkers = useMemo(() => {
    const { middlegame, endgame } = phaseStarts(sans);
    const marks: { phase: Phase; ply: number }[] = [{ phase: "opening", ply: 1 }];
    if (middlegame != null) marks.push({ phase: "middlegame", ply: middlegame });
    if (endgame != null) marks.push({ phase: "endgame", ply: endgame });
    return marks;
  }, [sans]);
  const currentPly = variation?.basePly ?? ply;

  // ── Uhren ────────────────────────────────────────────────────────────────
  // Nur echte Partien bringen Zeitdaten mit; fehlen sie, entfällt die Anzeige
  // komplett statt Nullen zu zeigen.
  const clockValues = useMemo(
    () => (live ? parseClocks(game.clocks ?? "") : []),
    [live, game]
  );
  const timeControl = useMemo(
    () => (live ? parseTimeControl(game.time_control ?? "") : null),
    [live, game]
  );
  const clockPly = variation?.basePly ?? ply;
  const clockView = useMemo(
    () => clocksAtPly(clockValues, clockPly, timeControl),
    [clockValues, clockPly, timeControl]
  );
  const hasClocks = clockValues.length > 0;
  // Wer an der gezeigten Stellung am Zug ist · Weiß nach geraden Halbzügen.
  const whiteToMove = clockPly % 2 === 0;
  const spentBy = (white: boolean) =>
    hasClocks && clockView.spent != null && whiteToMove !== white ? clockView.spent : null;

  const summary = useMemo(() => {
    const counts: Record<MoveJudgment, number> = {
      book: 0,
      brilliant: 0,
      great: 0,
      best: 0,
      excellent: 0,
      good: 0,
      inaccuracy: 0,
      mistake: 0,
      blunder: 0,
    };
    viewMoves.forEach((m, i) => {
      const mine = !live || !game ? true : (game.color === "white") === (i % 2 === 0);
      if (m.judgment && mine) counts[m.judgment]++;
    });
    return { ...counts, acpl: acpl(viewMoves) };
  }, [viewMoves, live, game]);

  const derivedAccuracies = useMemo(
    () => game && rows?.length ? accuraciesFromMoveEvals(rows, game.color) : null,
    [game, rows]
  );

  const unanalyzed = games.filter((g) => !g.analyzed && !g.analysis_excluded);
  const orientation = live && game.color === "black" ? "black" : "white";
  const ownPlayerName = live
    ? game.my_name?.trim()
      || (game.source === "chess.com" ? playerProfile.cc : game.source === "lichess" ? playerProfile.li : "")
      || playerProfile.display
      || t("an.me")
    : t("an.me");
  const demoPlayer = (label: string) => {
    const match = label.match(/^(.*?)\s*\((\d+)\)$/);
    return { name: match?.[1] ?? label, elo: match ? Number(match[2]) : 0 };
  };
  const captureWhite = "Alex (1462)";
  const captureBlack = locale === "de" ? "Springerfreund (1448)" : "KnightFriend (1448)";
  const whitePlayer = live
    ? { name: game.color === "white" ? ownPlayerName : game.opponent, elo: game.color === "white" ? game.my_elo : game.opp_elo }
    : scratch ? { name: t("common.white"), elo: 0 } : demoPlayer(storeCapture ? captureWhite : featuredGame.white);
  const blackPlayer = live
    ? { name: game.color === "black" ? ownPlayerName : game.opponent, elo: game.color === "black" ? game.my_elo : game.opp_elo }
    : scratch ? { name: t("common.black"), elo: 0 } : demoPlayer(storeCapture ? captureBlack : featuredGame.black);
  const topPlayer = orientation === "white" ? blackPlayer : whitePlayer;
  const bottomPlayer = orientation === "white" ? whitePlayer : blackPlayer;
  // Geschlagene Figuren zur gezeigten Stellung · jede Seite bekommt, was sie
  // selbst geschlagen hat, und der Führende zusätzlich seinen Vorsprung.
  const captured = capturedFromFen(fen);
  const topIsWhite = orientation !== "white";
  const accuracyCells = live ? [
    {
      key: "overall",
      label: t("an.overallAccuracy"),
      mine: game.accuracy ?? derivedAccuracies?.mine.overall ?? null,
      opponent: game.opponent_accuracy ?? derivedAccuracies?.opponent.overall ?? null,
    },
    {
      key: "opening",
      label: t("ins.phase.opening"),
      mine: game.accuracy_opening ?? derivedAccuracies?.mine.opening ?? null,
      opponent: game.opponent_accuracy_opening ?? derivedAccuracies?.opponent.opening ?? null,
    },
    {
      key: "middlegame",
      label: t("ins.phase.middlegame"),
      mine: game.accuracy_middlegame ?? derivedAccuracies?.mine.middlegame ?? null,
      opponent: game.opponent_accuracy_middlegame ?? derivedAccuracies?.opponent.middlegame ?? null,
    },
    {
      key: "endgame",
      label: t("ins.phase.endgame"),
      mine: game.accuracy_endgame ?? derivedAccuracies?.mine.endgame ?? null,
      opponent: game.opponent_accuracy_endgame ?? derivedAccuracies?.opponent.endgame ?? null,
    },
  ] : [];
  const currentQuality = currentMove?.judgment;
  const currentTarget = currentMove?.playedUci?.slice(2, 4);
  const nextMove = !variation ? viewMoves[ply] : null;
  const nextBestUci = liveBestUci || nextMove?.bestUci || "";
  const previewArrows: [string, string, string?][] = nextMove
    ? [
        ...(nextBestUci ? [[nextBestUci.slice(0, 2), nextBestUci.slice(2, 4), "rgba(34,192,138,0.78)"] as [string, string, string]] : []),
        ...(nextMove.playedUci && nextMove.playedUci.slice(0, 4) !== nextBestUci.slice(0, 4)
          ? [[nextMove.playedUci.slice(0, 2), nextMove.playedUci.slice(2, 4), "rgba(217,160,40,0.78)"] as [string, string, string]]
          : []),
      ]
    : nextBestUci ? [[nextBestUci.slice(0, 2), nextBestUci.slice(2, 4), "rgba(34,192,138,0.78)"]] : [];
  const liveArrows: [string, string, string?][] = liveBestUci
    ? [[liveBestUci.slice(0, 2), liveBestUci.slice(2, 4), "rgba(34,192,138,0.78)"]]
    : [];
  const goToPly = (next: number) => {
    setVariation(null);
    setScratchSelected(null);
    setLiveEval(null);
    setLiveBestUci(null);
    setPly(Math.max(0, Math.min(sans.length, next)));
  };
  /**
   * Direktsprung zur Originalpartie, wie im Dashboard und im Partien-Tab.
   * Fehlt die gespeicherte URL (ältere Importe, PGN-Import), führt der Link
   * ersatzweise ins Partiearchiv des eigenen Kontos. Ohne konfigurierten
   * Kontonamen entfällt der Link ganz · eine Archiv-URL ohne Benutzernamen
   * wäre ein Link ins Leere. Manuell erfasste Partien haben kein Original.
   */
  const originUrl = useMemo(() => {
    if (!live || game.source === "manual") return null;
    if (game.url) return game.url;
    const handle = (game.source === "chess.com" ? playerProfile.cc : playerProfile.li).trim();
    if (!handle) return null;
    return game.source === "chess.com"
      ? `https://www.chess.com/games/archive/${encodeURIComponent(handle)}`
      : `https://lichess.org/@/${encodeURIComponent(handle)}/all`;
  }, [live, game, playerProfile.cc, playerProfile.li]);

  // Die Bedenkzeit-Vorgabe steht neben der Zeitklasse, sobald sie bekannt ist ·
  // "Blitz · 3+2" sagt mehr als "Blitz".
  const tcSuffix = live ? timeControlLabel(game.time_control ?? "") : null;
  const headerSub = live
    ? `${game.color === "white" ? ownPlayerName : game.opponent} vs. ${game.color === "white" ? game.opponent : ownPlayerName} · ${tcLabel(game.time_class, locale)}${tcSuffix ? ` ${tcSuffix}` : ""} · ${game.opening || game.eco || "—"} · ${game.played_at}`
    : scratch
      ? t("an.freeBoardHint")
      : storeCapture
        ? `${captureWhite} vs. ${captureBlack} · Rapid · 1–0`
        : `${featuredGame.white} vs. ${featuredGame.black} · ${featuredGame.event} · ${featuredGame.result}`;

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("an.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{headerSub}</p>
        </div>
        {live && (
          <div className="flex shrink-0 items-center gap-3">
            {originUrl && (
              <ExtLink
                href={originUrl}
                label={t("an.original")}
                title={t("an.originalTitle", { p: game.source })}
              />
            )}
            <ResultBadge result={game.result} />
          </div>
        )}
      </header>

      {desktop && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5"
          data-tour="analysis-run"
        >
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            className="min-w-0 max-w-[380px] flex-1 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
          >
            <option value="">{t("an.freeBoard")}</option>
            {games.map((g) => (
              <option key={g.id} value={g.id ?? undefined}>
                {g.analyzed ? "✓" : "○"} {g.played_at} · {g.opponent} ·{" "}
                {g.result === "win" ? t("common.win") : g.result === "loss" ? t("common.loss") : t("common.draw")}
              </option>
            ))}
          </select>

          {running ? (
            <>
              <div className="flex min-w-[220px] flex-1 items-center gap-2 text-[12px] text-ink2">
                <Loader2 size={14} className="animate-spin text-accent" />
                {progress
                  ? t("an.progress", {
                      i: progress.game_index,
                      n: progress.games_total,
                      opp: progress.opponent,
                      a: Math.ceil(progress.ply / 2),
                      b: Math.ceil(progress.plies / 2),
                    })
                  : t("an.running")}
                {progress && (
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${(progress.ply / progress.plies) * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <Button onClick={() => cancelAnalysis()}>
                <Square size={13} /> {t("an.stop")}
              </Button>
            </>
          ) : (
            <>
              {selectedId != null && (
                <Button
                  primary
                  onClick={() => {
                    setNotice(null);
                    setRunning(true);
                    startAnalysis({ gameIds: [selectedId] }).catch((e) => {
                      setRunning(false);
                      setNotice(String(e));
                    });
                  }}
                >
                  <Zap size={14} />
                  {analyzedRows ? t("an.reanalyze") : t("an.analyzeThis")}
                </Button>
              )}
              {/* Eine Partie analysieren bleibt frei. Der Lauf über die ganze
                  Historie ist die automatische Hintergrundanalyse und damit
                  eine Plus-Funktion · sichtbar bleibt sie trotzdem. */}
              {unanalyzed.length > 0 && (
                <Button
                  onClick={() => {
                    if (!batchGate.unlocked) {
                      openPlusDialog("background_analysis");
                      return;
                    }
                    setNotice(null);
                    setRunning(true);
                    startAnalysis({ limit: 10 }).catch((e) => {
                      setRunning(false);
                      setNotice(String(e));
                    });
                  }}
                >
                  <ListChecks size={14} /> {t("an.nextTen", { n: unanalyzed.length })}
                  {!batchGate.unlocked && !batchGate.pending && <PlusBadge />}
                </Button>
              )}
              {unanalyzed.length > 10 && (
                <Button
                  onClick={() => {
                    if (!batchGate.unlocked) {
                      openPlusDialog("background_analysis");
                      return;
                    }
                    setNotice(null);
                    setRunning(true);
                    startAnalysis({}).catch((e) => {
                      setRunning(false);
                      setNotice(String(e));
                    });
                  }}
                >
                  {t("an.analyzeAll")}
                  {!batchGate.unlocked && !batchGate.pending && <PlusBadge />}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent">
          {notice}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(400px,528px)_minmax(320px,1fr)] min-[1660px]:grid-cols-[560px_minmax(360px,1fr)_340px]">
        {/* Brett + Eval-Bar (Bar streckt sich auf Board-Höhe) */}
        <div className="min-w-0 min-[1660px]:w-[560px]">
          <div className="mb-2 flex min-h-[26px] items-start justify-between gap-3 pl-8 text-[12.5px]">
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink2">{topPlayer.name}{topPlayer.elo > 0 ? ` (${topPlayer.elo})` : ""}</div>
              <CapturedPieces
                pieces={topIsWhite ? captured.white : captured.black}
                color={topIsWhite ? "black" : "white"}
                advantage={topIsWhite ? captured.diff : -captured.diff}
              />
            </div>
            {hasClocks && (
              <ClockBadge
                centiseconds={orientation === "white" ? clockView.black : clockView.white}
                active={orientation === "white" ? !whiteToMove : whiteToMove}
                spent={spentBy(orientation !== "white")}
                locale={locale}
              />
            )}
          </div>
          <div className="flex gap-3">
            <div className="flex w-5 shrink-0 flex-col self-stretch overflow-hidden rounded-md border border-line">
              <div className="w-full" style={{ height: `${100 - whitePct}%`, background: "#3a3a37", transition: "height 0.3s" }} />
              <div className="w-full bg-[#e6e3d3]" style={{ height: `${whitePct}%`, transition: "height 0.3s" }} />
            </div>
            <div className="min-w-0 flex-1">
              <Board
                boardId="analysis"
                fen={fen}
                width={BOARD_WIDTH}
                orientation={orientation}
                draggable={scratch || live}
                onPieceDrop={scratch || live ? playBoardMove : undefined}
                onSquareClick={scratch || live ? onBoardSquareClick : undefined}
                squareStyles={selectionStyles(fen, scratchSelected)}
                arrows={variation || scratch ? liveArrows : previewArrows}
                badges={currentQuality && currentTarget ? [{
                  square: currentTarget,
                  label: judgmentMark(currentQuality),
                  color: JUDGMENT_COLOR[currentQuality],
                  title: judgmentLabel(t, currentQuality),
                }] : []}
                muted={!!variation}
                end={boardEnd}
                mouseDrag
              />
            </div>
          </div>
          <div className="mt-2 flex min-h-[26px] items-start justify-between gap-3 pl-8 text-[12.5px]">
            <div className="min-w-0">
              <div className="truncate font-semibold text-ink2">{bottomPlayer.name}{bottomPlayer.elo > 0 ? ` (${bottomPlayer.elo})` : ""}</div>
              <CapturedPieces
                pieces={topIsWhite ? captured.black : captured.white}
                color={topIsWhite ? "white" : "black"}
                advantage={topIsWhite ? -captured.diff : captured.diff}
              />
            </div>
            {hasClocks && (
              <ClockBadge
                centiseconds={orientation === "white" ? clockView.white : clockView.black}
                active={orientation === "white" ? whiteToMove : !whiteToMove}
                spent={spentBy(orientation === "white")}
                locale={locale}
              />
            )}
          </div>
          {variation && (
            <div className="ml-8 mt-2 flex items-center justify-between rounded-lg border border-line2 bg-panel2 px-3 py-2 text-[12px]">
              <span className="text-ink2">{t("an.variationAt", { n: Math.floor(variation.basePly / 2) + 1 })}: <strong className="text-accent">{variation.sans.join(" ")}</strong></span>
              <button onClick={() => goToPly(variation.basePly)} className="ml-3 text-ink3 transition-colors hover:text-ink">
                {t("an.returnToGame")}
              </button>
            </div>
          )}
          {/* „Neu“, vier Sprungtasten und die Bewertung passen auf einem Telefon
              nicht nebeneinander · früher schob das die Bewertung aus dem Bild.
              „Neu“ ist deshalb ein eigenes Umbruch-Element: reicht die Breite
              nicht, rückt es allein in die erste Zeile, während Sprungtasten und
              Bewertung als Paar zusammenbleiben · die Bewertung immer rechts. */}
          <div className="mt-3 flex flex-wrap items-center gap-2 pl-8">
            {scratch && (
              <Button
                onClick={() => {
                  setScratchSans([]);
                  setPly(0);
                  setScratchSelected(null);
                  setLiveEval(null);
                  setLiveBestUci(null);
                }}
              >
                <RotateCcw size={15} /> {t("an.newBoard")}
              </Button>
            )}
            {/* Bewusst ohne `min-w-0`: Mit ihm dürfte dieser Block unter seine
                Inhaltsbreite schrumpfen, und dann bricht die Zeile nie um — sie
                quetscht sich, und die Bewertung rutscht rechts aus dem Bild.
                Mit der automatischen Mindestbreite passt entweder alles in eine
                Zeile, oder „Neu" rückt allein in die erste. */}
            <div className="flex flex-1 items-center justify-between gap-2">
              <div className="flex gap-1">
                <Button onClick={() => goToPly(0)}><ChevronFirst size={15} /></Button>
                <Button onClick={() => goToPly((variation?.basePly ?? ply) - 1)}><ChevronLeft size={15} /></Button>
                <Button onClick={() => goToPly((variation?.basePly ?? ply) + 1)}><ChevronRight size={15} /></Button>
                <Button onClick={() => goToPly(sans.length)}><ChevronLast size={15} /></Button>
              </div>
              <div className="shrink-0 text-[15px] font-semibold tabular-nums" style={{ color: shownEval >= 0 ? "var(--color-ink)" : "var(--color-ink2)" }}>
                {liveEval?.mate != null ? `#${liveEval.mate}` : evalLabel(shownEval)}
              </div>
            </div>
          </div>
        </div>

        {/* Zugliste + Eval-Graph */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={scratch ? t("an.freeBoard") : t("an.game")} pad={false} className="flex-1">
            <div className="max-h-[290px] overflow-y-auto p-3">
              <div className="flex flex-wrap gap-x-1 gap-y-1.5 text-[13.5px] leading-relaxed">
                {viewMoves.map((m, i) => (
                  <span key={i} className="inline-flex items-center">
                    {i % 2 === 0 && (
                      <span className="mr-1 text-[12px] text-ink3">{i / 2 + 1}.</span>
                    )}
                    <button
                      onClick={() => goToPly(i + 1)}
                      title={m.judgment ? judgmentLabel(t, m.judgment) : undefined}
                      className={`rounded px-1 py-0.5 font-medium transition-colors ${
                        !variation && ply === i + 1 ? "bg-accent-soft text-accent" : "hover:bg-panel2"
                      }`}
                    >
                      {m.san}
                      {m.nag && m.judgment && MARKED_IN_LIST.includes(m.judgment) && (
                        <span className="ml-0.5" style={{ color: JUDGMENT_COLOR[m.judgment] }}>{m.nag}</span>
                      )}
                    </button>
                  </span>
                ))}
              </div>
              {live && !analyzedRows && (
                <div className="mt-3 rounded-lg border border-dashed border-line2 px-3 py-2 text-[12px] text-ink3">
                  {t("an.notAnalyzed")}
                </div>
              )}
              {currentComment && (
                <div className="mt-3 rounded-lg border-l-2 bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink2"
                  style={{ borderColor: currentMove?.judgment ? JUDGMENT_COLOR[currentMove.judgment] : "var(--color-accent)" }}>
                  <span className="font-medium" style={{ color: currentMove?.judgment ? JUDGMENT_COLOR[currentMove.judgment] : "var(--color-accent)" }}>
                    {Math.ceil(ply / 2)}.{ply % 2 === 0 ? ".." : ""} {currentMove?.san}{currentMove?.nag}
                  </span>{" "}
                  {currentComment}
                </div>
              )}
            </div>
          </Card>

          <Card title={t("an.evalChart")} pad={false}>
            <div className="px-2 pb-1 pt-2">
              {evalSeries.length >= 2 ? (
                <ResponsiveContainer width="100%" height={110}>
                  <AreaChart data={evalSeries} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}
                    onClick={(e) => e?.activeLabel != null && goToPly(Number(e.activeLabel))}>
                    <XAxis dataKey="ply" hide />
                    <YAxis domain={[-6, 6]} hide />
                    <ReferenceLine y={0} stroke="#3a3a37" />
                    {/* Phasengrenzen: dünne Linie mit stehendem Namen. */}
                    {phaseMarkers.map((marker) => (
                      <ReferenceLine
                        key={marker.phase}
                        x={marker.ply}
                        stroke="var(--color-line2)"
                        strokeDasharray="2 3"
                        label={{
                          value: t(`ins.phase.${marker.phase}` as Key),
                          position: { x: 8, y: 6 },
                          angle: -90,
                          fill: "var(--color-ink3)",
                          fontSize: 9.5,
                        }}
                      />
                    ))}
                    {/* Aktueller Zug. */}
                    {currentPly > 0 && currentPly <= evalSeries.length && (
                      <ReferenceLine x={currentPly} stroke="var(--color-accent)" strokeWidth={1.5} />
                    )}
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="rounded-md border border-line2 bg-panel3 px-2 py-1 text-[12px]">
                            {t("an.moveTooltip", {
                              n: Math.ceil(Number(payload[0].payload.ply) / 2),
                              e: evalLabel(Number(payload[0].value) * 100),
                            })}
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="eval" stroke="#22c08a" strokeWidth={2}
                      fill="#22c08a" fillOpacity={0.12} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[110px] items-center justify-center text-[12px] text-ink3">
                  {t("an.noEvalData")}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Engine-Panel + Annotationen + Positionssuche */}
        <div className="flex min-w-0 flex-col gap-4 min-[1100px]:contents">
          <LiveEngine
            fen={fen}
            demoLines={scratch ? [] : featuredGame.pvLines}
            onEval={(cp, mate) => setLiveEval({ cp, mate })}
            onBestMove={setLiveBestUci}
            onMove={(uci) => playBoardMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] ?? "q")}
          />

          <Card title={live ? t("an.myMoves") : t("an.autoAnnotation")}>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              {(["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "blunder"] as MoveJudgment[]).map((quality) => (
                <li key={quality} className="flex min-w-0 justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 truncate" style={{ color: JUDGMENT_COLOR[quality] }}>
                    {judgmentMark(quality, 13)} <span className="truncate">{judgmentLabel(t, quality)}</span>
                  </span>
                  <span className="font-medium">{summary[quality]}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
              {t("an.acpl")}{" "}
              <span className="text-ink2">{t("common.white")} {desktop ? summary.acpl.white : featuredGame.summary.acplWhite}</span> ·{" "}
              <span className="text-ink2">{t("common.black")} {desktop ? summary.acpl.black : featuredGame.summary.acplBlack}</span>
            </div>
          </Card>

          {live && (
            <Card title={t("an.phaseAccuracy")}>
              <div className="grid grid-cols-2 gap-2">
                {accuracyCells.map(({ key, label, mine, opponent }) => (
                  <div key={key} role="group" aria-label={label} className="min-w-0 rounded-lg bg-panel2 px-2 py-2">
                    <div className="mb-1.5 text-center text-[10.5px] font-medium text-ink3">{label}</div>
                    <div className="space-y-1 text-[11.5px]">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-ink3" title={ownPlayerName}>{ownPlayerName}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink2">
                          {mine == null ? "—" : `${de(mine)} %`}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-ink3" title={game.opponent}>{game.opponent}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-ink2">
                          {opponent == null ? "—" : `${de(opponent)} %`}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {accuracyCells.slice(1).every(({ mine, opponent }) => mine == null && opponent == null) && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("an.phaseAccuracyMissing")}</p>
              )}
            </Card>
          )}

          {live && (
            <Card title={t("an.notesAndTags")}>
              <TagEditor key={game.id} tags={game.tags ?? []} onChange={saveTags} />
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("games.notesPlaceholder")}
                rows={4}
                className="mt-3 w-full resize-y rounded-lg border border-line bg-panel2 p-2.5 text-[12.5px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <Button primary onClick={saveNote} disabled={noteDraft === (game.note ?? "")}>
                  <Save size={14} /> {noteSaved ? t("games.noteSaved") : t("games.saveNote")}
                </Button>
              </div>
              {notesError && (
                <div className="mt-2 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12px] text-loss">
                  {notesError}
                </div>
              )}
            </Card>
          )}

          {desktop && chessdbOn && (
            <Card title={t("an.book")}>
              {bookState === "loading" && !book ? (
                <div className="text-[12px] text-ink3">{t("an.bookLoading")}</div>
              ) : bookState === "error" ? (
                <div className="text-[12px] text-ink3">{t("an.bookError")}</div>
              ) : book && book.status === "ok" && book.moves.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {book.moves.slice(0, 5).map((m) => (
                    <div key={m.uci} className="flex items-center justify-between text-[12.5px]">
                      <span className="w-14 font-medium">{m.san || m.uci}</span>
                      <span className="tabular-nums text-ink2">
                        {m.score != null
                          ? `${m.score >= 0 ? "+" : "−"}${de(Math.abs(m.score) / 100, 2)}`
                          : "—"}
                      </span>
                      <span className="w-16 text-right text-[11.5px] text-ink3">
                        {m.winrate != null ? `${m.winrate} %` : ""}
                      </span>
                    </div>
                  ))}
                  {book.cached && (
                    <div className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink3">
                      {t("an.bookCached")}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-ink3">{t("an.bookUnknown")}</div>
              )}
            </Card>
          )}

          {desktop && (
            <Card title={t("an.posInGames")}>
              {posSearch && posSearch.total_games > 0 ? (
                <>
                  <div className="text-[12.5px] text-ink2">
                    <Search size={13} className="mr-1.5 inline text-accent" />
                    {t(posSearch.total_games === 1 ? "an.reachedIn.one" : "an.reachedIn.many", {
                      n: posSearch.total_games,
                    })}
                  </div>
                  <div className="mt-2.5 flex flex-col gap-1.5">
                    {posSearch.next_moves.slice(0, 4).map((m) => (
                      <div key={m.san} className="flex items-center gap-2 text-[12.5px]">
                        <span className="w-14 font-medium">{m.san}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${m.score_pct}%`,
                              background: m.score_pct >= 50 ? "var(--color-win)" : "var(--color-loss)",
                            }}
                          />
                        </div>
                        <span className="w-20 text-right tabular-nums text-ink3">
                          {m.games}× · {Math.round(m.score_pct)} %
                        </span>
                      </div>
                    ))}
                  </div>
                  {posSearch.sample.filter((h) => h.game_id !== selectedId).length > 0 && (
                    <div className="mt-3 border-t border-line pt-2.5">
                      {posSearch.sample
                        .filter((h) => h.game_id !== selectedId)
                        .slice(0, 4)
                        .map((h) => (
                          <button
                            key={`${h.game_id}-${h.ply}`}
                            onClick={() => {
                              setSelectedId(h.game_id);
                              setTimeout(() => setPly(h.ply), 0);
                            }}
                            className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-[12px] text-ink2 transition-colors hover:bg-panel2"
                          >
                            <span className="truncate">{h.played_at} · {h.opponent}</span>
                            <span
                              className="ml-2 shrink-0"
                              style={{
                                color:
                                  h.result === "win"
                                    ? "var(--color-win)"
                                    : h.result === "loss"
                                      ? "var(--color-loss)"
                                      : "var(--color-draw)",
                              }}
                            >
                              {h.result === "win" ? "1–0" : h.result === "loss" ? "0–1" : "½"}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[12px] leading-relaxed text-ink3">
                  {t("an.posNotFound")}
                </div>
              )}
            </Card>
          )}

          {!desktop && (
            <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
              <Cpu size={13} className="mr-1.5 inline" />
              {t("an.demoNote")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
