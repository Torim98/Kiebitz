import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  CheckCircle2,
  Crown,
  Lightbulb,
  Loader2,
  RotateCcw,
  SkipForward,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  CATEGORY_ORDER,
  ENDGAME_DRILLS,
  type EndgameCategory,
  type EndgameDrill,
} from "../data/endgames";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { endgameMove, endgameRecord, endgameStats, type DrillStat } from "../lib/endgame";
import Board from "../components/Board";
import { Button, Card } from "../components/ui";
import { deInt } from "../lib/util";

const CATEGORY_KEY: Record<EndgameCategory, Key> = {
  mates: "eg.catMates",
  pawn: "eg.catPawn",
  rook: "eg.catRook",
  queen: "eg.catQueen",
};

type Status = "playing" | "thinking" | "solved" | "failed";

export default function Endgame() {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";

  const [drill, setDrill] = useState<EndgameDrill>(ENDGAME_DRILLS[0]);
  const [fen, setFen] = useState(ENDGAME_DRILLS[0].fen);
  const [status, setStatus] = useState<Status>("playing");
  const [endMsg, setEndMsg] = useState<Key | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hintMove, setHintMove] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [stats, setStats] = useState<Record<string, DrillStat>>({});

  const chessRef = useRef(new Chess(ENDGAME_DRILLS[0].fen));
  // Läuft eine Engine-Anfrage noch, während der Drill gewechselt wird,
  // darf ihre Antwort das neue Brett nicht mehr anfassen.
  const runRef = useRef(0);

  const reloadStats = () => {
    if (!desktop) return;
    endgameStats()
      .then((list) => {
        const map: Record<string, DrillStat> = {};
        for (const s of list) map[s.drill_id] = s;
        setStats(map);
      })
      .catch(() => {});
  };

  useEffect(() => {
    reloadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const userColor = drill.side === "white" ? "w" : "b";

  /** Prüft auf Partieende; true, wenn der Drill vorbei ist. */
  const checkEnd = (d: EndgameDrill): boolean => {
    const c = chessRef.current;
    if (!c.isGameOver()) return false;
    let success: boolean;
    let msg: Key;
    if (c.isCheckmate()) {
      // Matt gesetzt hat, wer den letzten Zug machte.
      const winner = c.turn() === "w" ? "black" : "white";
      success = winner === d.side;
      msg = success ? "eg.successWin" : "eg.failedLost";
    } else {
      success = d.goal === "draw";
      msg = success ? "eg.successDraw" : "eg.failedWin";
      if (!success && d.goal === "draw") msg = "eg.failedDraw";
    }
    setStatus(success ? "solved" : "failed");
    setEndMsg(msg);
    if (desktop) {
      endgameRecord(d.id, success, c.history().length)
        .then(reloadStats)
        .catch(() => {});
    }
    return true;
  };

  /** Fordert den Engine-Zug für die Gegenseite an. */
  const engineTurn = (d: EndgameDrill) => {
    if (!desktop) return; // Web-Preview: der Spieler zieht beide Seiten.
    const run = runRef.current;
    setStatus("thinking");
    endgameMove(chessRef.current.fen())
      .then((uci) => {
        if (run !== runRef.current) return;
        chessRef.current.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
        setFen(chessRef.current.fen());
        if (!checkEnd(d)) setStatus("playing");
      })
      .catch((e) => {
        if (run !== runRef.current) return;
        setError(String(e));
        setStatus("playing");
      });
  };

  const start = (d: EndgameDrill) => {
    runRef.current += 1;
    setDrill(d);
    chessRef.current = new Chess(d.fen);
    setFen(d.fen);
    setStatus("playing");
    setEndMsg(null);
    setError(null);
    setSelected(null);
    setHintMove(null);
    // Ist die Gegenseite am Zug (z. B. Opposition-Drill), beginnt die Engine.
    const engineFirst = d.fen.split(" ")[1] !== (d.side === "white" ? "w" : "b");
    if (engineFirst) setTimeout(() => engineTurn(d), 400);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (status !== "playing") return false;
    const c = chessRef.current;
    if (desktop && c.turn() !== userColor) return false;
    try {
      c.move({ from, to, promotion: "q" });
    } catch {
      return false;
    }
    setFen(c.fen());
    setSelected(null);
    setHintMove(null);
    setError(null);
    if (checkEnd(drill)) return true;
    // Desktop: Engine antwortet; Web: der Spieler zieht selbst weiter.
    if (desktop && c.turn() !== userColor) engineTurn(drill);
    return true;
  };

  const onSquareClick = (square: string) => {
    if (status !== "playing") return;
    const chess = chessRef.current;
    const piece = chess.get(square as Parameters<typeof chess.get>[0]);
    if (selected && selected !== square) {
      const moved = tryMove(selected, square);
      if (!moved && piece && piece.color === chess.turn()) {
        setSelected(square);
      } else if (!moved) {
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setSelected(null);
      }
    } else if (piece && piece.color === chess.turn()) {
      setSelected(selected === square ? null : square);
    }
  };

  /** Engine-Vorschlag für den eigenen Zug (Desktop). */
  const showHint = () => {
    if (!desktop || status !== "playing" || hintLoading) return;
    const run = runRef.current;
    setHintLoading(true);
    endgameMove(chessRef.current.fen())
      .then((uci) => {
        if (run !== runRef.current) return;
        setHintMove(uci);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setHintLoading(false));
  };

  const squareStyles: Record<string, React.CSSProperties> = {};
  if (selected) squareStyles[selected] = { boxShadow: "inset 0 0 0 3px #22c08a" };
  if (hintMove) {
    squareStyles[hintMove.slice(0, 2)] = { boxShadow: "inset 0 0 0 3px #d9a028" };
    squareStyles[hintMove.slice(2, 4)] = { boxShadow: "inset 0 0 0 3px #d9a02888" };
  }

  const mastered = useMemo(
    () => ENDGAME_DRILLS.filter((d) => (stats[d.id]?.solved ?? 0) > 0).length,
    [stats]
  );

  const nextUnsolved = (): EndgameDrill | null => {
    const idx = ENDGAME_DRILLS.findIndex((d) => d.id === drill.id);
    for (let i = 1; i <= ENDGAME_DRILLS.length; i++) {
      const cand = ENDGAME_DRILLS[(idx + i) % ENDGAME_DRILLS.length];
      if ((stats[cand.id]?.solved ?? 0) === 0) return cand;
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("eg.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("eg.subtitle")}</p>
        </div>
        {desktop && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Trophy size={15} className="text-gold" />
            <span className="font-medium">
              {t("eg.progress", { n: mastered, m: ENDGAME_DRILLS.length })}
            </span>
          </div>
        )}
      </header>

      {!desktop && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("eg.webNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[auto_1fr]">
        {/* Brett + Statuszeile — auf Brettbreite begrenzt, damit lange
            Hinweistexte die auto-Grid-Spalte nicht aufblähen. */}
        <div className="max-w-[420px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13.5px]">
              <Crown size={15} className="shrink-0 text-accent" />
              <span className="font-medium">{drill.name[locale]}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] ${
                  drill.goal === "win" ? "bg-accent-soft text-accent" : "bg-panel3 text-gold"
                }`}
              >
                {drill.goal === "win" ? t("eg.goalWin") : t("eg.goalDraw")}
              </span>
            </div>
            <span className="shrink-0 text-[12.5px] text-ink3">
              {status === "thinking" ? t("eg.thinking") : status === "playing" ? t("eg.yourTurn") : ""}
            </span>
          </div>

          <Board
            boardId="endgame"
            fen={fen}
            width={420}
            draggable={status === "playing"}
            onPieceDrop={tryMove}
            onSquareClick={onSquareClick}
            squareStyles={squareStyles}
            orientation={drill.side}
            shake={shake}
          />

          <div className="mt-3 min-h-[52px]">
            {status === "solved" || status === "failed" ? (
              <div
                className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2.5 ${
                  status === "solved"
                    ? "border border-accent-dim bg-accent-soft"
                    : "border border-[#8a3535] bg-[#2a1414]"
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-[13.5px] font-medium ${
                    status === "solved" ? "text-accent" : "text-loss"
                  }`}
                >
                  {status === "solved" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
                  {endMsg ? t(endMsg) : ""}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => start(drill)}>
                    <RotateCcw size={14} /> {t("eg.retry")}
                  </Button>
                  {status === "solved" && nextUnsolved() && (
                    <Button primary onClick={() => start(nextUnsolved()!)}>
                      <SkipForward size={15} /> {t("eg.nextDrill")}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-end gap-2">
                  {desktop && status === "playing" && (
                    <Button onClick={showHint}>
                      {hintLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Lightbulb size={14} />
                      )}{" "}
                      {t("eg.hintMove")}
                    </Button>
                  )}
                  <Button onClick={() => start(drill)}>
                    <RotateCcw size={14} /> {t("eg.restart")}
                  </Button>
                </div>
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink3">
                  {drill.hint[locale]}
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="mt-2 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12.5px] text-loss">
              {error}
            </div>
          )}
        </div>

        {/* Aufgabenliste */}
        <div className="flex max-w-[460px] flex-col gap-4">
          <Card title={t("eg.drills")}>
            <div className="flex flex-col gap-4">
              {CATEGORY_ORDER.map((cat) => (
                <div key={cat}>
                  <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink3">
                    {t(CATEGORY_KEY[cat])}
                  </div>
                  <div className="flex flex-col gap-1">
                    {ENDGAME_DRILLS.filter((d) => d.category === cat).map((d) => {
                      const st = stats[d.id];
                      const done = (st?.solved ?? 0) > 0;
                      const active = d.id === drill.id;
                      return (
                        <button
                          key={d.id}
                          onClick={() => start(d)}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                            active
                              ? "border-accent-dim bg-accent-soft"
                              : "border-line bg-panel2 hover:bg-panel3"
                          }`}
                        >
                          <span className="flex items-center gap-2 text-[13px]">
                            {done ? (
                              <CheckCircle2 size={15} className="shrink-0 text-win" />
                            ) : (
                              <span className="inline-block h-[15px] w-[15px] shrink-0 rounded-full border border-line2" />
                            )}
                            <span className={active ? "font-medium text-ink" : "text-ink2"}>
                              {d.name[locale]}
                            </span>
                          </span>
                          <span className="shrink-0 pl-3 text-[11.5px] text-ink3">
                            {d.goal === "win" ? t("eg.goalWin") : t("eg.goalDraw")}
                            {st && st.attempts > 0 && (
                              <>
                                {" · "}
                                {done
                                  ? t("eg.solvedTimes", { n: deInt(st.solved) })
                                  : t("eg.attempts", { n: deInt(st.attempts) })}
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {desktop && (
              <div className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-ink3">
                {t("eg.engineNote")}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
