import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  CheckCircle2,
  Download,
  Eye,
  Flame,
  Lightbulb,
  Loader2,
  SkipForward,
  Target,
} from "lucide-react";
import { puzzles as demoPuzzles, puzzleStats as demoStats } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, useT } from "../lib/i18n";
import {
  importPuzzles,
  nextPuzzle,
  onPuzzleImportDone,
  onPuzzleImportProgress,
  puzzleStats,
  recordAttempt,
  themeLabel,
  type PuzzleOut,
  type PuzzleStats,
} from "../lib/puzzles";
import Board from "../components/Board";
import { Button, Card, Chip, Spark } from "../components/ui";
import { deInt } from "../lib/util";

export default function Puzzles({ initialTheme = "" }: { initialTheme?: string }) {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return null;
  return backend.mode === "desktop" ? <LivePuzzles initialTheme={initialTheme} /> : <DemoPuzzles />;
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

const FILTER_THEMES = ["mateIn1", "mateIn2", "fork", "pin", "skewer", "backRankMate", "discoveredAttack", "endgame"];

function LivePuzzles({ initialTheme = "" }: { initialTheme?: string }) {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const reloadStats = () => puzzleStats().then(setStats).catch(() => {});

  useEffect(() => {
    reloadStats();
  }, []);

  if (!stats) return null;
  if (stats.db_total === 0) return <ImportView stats={stats} onImported={reloadStats} />;
  return <TrainerView stats={stats} reloadStats={reloadStats} initialTheme={initialTheme} />;
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
    <div className="mx-auto max-w-[720px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
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
  reloadStats,
  initialTheme = "",
}: {
  stats: PuzzleStats;
  reloadStats: () => void;
  initialTheme?: string;
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
  // Vorbelegt z. B. vom Coach ("schwächstes Motiv trainieren").
  const [theme, setTheme] = useState<string>(initialTheme);

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

  const load = (t: string = theme) => {
    setStatus("loading");
    setWrong(false);
    setShowHint(false);
    setSelected(null);
    setRatingDelta(null);
    failedRef.current = false;
    nextPuzzle({ theme: t || undefined })
      .then((p) => {
        if (!p) {
          setStatus("empty");
          return;
        }
        setPuzzle(p);
        chessRef.current = new Chess(p.fen);
        setFen(p.fen);
        idxRef.current = 0;
        // Der erste Zug ist der Gegnerzug, der die Aufgabe stellt.
        timerRef.current = setTimeout(() => {
          playUci(p.moves[0]);
          idxRef.current = 1;
          setStatus("playing");
        }, 550);
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
    // Am Zug ist der Löser — nach dem automatischen Gegnerzug.
    return puzzle.fen.split(" ")[1] === "w" ? "black" : "white";
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
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (selected) squareStyles[selected] = { boxShadow: "inset 0 0 0 3px #22c08a" };
  if (showHint && hintSquare) squareStyles[hintSquare] = { boxShadow: "inset 0 0 0 3px #d9a028" };

  const mainTheme = puzzle?.themes.find((t) => FILTER_THEMES.includes(t)) ?? puzzle?.themes[0] ?? "";
  const history = stats.history.length >= 2 ? stats.history : [stats.personal_rating, stats.personal_rating];
  const themeStats = stats.themes
    .filter((t) => !["short", "long", "veryLong", "oneMove", "advantage", "crushing", "equality", "mate", "middlegame", "opening"].includes(t.theme))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {t("pz.subtitle", { n: deInt(stats.db_total), m: deInt(stats.solved) })}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
          <Flame size={15} className="text-gold" />
          <span className="font-medium">
            {stats.streak_days} {t(stats.streak_days === 1 ? "common.days.one" : "common.days.many")}
          </span>
          <span className="text-ink3">{t("pz.streakToday", { n: stats.today_solved })}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[auto_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">{mainTheme ? themeLabel(mainTheme, locale) : "…"}</span>
              {puzzle && <span className="text-ink3">· Rating {puzzle.rating}</span>}
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
            width={420}
            draggable={status === "playing"}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            squareStyles={squareStyles}
            orientation={orientation}
            shake={shake}
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

        <div className="flex max-w-[420px] flex-col gap-4">
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
            <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
              {t("pz.bandInfo")}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function DemoPuzzles() {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<"open" | "solved" | "wrong">("open");
  const [shake, setShake] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const puzzle = demoPuzzles[idx % demoPuzzles.length];

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
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("pz.demoSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
          <Flame size={15} className="text-gold" />
          <span className="font-medium">{demoStats.streak} {t("common.days.many")}</span>
          <span className="text-ink3">{t("pz.streakToday", { n: demoStats.todaySolved })}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[auto_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">{puzzle.theme}</span>
              <span className="text-ink3">· Rating {puzzle.rating}</span>
            </div>
            <span className="text-[12.5px] text-ink3">
              {puzzle.sideToMove === "white" ? t("pz.whiteToMove") : t("pz.blackToMove")}
            </span>
          </div>

          <Board
            boardId="puzzle"
            fen={fen}
            width={420}
            draggable={status !== "solved"}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            squareStyles={selected ? { [selected]: { boxShadow: "inset 0 0 0 3px #22c08a" } } : undefined}
            orientation={puzzle.sideToMove}
            shake={shake}
          />

          <div className="mt-3 flex h-[52px] items-center">
            {status === "solved" ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                  <CheckCircle2 size={17} />
                  {t("pz.correct")} {puzzle.solutionSan} — {puzzle.theme}
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

        <div className="flex max-w-[420px] flex-col gap-4">
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
