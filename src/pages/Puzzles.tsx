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

export default function Puzzles() {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return null;
  return backend.mode === "desktop" ? <LivePuzzles /> : <DemoPuzzles />;
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

const FILTER_THEMES = ["mateIn1", "mateIn2", "fork", "pin", "skewer", "backRankMate", "discoveredAttack", "endgame"];

function LivePuzzles() {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const reloadStats = () => puzzleStats().then(setStats).catch(() => {});

  useEffect(() => {
    reloadStats();
  }, []);

  if (!stats) return null;
  if (stats.db_total === 0) return <ImportView stats={stats} onImported={reloadStats} />;
  return <TrainerView stats={stats} reloadStats={reloadStats} />;
}

// ── Import-Ansicht ───────────────────────────────────────────────────────────

function ImportView({ stats, onImported }: { stats: PuzzleStats; onImported: () => void }) {
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
        <h1 className="text-[21px] font-semibold tracking-tight">Puzzle-Training</h1>
        <p className="mt-0.5 text-[13px] text-ink3">
          Einmalige Einrichtung: die Lichess-Puzzle-Datenbank (CC0, ~5 Mio. Aufgaben) lokal importieren.
        </p>
      </header>

      <Card title="Puzzle-Datenbank importieren">
        {running ? (
          <div className="flex items-center gap-3 py-4">
            <Loader2 size={18} className="animate-spin text-accent" />
            <div>
              <div className="text-[14px] font-medium">
                {progress > 0 ? `${deInt(progress)} Puzzles importiert …` : "Download läuft …"}
              </div>
              <div className="mt-0.5 text-[12px] text-ink3">
                Läuft im Hintergrund — du kannst währenddessen andere Bereiche nutzen.
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ink2">
              Kiebitz lädt den offiziellen Dump von database.lichess.org (~250 MB komprimiert) und
              speichert ihn in der lokalen SQLite-Datenbank. Danach läuft das Training komplett offline.
            </p>
            <div className="mt-4 flex gap-2">
              <Button primary onClick={() => start()}>
                <Download size={15} /> Herunterladen & importieren
              </Button>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 text-[12px] text-ink3">
                Alternativ aus lokaler Datei (lichess_db_puzzle.csv oder .csv.zst):
              </div>
              <div className="flex gap-2">
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="C:\Downloads\lichess_db_puzzle.csv.zst"
                  className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                />
                <Button onClick={() => path.trim() && start(path.trim())}>Importieren</Button>
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

function TrainerView({ stats, reloadStats }: { stats: PuzzleStats; reloadStats: () => void }) {
  const [puzzle, setPuzzle] = useState<PuzzleOut | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [fen, setFen] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shake, setShake] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  const [theme, setTheme] = useState<string>("");

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
          <h1 className="text-[21px] font-semibold tracking-tight">Puzzle-Training</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            Lichess-Puzzle-Datenbank · {deInt(stats.db_total)} Aufgaben offline · {deInt(stats.solved)} gelöst
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
          <Flame size={15} className="text-gold" />
          <span className="font-medium">{stats.streak_days} {stats.streak_days === 1 ? "Tag" : "Tage"}</span>
          <span className="text-ink3">Serie · heute {stats.today_solved}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[auto_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13.5px]">
              <Target size={15} className="text-accent" />
              <span className="font-medium">{mainTheme ? themeLabel(mainTheme) : "…"}</span>
              {puzzle && <span className="text-ink3">· Rating {puzzle.rating}</span>}
            </div>
            <span className="text-[12.5px] text-ink3">
              {status === "loading" ? "lade …" : orientation === "white" ? "Weiß am Zug" : "Schwarz am Zug"}
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
                  {failedRef.current ? "Gelöst (mit Hilfe)." : "Richtig!"}
                  {ratingDelta != null && ` Rating ${ratingDelta >= 0 ? "+" : ""}${ratingDelta}`}
                </div>
                <Button primary onClick={() => load()}>
                  <SkipForward size={15} /> Weiter
                </Button>
              </div>
            ) : wrong ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
                <span className="text-[13.5px] text-loss">
                  Leider falsch{ratingDelta != null ? ` (Rating ${ratingDelta})` : ""} — versuch es noch einmal.
                </span>
                <div className="flex gap-2">
                  <Button onClick={() => setShowHint(true)}>
                    <Lightbulb size={15} /> Tipp
                  </Button>
                  <Button onClick={revealSolution}>
                    <Eye size={15} /> Lösung
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex w-full items-center justify-between">
                <span className="text-[13px] text-ink3">
                  {status === "loading"
                    ? "Nächstes Puzzle wird geladen …"
                    : status === "empty"
                      ? "Kein Puzzle mit diesem Filter gefunden."
                      : "Finde die beste Fortsetzung — ggf. mehrere Züge."}
                </span>
                {status === "playing" && (
                  <Button onClick={() => setShowHint(true)}>
                    <Lightbulb size={15} /> Tipp
                  </Button>
                )}
              </div>
            )}
          </div>
          {showHint && status === "playing" && (
            <div className="rounded-lg border border-line bg-panel px-4 py-2.5 text-[12.5px] text-ink2">
              Die markierte Figur zieht{mainTheme ? ` — Motiv: ${themeLabel(mainTheme)}` : ""}.
            </div>
          )}
        </div>

        <div className="flex max-w-[420px] flex-col gap-4">
          <Card title="Puzzle-Rating">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">
                  {deInt(stats.personal_rating)}
                </div>
                <div className="mt-1.5 text-[12px] text-ink3">
                  {stats.attempts > 0
                    ? `${deInt(stats.attempts)} Versuche · ${Math.round((stats.solved / stats.attempts) * 100)} % gelöst`
                    : "Elo-basiert · startet bei 1500"}
                </div>
              </div>
              <Spark data={history.map(Number)} width={140} height={44} />
            </div>
          </Card>

          <Card title="Trefferquote nach Motiv">
            {themeStats.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {themeStats.map((t) => {
                  const acc = Math.round((t.solved / t.attempts) * 100);
                  return (
                    <div key={t.theme} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-[12.5px] text-ink2">{themeLabel(t.theme)}</span>
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
              <div className="text-[12.5px] text-ink3">
                Noch keine Versuche — die Statistik füllt sich mit jedem gelösten Puzzle.
              </div>
            )}
          </Card>

          <Card title="Filter">
            <div className="flex flex-wrap gap-2">
              <Chip active={theme === ""} onClick={() => { setTheme(""); load(""); }}>
                Alle Motive
              </Chip>
              {FILTER_THEMES.map((t) => (
                <Chip key={t} active={theme === t} onClick={() => { setTheme(t); load(t); }}>
                  {themeLabel(t)}
                </Chip>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
              Aufgaben kommen aus dem Band ±75 um dein Rating; bereits gelöste werden übersprungen.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function DemoPuzzles() {
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
          <h1 className="text-[21px] font-semibold tracking-tight">Puzzle-Training</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            Demo-Puzzles — die Lichess-Datenbank (~5 Mio. Aufgaben) importiert die Desktop-App
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
          <Flame size={15} className="text-gold" />
          <span className="font-medium">{demoStats.streak} Tage</span>
          <span className="text-ink3">Serie</span>
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
              {puzzle.sideToMove === "white" ? "Weiß" : "Schwarz"} am Zug
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
                  Richtig! {puzzle.solutionSan} — {puzzle.theme}
                </div>
                <Button primary onClick={next}>
                  <SkipForward size={15} /> Weiter
                </Button>
              </div>
            ) : status === "wrong" ? (
              <div className="flex w-full items-center rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
                <span className="text-[13.5px] text-loss">Leider falsch — versuch es noch einmal.</span>
              </div>
            ) : (
              <span className="text-[13px] text-ink3">Finde den besten Zug — Figur einfach ziehen.</span>
            )}
          </div>
        </div>

        <div className="flex max-w-[420px] flex-col gap-4">
          <Card title="Puzzle-Rating">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">{deInt(demoStats.rating)}</div>
                <div className="mt-1.5 text-[12px] text-win">+120 in 3 Monaten</div>
              </div>
              <Spark data={demoStats.history} width={140} height={44} />
            </div>
          </Card>
          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            Demo-Ansicht: Puzzle-Import, Motiv-Filter und persönliches Rating laufen in der Desktop-App.
          </div>
        </div>
      </div>
    </div>
  );
}
