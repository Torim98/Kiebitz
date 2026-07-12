import { useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { CheckCircle2, Flame, Lightbulb, SkipForward, Target } from "lucide-react";
import { puzzles, puzzleStats } from "../data/demo";
import Board from "../components/Board";
import { Button, Card, Chip, Spark } from "../components/ui";
import { deInt } from "../lib/util";

type Status = "open" | "solved" | "wrong";

export default function Puzzles() {
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<Status>("open");
  const [shake, setShake] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const puzzle = puzzles[idx % puzzles.length];

  const chessRef = useRef(new Chess(puzzle.fen));
  const [fen, setFen] = useState(puzzle.fen);

  const next = () => {
    const n = (idx + 1) % puzzles.length;
    setIdx(n);
    const p = puzzles[n];
    chessRef.current = new Chess(p.fen);
    setFen(p.fen);
    setStatus("open");
    setShowHint(false);
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

  const hint = useMemo(
    () => `Achte auf Motive vom Typ „${puzzle.theme}“ — der Lösungszug ist ein ${puzzle.solutionSan.includes("#") ? "Mattzug" : "Gewinnzug"}.`,
    [puzzle]
  );

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Puzzle-Training</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            Lichess-Puzzle-Datenbank · offline · {deInt(puzzleStats.solvedTotal)} gelöst
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
          <Flame size={15} className="text-gold" />
          <span className="font-medium">{puzzleStats.streak} Tage</span>
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
                  Richtig! {puzzle.solutionSan} — {puzzle.theme}. Rating +8
                </div>
                <Button primary onClick={next}>
                  <SkipForward size={15} /> Weiter
                </Button>
              </div>
            ) : status === "wrong" ? (
              <div className="flex w-full items-center justify-between rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
                <span className="text-[13.5px] text-loss">Leider falsch — versuch es noch einmal.</span>
                <Button onClick={() => setShowHint(true)}>
                  <Lightbulb size={15} /> Tipp
                </Button>
              </div>
            ) : (
              <div className="flex w-full items-center justify-between">
                <span className="text-[13px] text-ink3">Finde den besten Zug — Figur einfach ziehen.</span>
                <Button onClick={() => setShowHint(true)}>
                  <Lightbulb size={15} /> Tipp
                </Button>
              </div>
            )}
          </div>
          {showHint && status !== "solved" && (
            <div className="rounded-lg border border-line bg-panel px-4 py-2.5 text-[12.5px] text-ink2">{hint}</div>
          )}
        </div>

        <div className="flex max-w-[420px] flex-col gap-4">
          <Card title="Puzzle-Rating">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight">{deInt(puzzleStats.rating)}</div>
                <div className="mt-1.5 text-[12px] text-win">+120 in 3 Monaten</div>
              </div>
              <Spark data={puzzleStats.history} width={140} height={44} />
            </div>
          </Card>

          <Card title="Trefferquote nach Motiv">
            <div className="flex flex-col gap-2.5">
              {puzzleStats.themes.map((t) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-[12.5px] text-ink2">{t.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel3">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${t.acc}%`,
                        background: t.acc >= 85 ? "var(--color-win)" : t.acc >= 70 ? "var(--color-gold)" : "var(--color-loss)",
                      }}
                    />
                  </div>
                  <span className="w-10 text-right text-[12.5px] tabular-nums text-ink2">{t.acc} %</span>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
              Empfehlung: Trainiere <span className="text-ink2">Zugzwang</span> und{" "}
              <span className="text-ink2">Abzug</span> — deine schwächsten Motive.
            </div>
          </Card>

          <Card title="Filter">
            <div className="flex flex-wrap gap-2">
              <Chip active>Alle Motive</Chip>
              <Chip>Matt in 1</Chip>
              <Chip>Gabel</Chip>
              <Chip>Grundreihe</Chip>
              <Chip>Endspiel</Chip>
              <Chip>1400–1800</Chip>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
