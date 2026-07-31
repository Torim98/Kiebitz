import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  Flame,
  Lightbulb,
  Loader2,
  SkipForward,
  Target,
  X,
} from "lucide-react";
import { puzzles as demoPuzzles, puzzleStats as demoStats } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, useT } from "../lib/i18n";
import {
  importPuzzles,
  nextPuzzle,
  onPuzzleImportDone,
  onPuzzleImportProgress,
  puzzleHistory,
  puzzleStats,
  recordAttempt,
  themeLabel,
  type AttemptRow,
  type PuzzleOut,
  type PuzzleStats,
} from "../lib/puzzles";
import { getSettings } from "../lib/settings";
import Board from "../components/Board";
import { BOARD_WIDTH } from "../lib/boardLayout";
import { moveTargetStyles } from "../lib/boardMoves";
import { Button, Card, Chip, Spark } from "../components/ui";
import { dateLocale, deInt } from "../lib/util";
import { isStoreCapture } from "../lib/storeCapture";

export interface PuzzleEntry {
  initialTheme?: string;
  /** Schwierigkeitsband aus dem Trainingsplan; 0 = keine Vorgabe. */
  initialMinRating?: number;
  initialMaxRating?: number;
}

export default function Puzzles({
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry) {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return <PuzzleLoading />;
  return backend.mode === "desktop" ? (
    <LivePuzzles
      initialTheme={initialTheme}
      initialMinRating={initialMinRating}
      initialMaxRating={initialMaxRating}
    />
  ) : (
    <DemoPuzzles />
  );
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

const FILTER_THEMES = ["mateIn1", "mateIn2", "fork", "pin", "skewer", "backRankMate", "discoveredAttack", "endgame"];

function LivePuzzles({
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry) {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  // Das Tagesziel steht in den Einstellungen, nicht in den Puzzle-Statistiken ·
  // dasselbe Ziel, das Dashboard und Lernplan anzeigen.
  const [goal, setGoal] = useState(0);
  const reloadStats = () => puzzleStats().then(setStats).catch(() => {});

  useEffect(() => {
    reloadStats();
    getSettings().then((s) => setGoal(s.puzzle_goal)).catch(() => {});
  }, []);

  if (!stats) return <PuzzleLoading />;
  if (stats.db_total === 0) return <ImportView stats={stats} onImported={reloadStats} />;
  return (
    <TrainerView
      stats={stats}
      goal={goal}
      reloadStats={reloadStats}
      initialTheme={initialTheme}
      initialMinRating={initialMinRating}
      initialMaxRating={initialMaxRating}
    />
  );
}

/**
 * Tagesfortschritt als Chip in der Kopfzeile: Versuche gegen das Tagesziel · so
 * wie im Dashboard und im Lernplan · dazu die Zahl der heute gelösten Aufgaben,
 * weil das die Zahl ist, die den Trainingstag beschreibt.
 */
function DailyGoal({
  attempts,
  solved,
  goal,
}: {
  attempts: number;
  solved: number;
  goal: number;
}) {
  const t = useT();
  const reached = goal > 0 && attempts >= goal;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
      <Target size={15} className={reached ? "text-accent" : "text-gold"} />
      <span className="text-ink3">{t("pz.todayGoal")}</span>
      <span className="font-medium tabular-nums">
        {deInt(attempts)}
        {goal > 0 && <span className="font-normal text-ink3"> / {deInt(goal)}</span>}
      </span>
      {goal > 0 && (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel3">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, (attempts / goal) * 100)}%`,
              background: reached ? "var(--color-accent)" : "var(--color-gold)",
            }}
          />
        </span>
      )}
      <span className="text-ink3">· {t("pz.todaySolved", { n: deInt(solved) })}</span>
    </div>
  );
}

function PuzzleLoading() {
  const t = useT();
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("pz.preparing")}</p>
      </header>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-5 text-[13px] text-ink2">
        <Loader2 size={17} className="animate-spin text-accent" />
        {t("pz.loadingLibrary")}
      </div>
    </div>
  );
}

// ── Import-Ansicht ───────────────────────────────────────────────────────────

