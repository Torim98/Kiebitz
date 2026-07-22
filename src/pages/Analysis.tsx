import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ListChecks,
  Loader2,
  Search,
  Square,
  Zap,
} from "lucide-react";
import { featuredGame } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type TFunc } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
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
import LiveEngine from "../components/LiveEngine";
import { Button, Card, ResultBadge } from "../components/ui";
import { de, evalLabel, fenAfter, nagColor, winProb } from "../lib/util";

/** Einheitliche Zug-Sicht für Demo- und DB-Partien. */
interface ViewMove {
  san: string;
  evalCp: number | null; // nach dem Zug, aus Weiß-Sicht
  mateIn: number | null;
  nag?: string;
  bestUci?: string;
  judgment?: string;
}

const NAG: Record<string, string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

function judgmentLabel(t: TFunc, judgment: string): string {
  return judgment === "inaccuracy"
    ? t("an.inaccuracy")
    : judgment === "mistake"
      ? t("an.mistake")
      : t("an.blunder");
}

/** Zahl fürs Chart / die Eval-Bar: Matt zählt wie ±10 Bauern. */
function evalNum(cp: number | null, mate: number | null): number {
  if (mate != null) return mate > 0 ? 1000 : -1000;
  return cp ?? 0;
}

function rowsToViewMoves(sans: string[], rows: MoveEvalRow[]): ViewMove[] {
  const byPly = new Map(rows.map((r) => [r.ply, r]));
  return sans.map((san, i) => {
    const r = byPly.get(i + 1);
    return {
      san,
      evalCp: r ? r.eval_cp : null,
      mateIn: r ? r.mate_in : null,
      nag: r && r.judgment ? NAG[r.judgment] : undefined,
      bestUci: r?.best_uci,
      judgment: r?.judgment || undefined,
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
      /* Zug nicht rekonstruierbar — Kommentar ohne Alternative */
    }
  }
  const from = evalLabel(prevEval);
  const to = m.mateIn != null ? `#${m.mateIn}` : evalLabel(m.evalCp ?? 0);
  const base = t("an.comment", { judgment: judgmentLabel(t, m.judgment), from, to });
  return best ? base + t("an.commentBetter", { san: best }) : base;
}

export default function Analysis({ targetGameId }: { targetGameId: number | null }) {
  const backend = useBackendInfo();
  const { t } = useI18n();
  const desktop = backend.mode === "desktop";

  const [games, setGames] = useState<GameRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rows, setRows] = useState<MoveEvalRow[] | null>(null);
  const [ply, setPly] = useState(0);
  const [liveEval, setLiveEval] = useState<{ cp: number | null; mate: number | null } | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [posSearch, setPosSearch] = useState<PositionSearch | null>(null);
  const [chessdbOn, setChessdbOn] = useState(false);
  const [book, setBook] = useState<ChessDbResult | null>(null);
  const [bookState, setBookState] = useState<"idle" | "loading" | "error">("idle");

  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;

  const reloadGames = useCallback(() => {
    return listGames().then((gs) => {
      setGames(gs.filter((g) => g.moves));
      return gs;
    });
  }, []);

  // Partien laden und Auswahl initialisieren.
  useEffect(() => {
    if (!desktop) return;
    reloadGames().then((gs) => {
      const withMoves = gs.filter((g) => g.moves);
      const pick =
        (targetGameId != null && withMoves.find((g) => g.id === targetGameId)) ||
        withMoves.find((g) => g.analyzed) ||
        withMoves[0];
      if (pick?.id != null) setSelectedId(pick.id);
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
        reloadGames();
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
  }, [desktop, reloadGames, t]);

  // ChessDB-Einstellung einmalig lesen.
  useEffect(() => {
    if (!desktop) return;
    getSettings()
      .then((s) => setChessdbOn(s.chessdb_enabled))
      .catch(() => {});
  }, [desktop]);

  const game = useMemo(
    () => games.find((g) => g.id === selectedId) ?? null,
    [games, selectedId]
  );

  // Gespeicherte Analyse der gewählten Partie laden.
  useEffect(() => {
    if (!desktop || selectedId == null) return;
    setRows(null);
    gameAnalysis(selectedId).then(setRows).catch(() => setRows([]));
  }, [desktop, selectedId]);

  // Zug-Sicht: Demo im Web, echte Partie auf dem Desktop.
  const live = desktop && game != null;
  const sans = useMemo(
    () => (live ? game.moves.split(" ").filter(Boolean) : featuredGame.moves.map((m) => m.san)),
    [live, game]
  );
  const viewMoves: ViewMove[] = useMemo(() => {
    if (!live) {
      const byNag: Record<string, string> = { "?!": "inaccuracy", "?": "mistake", "??": "blunder" };
      return featuredGame.moves.map((m) => ({
        san: m.san,
        evalCp: m.eval,
        mateIn: null,
        nag: m.nag,
        judgment: m.nag ? byNag[m.nag] : undefined,
      }));
    }
    return rowsToViewMoves(sans, rows ?? []);
  }, [live, sans, rows]);

  const analyzedRows = live ? (rows?.length ?? 0) > 0 : true;

  // Beim Partiewechsel ans Ende springen.
  useEffect(() => {
    setPly(sans.length);
    setLiveEval(null);
  }, [selectedId, sans.length]);

  const fen = useMemo(() => fenAfter(sans, ply), [sans, ply]);

  // Tastatur-Navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(sans.length, p + 1));
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
  const storedEval = ply === 0 ? 20 : evalNum(viewMoves[ply - 1]?.evalCp ?? null, viewMoves[ply - 1]?.mateIn ?? null);
  const shownEval = liveEval ? evalNum(liveEval.cp, liveEval.mate) : storedEval;
  const whitePct = winProb(shownEval);
  const currentMove = ply > 0 ? viewMoves[ply - 1] : null;
  const currentComment = useMemo(() => {
    if (!currentMove) return null;
    if (!live) return featuredGame.moves[ply - 1]?.comment ?? null;
    const prevEval = ply <= 1 ? 20 : evalNum(viewMoves[ply - 2]?.evalCp ?? null, viewMoves[ply - 2]?.mateIn ?? null);
    return commentFor(t, sans.slice(0, ply - 1), currentMove, prevEval);
  }, [live, currentMove, ply, sans, viewMoves, t]);

  const evalSeries = viewMoves
    .map((m, i) => ({ ply: i + 1, eval: Math.max(-600, Math.min(600, evalNum(m.evalCp, m.mateIn))) / 100 }))
    .filter((_, i) => !live || (rows ?? []).length > i);

  const summary = useMemo(() => {
    const counts = { inaccuracy: 0, mistake: 0, blunder: 0 };
    viewMoves.forEach((m, i) => {
      const mine = !live || !game ? true : (game.color === "white") === (i % 2 === 0);
      if (m.judgment && m.judgment in counts && mine) {
        counts[m.judgment as keyof typeof counts]++;
      }
    });
    return { ...counts, acpl: acpl(viewMoves) };
  }, [viewMoves, live, game]);

  const unanalyzed = games.filter((g) => !g.analyzed);
  const headerSub = live
    ? `${game.color === "white" ? t("an.me") : game.opponent} vs. ${game.color === "white" ? game.opponent : t("an.meLower")} · ${game.opening || game.eco || "—"} · ${game.played_at}`
    : `${featuredGame.white} vs. ${featuredGame.black} · ${featuredGame.event} · ${featuredGame.result}`;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("an.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{headerSub}</p>
        </div>
        {live && <ResultBadge result={game.result} />}
      </header>

      {desktop && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5">
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="min-w-0 max-w-[380px] flex-1 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
          >
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
              {unanalyzed.length > 0 && (
                <Button
                  onClick={() => {
                    setNotice(null);
                    setRunning(true);
                    startAnalysis({ limit: 10 }).catch((e) => {
                      setRunning(false);
                      setNotice(String(e));
                    });
                  }}
                >
                  <ListChecks size={14} /> {t("an.nextTen", { n: unanalyzed.length })}
                </Button>
              )}
              {unanalyzed.length > 10 && (
                <Button
                  onClick={() => {
                    setNotice(null);
                    setRunning(true);
                    startAnalysis({}).catch((e) => {
                      setRunning(false);
                      setNotice(String(e));
                    });
                  }}
                >
                  {t("an.analyzeAll")}
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

      {desktop && games.length === 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-line2 px-4 py-6 text-center text-[13px] text-ink3">
          {t("an.noGames")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1240px]:grid-cols-[auto_1fr_300px]">
        {/* Brett + Eval-Bar (Bar streckt sich auf Board-Höhe) */}
        <div className="min-[1240px]:w-[432px]">
          <div className="flex gap-3">
            <div className="flex w-5 shrink-0 flex-col self-stretch overflow-hidden rounded-md border border-line">
              <div className="w-full" style={{ height: `${100 - whitePct}%`, background: "#3a3a37", transition: "height 0.3s" }} />
              <div className="w-full bg-[#e6e3d3]" style={{ height: `${whitePct}%`, transition: "height 0.3s" }} />
            </div>
            <div className="min-w-0 flex-1">
              <Board boardId="analysis" fen={fen} width={400} orientation={live && game.color === "black" ? "black" : "white"} />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between pl-8">
            <div className="flex gap-1">
              <Button onClick={() => setPly(0)}><ChevronFirst size={15} /></Button>
              <Button onClick={() => setPly((p) => Math.max(0, p - 1))}><ChevronLeft size={15} /></Button>
              <Button onClick={() => setPly((p) => Math.min(sans.length, p + 1))}><ChevronRight size={15} /></Button>
              <Button onClick={() => setPly(sans.length)}><ChevronLast size={15} /></Button>
            </div>
            <div className="text-[15px] font-semibold tabular-nums" style={{ color: shownEval >= 0 ? "var(--color-ink)" : "var(--color-ink2)" }}>
              {liveEval?.mate != null ? `#${liveEval.mate}` : evalLabel(shownEval)}
            </div>
          </div>
        </div>

        {/* Zugliste + Eval-Graph */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t("an.game")} pad={false} className="flex-1">
            <div className="max-h-[290px] overflow-y-auto p-3">
              <div className="flex flex-wrap gap-x-1 gap-y-1.5 text-[13.5px] leading-relaxed">
                {viewMoves.map((m, i) => (
                  <span key={i} className="inline-flex items-center">
                    {i % 2 === 0 && (
                      <span className="mr-1 text-[12px] text-ink3">{i / 2 + 1}.</span>
                    )}
                    <button
                      onClick={() => setPly(i + 1)}
                      className={`rounded px-1 py-0.5 font-medium transition-colors ${
                        ply === i + 1 ? "bg-accent-soft text-accent" : "hover:bg-panel2"
                      }`}
                    >
                      {m.san}
                      {m.nag && (
                        <span className="ml-0.5" style={{ color: nagColor[m.nag] }}>{m.nag}</span>
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
                  style={{ borderColor: currentMove?.nag ? nagColor[currentMove.nag] : "var(--color-accent)" }}>
                  <span className="font-medium" style={{ color: currentMove?.nag ? nagColor[currentMove.nag] : "var(--color-accent)" }}>
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
                    onClick={(e) => e?.activeLabel != null && setPly(Number(e.activeLabel))}>
                    <XAxis dataKey="ply" hide />
                    <YAxis domain={[-6, 6]} hide />
                    <ReferenceLine y={0} stroke="#3a3a37" />
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
        <div className="flex flex-col gap-4">
          <LiveEngine
            fen={fen}
            demoLines={featuredGame.pvLines}
            onEval={(cp, mate) => setLiveEval({ cp, mate })}
          />

          <Card title={live ? t("an.myErrors") : t("an.autoAnnotation")}>
            <ul className="flex flex-col gap-2 text-[13px]">
              <li className="flex justify-between">
                <span style={{ color: nagColor["?!"] }}>{t("an.inaccuracies")}</span>
                <span className="font-medium">{summary.inaccuracy}</span>
              </li>
              <li className="flex justify-between">
                <span style={{ color: nagColor["?"] }}>{t("an.mistakes")}</span>
                <span className="font-medium">{summary.mistake}</span>
              </li>
              <li className="flex justify-between">
                <span style={{ color: nagColor["??"] }}>{t("an.blunders")}</span>
                <span className="font-medium">{summary.blunder}</span>
              </li>
            </ul>
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
              {t("an.acpl")}{" "}
              <span className="text-ink2">{t("common.white")} {live ? summary.acpl.white : featuredGame.summary.acplWhite}</span> ·{" "}
              <span className="text-ink2">{t("common.black")} {live ? summary.acpl.black : featuredGame.summary.acplBlack}</span>
            </div>
          </Card>

          {live && (
            <Card title={t("an.phaseAccuracy")}>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  [t("ins.phase.opening"), game.accuracy_opening],
                  [t("ins.phase.middlegame"), game.accuracy_middlegame],
                  [t("ins.phase.endgame"), game.accuracy_endgame],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-panel2 px-1.5 py-2">
                    <div className="text-[10.5px] text-ink3">{label}</div>
                    <div className="mt-0.5 text-[13px] font-semibold text-ink2">
                      {value == null ? "—" : `${de(value)} %`}
                    </div>
                  </div>
                ))}
              </div>
              {game.accuracy_opening == null && game.accuracy_middlegame == null && game.accuracy_endgame == null && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("an.phaseAccuracyMissing")}</p>
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