function ImportView({ stats, onImported }: { stats: PuzzleStats; onImported: () => void }) {
  const t = useT();
  const [running, setRunning] = useState(stats.importing);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    let disposed = false;
    onPuzzleImportProgress((p) => setProgress(p.imported)).then((u) =>
      disposed ? u() : cleanups.push(u)
    );
    onPuzzleImportDone((p) => {
      setRunning(false);
      if (p.error) setError(p.error);
      else onImported();
    }).then((u) => (disposed ? u() : cleanups.push(u)));
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [onImported]);

  const start = (p?: string) => {
    setError(null);
    setProgress(0);
    setRunning(true);
    importPuzzles(p).catch((e) => {
      setRunning(false);
      setError(String(e));
    });
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("pz.setupTitle")}</p>
      </header>

      <Card title={t("pz.importCard")}>
        {running ? (
          <div className="flex items-center gap-3 py-4">
            <Loader2 size={18} className="animate-spin text-accent" />
            <div>
              <div className="text-[14px] font-medium">
                {progress > 0 ? t("pz.importedN", { n: deInt(progress) }) : t("pz.downloading")}
              </div>
              <div className="mt-0.5 text-[12px] text-ink3">{t("pz.background")}</div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ink2">{t("pz.importIntro")}</p>
            <div className="mt-4 flex gap-2">
              <Button primary onClick={() => start()}>
                <Download size={15} /> {t("pz.downloadImport")}
              </Button>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 text-[12px] text-ink3">{t("pz.fromFile")}</div>
              <div className="flex gap-2">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="C:\Downloads\lichess_db_puzzle.csv.zst"
                  className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                />
                <Button onClick={() => path.trim() && start(path.trim())}>{t("common.import")}</Button>
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12px] text-loss">
            {error}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Trainer ──────────────────────────────────────────────────────────────────

type Status = "loading" | "playing" | "solved" | "empty";

function TrainerView({
  stats,
  goal,
  reloadStats,
  initialTheme = "",
  initialMinRating = 0,
  initialMaxRating = 0,
}: PuzzleEntry & {
  stats: PuzzleStats;
  /** Tagesziel aus den Einstellungen; 0 = noch nicht geladen. */
  goal: number;
  reloadStats: () => void;
}) {
  const { locale, t } = useI18n();
  const [puzzle, setPuzzle] = useState<PuzzleOut | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [fen, setFen] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shake, setShake] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  // Vorbelegt aus dem Trainingsplan ("schwächstes Motiv, Band 1420–1580").
  const [theme, setTheme] = useState<string>(initialTheme);
  const [source, setSource] = useState<"all" | "lichess" | "own">("all");
  // Ein aus dem Plan mitgebrachtes Band bleibt aktiv, bis der Nutzer es
  // aufhebt · sonst wäre die Dosis nach der ersten Aufgabe wieder vergessen.
  const [band, setBand] = useState<{ min: number; max: number } | null>(
    initialMinRating > 0 && initialMaxRating > initialMinRating
      ? { min: initialMinRating, max: initialMaxRating }
      : null
  );

  const chessRef = useRef(new Chess());
  const idxRef = useRef(0);
  const failedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playUci = (uci: string) => {
    chessRef.current.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    setFen(chessRef.current.fen());
  };

  const load = (
    t: string = theme,
    s: "all" | "lichess" | "own" = source,
    b: { min: number; max: number } | null = band
  ) => {
    setStatus("loading");
    setWrong(false);
    setShowHint(false);
    setSelected(null);
    setRatingDelta(null);
    failedRef.current = false;
    nextPuzzle({
      theme: t || undefined,
      source: s === "all" ? undefined : s,
      minRating: b?.min,
      maxRating: b?.max,
    })
      .then((p) => {
        if (!p) {
          setStatus("empty");
          return;
        }
        setPuzzle(p);
        chessRef.current = new Chess(p.fen);
        setFen(p.fen);
        idxRef.current = 0;
        if (p.setup_plies === 0) {
          setStatus("playing");
        } else {
          // Lichess-Aufgaben spielen zunächst den gegnerischen Setup-Zug.
          timerRef.current = setTimeout(() => {
            playUci(p.moves[0]);
            idxRef.current = 1;
            setStatus("playing");
          }, 550);
        }
      })
      .catch(() => setStatus("empty"));
  };

  useEffect(() => {
    load();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orientation: "white" | "black" = useMemo(() => {
    if (!puzzle) return "white";
    const initialWhite = puzzle.fen.split(" ")[1] === "w";
    const solverWhite = puzzle.setup_plies % 2 === 0 ? initialWhite : !initialWhite;
    return solverWhite ? "white" : "black";
  }, [puzzle]);

  const finish = (solvedFirstTry: boolean) => {
    if (!puzzle) return;
    recordAttempt(puzzle.id, solvedFirstTry)
      .then((r) => {
        setRatingDelta(r.delta);
        reloadStats();
      })
      .catch(() => {});
  };

  const tryMove = (from: string, to: string): boolean => {
    if (!puzzle || status !== "playing") return false;
    const chess = chessRef.current;
    let move;
    try {
      move = chess.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    const uci = move.from + move.to + (move.promotion ?? "");
    const expected = puzzle.moves[idxRef.current];
    // Lichess-Regel: jeder Zug, der sofort mattsetzt, zählt ebenfalls.
    const ok = uci === expected || chess.isCheckmate();
    if (!ok) {
      chess.undo();
      setWrong(true);
      setShake(true);
      setTimeout(() => setShake(false), 600);
      if (!failedRef.current) {
        failedRef.current = true;
        finish(false);
      }
      return false;
    }
    setFen(chess.fen());
    setWrong(false);
    idxRef.current += 1;
    if (idxRef.current >= puzzle.moves.length || chess.isCheckmate()) {
      setStatus("solved");
      if (!failedRef.current) finish(true);
      return true;
    }
    // Gegner antwortet automatisch.
    timerRef.current = setTimeout(() => {
      playUci(puzzle.moves[idxRef.current]);
      idxRef.current += 1;
    }, 350);
    return true;
  };

  const onSquareClick = (square: string) => {
    if (status !== "playing") return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      setSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  const revealSolution = () => {
    if (!puzzle) return;
    const step = () => {
      if (idxRef.current >= puzzle.moves.length) {
        setStatus("solved");
        return;
      }
      playUci(puzzle.moves[idxRef.current]);
      idxRef.current += 1;
      timerRef.current = setTimeout(step, 450);
    };
    step();
  };

  const hintSquare = puzzle && status === "playing" ? puzzle.moves[idxRef.current]?.slice(0, 2) : null;
  const squareStyles: Record<string, React.CSSProperties> = {
    ...(status === "playing" ? moveTargetStyles(fen, selected) : {}),
  };
  if (selected) squareStyles[selected] = { boxShadow: "inset 0 0 0 3px #22c08a" };
  if (showHint && hintSquare) squareStyles[hintSquare] = { boxShadow: "inset 0 0 0 3px #d9a028" };

  const mainTheme = puzzle?.themes.find(
    (value) => !["ownGame", "oneMove", "opening", "middlegame", "blunder", "mistake"].includes(value)
  ) ?? "";
  const history = stats.history.length >= 2 ? stats.history : [stats.personal_rating, stats.personal_rating];
  const themeStats = stats.themes
    .filter((t) => !["short", "long", "veryLong", "oneMove", "advantage", "crushing", "equality", "mate", "middlegame", "opening", "ownGame", "blunder", "mistake"].includes(t.theme))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {t("pz.subtitle", {
              n: deInt(stats.db_total),
              o: deInt(stats.own_total),
              m: deInt(stats.solved),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DailyGoal attempts={stats.today_attempts} solved={stats.today_solved} goal={goal} />
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Flame size={15} className="text-gold" />
            <span className="font-medium">
              {stats.streak_days} {t(stats.streak_days === 1 ? "common.days.one" : "common.days.many")}
            </span>
            <span className="text-ink3">{t("pz.streakToday", { n: stats.today_solved })}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[528px_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">
                {puzzle?.source === "own" ? t("pz.missedMove") : mainTheme ? themeLabel(mainTheme, locale) : "…"}
              </span>
              {puzzle && <span className="text-ink3">· Rating {puzzle.rating}</span>}
              {puzzle?.source === "own" && (
                <span className="rounded-md border border-accent-dim bg-accent-soft px-1.5 py-0.5 text-[10.5px] text-accent">
                  {t("pz.fromOwnGame")}
                </span>
              )}
            </div>
            <span className="text-[12.5px] text-ink3">
              {status === "loading"
                ? t("pz.loading")
                : orientation === "white"
                  ? t("pz.whiteToMove")
                  : t("pz.blackToMove")}
            </span>
          </div>

          <Board
            boardId="puzzle"
            fen={fen || "8/8/8/8/8/8/8/8 w - - 0 1"}
            width={BOARD_WIDTH}
            draggable={status === "playing"}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            squareStyles={squareStyles}
            orientation={orientation}
            shake={shake}
            mouseDrag
          />

          <div className="mt-3 flex min-h-[52px] items-center">
            {status === "solved" ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                  <CheckCircle2 size={17} />
                  {failedRef.current ? t("pz.solvedWithHelp") : t("pz.correct")}
                  {ratingDelta != null &&
                    t("pz.ratingDelta", { d: `${ratingDelta >= 0 ? "+" : ""}${ratingDelta}` })}
                </div>
                <Button primary onClick={() => load()}>
                  <SkipForward size={15} /> {t("common.next")}
                </Button>
              </div>
            ) : wrong ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
                <span className="text-[13.5px] text-loss">
                  {t("pz.wrong", { d: ratingDelta != null ? ` (Rating ${ratingDelta})` : "" })}
                </span>
                <div className="flex gap-2">
                  <Button onClick={() => setShowHint(true)}>
                    <Lightbulb size={15} /> {t("pz.hint")}
                  </Button>
                  <Button onClick={revealSolution}>
                    <Eye size={15} /> {t("pz.solution")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex w-full items-center justify-between">
                <span className="text-[13px] text-ink3">
                  {status === "loading"
                    ? t("pz.loadingNext")
                    : status === "empty"
                      ? t("pz.noneFound")
                      : t("pz.findBest")}
                </span>
                {status === "playing" && (
                  <Button onClick={() => setShowHint(true)}>
                    <Lightbulb size={15} /> {t("pz.hint")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {showHint && status === "playing" && (
            <div className="rounded-lg border border-line bg-panel px-4 py-2.5 text-[12.5px] text-ink2">
              {t("pz.hintText", {
                theme: mainTheme ? t("pz.hintTheme", { m: themeLabel(mainTheme, locale) }) : "",
              })}
            </div>
          )}
        </div>

        <div className="flex max-w-[528px] flex-col gap-4">
          <Card title={t("pz.rating")}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">
                  {deInt(stats.personal_rating)}
                </div>
                <div className="mt-1.5 text-[12px] text-ink3">
                  {stats.attempts > 0
                    ? t("pz.attempts", {
                        n: deInt(stats.attempts),
                        p: Math.round((stats.solved / stats.attempts) * 100),
                      })
                    : t("pz.eloStart")}
                </div>
              </div>
              <Spark data={history.map(Number)} width={140} height={44} />
            </div>
          </Card>

          <Card title={t("pz.themeAccuracy")}>
            {themeStats.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {themeStats.map((th) => {
                  const acc = Math.round((th.solved / th.attempts) * 100);
                  return (
                    <div key={th.theme} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[12.5px] text-ink2">{themeLabel(th.theme, locale)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${acc}%`,
                            background: acc >= 85 ? "var(--color-win)" : acc >= 70 ? "var(--color-gold)" : "var(--color-loss)",
                          }}
                        />
                      </div>
                      <span className="w-10 text-right text-[12.5px] tabular-nums text-ink2">{acc} %</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[12.5px] text-ink3">{t("pz.noAttempts")}</div>
            )}
          </Card>

          <Card title={t("pz.filter")}>
            <div className="mb-3 flex flex-wrap gap-2 border-b border-line pb-3">
              {(["all", "own", "lichess"] as const).map((value) => (
                <Chip
                  key={value}
                  active={source === value}
                  onClick={() => {
                    setSource(value);
                    load(theme, value);
                  }}
                >
                  {t(value === "all" ? "pz.sourceAll" : value === "own" ? "pz.sourceOwn" : "pz.sourceLichess")}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={theme === ""} onClick={() => { setTheme(""); load(""); }}>
                {t("pz.allThemes")}
              </Chip>
              {FILTER_THEMES.map((ft) => (
                <Chip key={ft} active={theme === ft} onClick={() => { setTheme(ft); load(ft); }}>
                  {themeLabel(ft, locale)}
                </Chip>
              ))}
            </div>
            {band && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2">
                <span className="text-[12px] text-accent">
                  {t("pz.bandActive", { lo: deInt(band.min), hi: deInt(band.max) })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBand(null);
                    // `band` steht erst im nächsten Render neu · deshalb geht
                    // das aufgehobene Band ausdrücklich mit in den Aufruf.
                    load(theme, source, null);
                  }}
                  className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink3 transition-colors hover:text-ink"
                >
                  {t("pz.bandClear")}
                </button>
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
              {t("pz.bandInfo")}
            </div>
          </Card>

          <PuzzleHistory />
        </div>
      </div>
    </div>
  );
}

/** Verlauf der letzten Versuche · standardmäßig zugeklappt. */
function PuzzleHistory() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AttemptRow[] | null>(null);

  useEffect(() => {
    if (!open || rows) return;
    puzzleHistory(25)
      .then(setRows)
      .catch(() => setRows([]));
  }, [open, rows]);

  return (
    <Card
      title={t("pz.history")}
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink3 hover:bg-panel2 hover:text-ink"
        >
          {t(open ? "pz.historyHide" : "pz.historyShow")}
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {!open ? (
        <p className="text-[12px] leading-relaxed text-ink3">{t("pz.historyHint")}</p>
      ) : rows == null ? (
        <div className="text-[12px] text-ink3">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-ink3">{t("pz.noAttempts")}</div>
      ) : (
        <ul className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto pr-1">
          {rows.map((row) => {
            const delta = row.rating_after - row.rating_before;
            return (
              <li
                key={`${row.puzzle_id}-${row.ts}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-2.5 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {row.solved ? (
                    <Check size={13} className="shrink-0 text-win" />
                  ) : (
                    <X size={13} className="shrink-0 text-loss" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-ink2">
                      {row.themes.slice(0, 2).map((theme) => themeLabel(theme, locale)).join(" · ") ||
                        row.puzzle_id}
                    </div>
                    <div className="text-[10.5px] text-ink3">
                      {new Date(row.ts * 1000).toLocaleString(dateLocale(), {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {row.puzzle_rating > 0 ? ` · ${deInt(row.puzzle_rating)}` : ""}
                    </div>
                  </div>
                </div>
                <span
                  className="shrink-0 text-[12px] font-medium tabular-nums"
                  style={{ color: delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                >
                  {delta >= 0 ? "+" : "−"}
                  {Math.abs(delta)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function DemoPuzzles() {
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"open" | "solved" | "wrong">("open");
  const [shake, setShake] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const puzzle = demoPuzzles[idx % demoPuzzles.length];
  const captureTheme =
    storeCapture && locale === "en" && puzzle.theme === "Grundreihenmatt"
      ? "Back rank mate"
      : puzzle.theme;

  const chessRef = useRef(new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);

  const next = () => {
    const n = (idx + 1) % demoPuzzles.length;
    setIdx(n);
    const p = demoPuzzles[n];
    chessRef.current = new Chess(p.fen);
    setFen(p.fen);
    setStatus("open");
    setSelected(null);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (status === "solved") return false;
    const chess = chessRef.current;
    try {
      const move = chess.move({ from, to, promotion: "q" });
      if (move.san === puzzle.solutionSan) {
        setFen(chess.fen());
        setStatus("solved");
        return true;
      }
      chess.undo();
      setStatus("wrong");
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return false;
    } catch {
      return false;
    }
  };

  const onSquareClick = (square: string) => {
    if (status === "solved") return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      setSelected(moved || !piece || piece.color !== chess.turn() ? null : square);
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {storeCapture
              ? locale === "de"
                ? "Gezieltes Taktiktraining aus Millionen kuratierter Stellungen"
                : "Focused tactics training from millions of curated positions"
              : t("pz.demoSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DailyGoal
            attempts={demoStats.todaySolved}
            solved={demoStats.todaySolved}
            goal={demoStats.todayGoal}
          />
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Flame size={15} className="text-gold" />
            <span className="font-medium">{demoStats.streak} {t("common.days.many")}</span>
            <span className="text-ink3">{t("pz.streakToday", { n: demoStats.todaySolved })}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1180px]:grid-cols-[528px_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">{captureTheme}</span>
              <span className="text-ink3">· Rating {puzzle.rating}</span>
            </div>
            <span className="text-[12.5px] text-ink3">
              {puzzle.sideToMove === "white" ? t("pz.whiteToMove") : t("pz.blackToMove")}
            </span>
          </div>

          <Board
            boardId="puzzle"
            fen={fen}
            width={BOARD_WIDTH}
            draggable={status !== "solved"}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            squareStyles={{
              ...moveTargetStyles(fen, selected),
              ...(selected ? { [selected]: { boxShadow: "inset 0 0 0 3px #22c08a" } } : {}),
            }}
            orientation={puzzle.sideToMove}
            shake={shake}
            mouseDrag
          />

          <div className="mt-3 flex h-[52px] items-center">
            {status === "solved" ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                  <CheckCircle2 size={17} />
                  {t("pz.correct")} {puzzle.solutionSan} · {captureTheme}
                </div>
                <Button primary onClick={next}>
                  <SkipForward size={15} /> {t("common.next")}
                </Button>
              </div>
            ) : status === "wrong" ? (
              <div className="flex w-full items-center rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
                <span className="text-[13.5px] text-loss">{t("pz.wrong", { d: "" })}</span>
              </div>
            ) : (
              <span className="text-[13px] text-ink3">{t("pz.findBestDemo")}</span>
            )}
          </div>
        </div>

        <div className="flex max-w-[528px] flex-col gap-4">
          <Card title={t("pz.rating")}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">{deInt(demoStats.rating)}</div>
                <div className="mt-1.5 text-[12px] text-win">{t("pz.rating3m")}</div>
              </div>
              <Spark data={demoStats.history} width={140} height={44} />
            </div>
          </Card>
          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            {t("pz.demoNote")}
          </div>
        </div>
      </div>
    </div>
  );
}
