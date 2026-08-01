import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Download,
  FileUp,
  GraduationCap,
  Lightbulb,
  ListTree,
  Loader2,
  Plus,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { repertoire as demoRepertoire, repertoireStats, type RepNode as DemoNode } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n, useT, type TFunc } from "../lib/i18n";
import {
  repAddLine,
  repDelete,
  repExportPgnFile,
  repGaps,
  repImportPgn,
  repImportPgnFile,
  repList,
  repLookup,
  repNodeGames,
  repSetNote,
  repStats,
  type NodeGameStats,
  type RepGap,
  type RepNode,
  type RepStats,
} from "../lib/repertoire";
import { chessdbQuery, getSettings, type ChessDbResult } from "../lib/settings";
import Board from "../components/Board";
import LiveEngine from "../components/LiveEngine";
import RepertoireTrainer from "../components/RepertoireTrainer";
import { useMobileShell } from "../components/MobileShell";
import { BOARD_WIDTH } from "../lib/boardLayout";
import { useBoardSelection } from "../lib/boardMoves";
import { Button, Card, Chip } from "../components/ui";
import { de, errorMessage, fenAfter } from "../lib/util";
import { isStoreCapture } from "../lib/storeCapture";

/** Prüftiefen der Abdeckung · so weit reicht bei den meisten ein Repertoire. */
const COVERAGE_PLIES = [6, 8, 12, 16];

export default function Repertoire() {
  const backend = useBackendInfo();
  if (backend.mode === "pending") return null;
  return backend.mode === "desktop" ? <LiveRepertoire /> : <DemoRepertoire />;
}

// ── Echte Seite (Desktop) ────────────────────────────────────────────────────

function moveLabel(n: RepNode): string {
  const num = Math.ceil(n.depth / 2);
  const san = n.depth % 2 === 1 ? `${num}.${n.san}` : `${num}…${n.san}`;
  return n.name ? `${san} · ${n.name}` : san;
}

function dueLabel(t: TFunc, n: RepNode, now: number): string {
  if (!n.my_move) return "";
  if (n.reps === 0) return t("rep.new");
  if (n.due_ts <= now) return t("rep.due");
  const days = Math.ceil((n.due_ts - now) / 86_400);
  return t(days === 1 ? "rep.inDays.one" : "rep.inDays.many", { n: days });
}

/** Zugliste als "1.e4 e5 2.Nf3" · dieselbe Form überall auf der Seite. */
function moveText(sans: string[]): string {
  return sans.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");
}

/** Auf dem Handy klappt ein Bereich zu, auf dem Desktop steht er offen. */
function Panel({
  compact,
  icon,
  title,
  children,
  defaultOpen = false,
  pad = true,
}: {
  compact: boolean;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  pad?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!compact) {
    return (
      <Card title={<span className="flex items-center gap-2">{icon} {title}</span>} pad={pad}>
        {children}
      </Card>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left"
      >
        <span className="text-accent">{icon}</span>
        <span className="flex-1 text-[13.5px] font-medium text-ink">{title}</span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className={`border-t border-line ${pad ? "p-4" : ""}`}>{children}</div>}
    </section>
  );
}

function LiveRepertoire() {
  const t = useT();
  const compact = useMobileShell();
  const [nodes, setNodes] = useState<RepNode[]>([]);
  const [stats, setStats] = useState<RepStats | null>(null);
  const [gaps, setGaps] = useState<RepGap[] | null>(null);
  const [plies, setPlies] = useState(8);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nodeStats, setNodeStats] = useState<NodeGameStats | null>(null);
  const [mode, setMode] = useState<"browse" | "add" | "train">("browse");
  const [notice, setNotice] = useState<string | null>(null);
  const [limits, setLimits] = useState<{ due: number; fresh: number }>({ due: 20, fresh: 5 });
  const now = Math.floor(Date.now() / 1000);

  const reload = useCallback(() => {
    repList().then(setNodes).catch(() => {});
    repGaps().then(setGaps).catch(() => setGaps([]));
    repStats(plies).then(setStats).catch(() => {});
  }, [plies]);

  useEffect(() => {
    repList().then(setNodes).catch(() => {});
    repGaps().then(setGaps).catch(() => setGaps([]));
  }, []);

  // Die Prüftiefe ändert nur die Abdeckung · Baum und Lücken bleiben stehen.
  useEffect(() => {
    repStats(plies).then(setStats).catch(() => {});
  }, [plies]);

  useEffect(() => {
    getSettings()
      .then((s) => setLimits({ due: s.rep_due_limit, fresh: s.rep_new_limit }))
      .catch(() => {});
  }, []);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const children = useMemo(() => {
    const map = new Map<string, RepNode[]>();
    for (const n of nodes) {
      const key = `${n.side}:${n.parent_id}`;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [nodes]);

  /**
   * Stellungen, die im Baum mehrfach vorkommen. Das Repertoire ist ein Baum,
   * Schach nicht: dieselbe Stellung über eine andere Zugfolge wird ein zweiter
   * Knoten mit eigenem Lernstand · sichtbar zu machen ist das Mindeste.
   */
  const transpositions = useMemo(() => {
    const map = new Map<string, RepNode[]>();
    for (const n of nodes) {
      const key = `${n.side}:${n.fen_key}`;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [nodes]);
  const twinsOf = useCallback(
    (n: RepNode) => (transpositions.get(`${n.side}:${n.fen_key}`) ?? []).filter((o) => o.id !== n.id),
    [transpositions]
  );

  /** Anzahl fälliger eigener Züge im Teilbaum (inkl. Knoten selbst). */
  const dueCount = useCallback(
    (n: RepNode): number => {
      const self = n.my_move && (n.reps === 0 || n.due_ts <= now) ? 1 : 0;
      const kids = children.get(`${n.side}:${n.id}`) ?? [];
      return self + kids.reduce((s, k) => s + dueCount(k), 0);
    },
    [children, now]
  );

  const pathSans = useCallback(
    (id: number | null): string[] => {
      const path: string[] = [];
      let cur = id;
      while (cur != null && cur !== 0) {
        const n = byId.get(cur);
        if (!n) break;
        path.push(n.san);
        cur = n.parent_id;
      }
      return path.reverse();
    },
    [byId]
  );

  const selected = selectedId != null ? (byId.get(selectedId) ?? null) : null;
  const baseSans = useMemo(() => pathSans(selectedId), [pathSans, selectedId]);
  const fen = useMemo(() => fenAfter(baseSans), [baseSans]);

  useEffect(() => {
    setNodeStats(null);
    if (selectedId != null) {
      repNodeGames(selectedId).then(setNodeStats).catch(() => {});
    }
  }, [selectedId, nodes]);

  const seedStarter = async () => {
    const flat: { side: "white" | "black"; name: string; sans: string[] }[] = [];
    const collect = (side: "white" | "black", ns: DemoNode[]) => {
      for (const n of ns) {
        flat.push({ side, name: n.label, sans: n.moveSeq });
        if (n.children) collect(side, n.children);
      }
    };
    for (const grp of demoRepertoire) collect(grp.side === "Weiß" ? "white" : "black", grp.nodes);
    try {
      for (const line of flat) await repAddLine(line.side, line.name, line.sans);
      reload();
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const remove = async (id: number) => {
    await repDelete(id).catch((e) => setNotice(errorMessage(e)));
    if (selectedId === id) setSelectedId(null);
    reload();
  };

  /** Einen Zug aus einer Lücke ins Buch übernehmen. */
  const adoptGap = async (gap: RepGap) => {
    try {
      await repAddLine(gap.side, "", [...gap.path_sans, gap.san]);
      reload();
      setNotice(t("rep.gapAdded", { san: gap.san }));
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const dueTotal = stats?.due_now ?? 0;

  const treePanel = (
    <Panel compact={compact} icon={<ListTree size={14} />} title={t("rep.variants")} pad={false}>
      {/* Der Baum wächst mit dem Repertoire und schöbe sonst alles unter ihm
          aus dem Bild · deshalb scrollt er in sich, statt die Seite zu dehnen. */}
      <div className="max-h-[min(58vh,620px)] overflow-y-auto p-2">
        {(["white", "black"] as const).map((side) => (
          <div key={side} className="mb-2">
            <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">
              {side === "white" ? t("common.asWhite") : t("common.asBlack")}
            </div>
            {(children.get(`${side}:0`) ?? []).map((n) => (
              <TreeNode
                key={n.id}
                node={n}
                depth={0}
                selected={selectedId}
                onSelect={setSelectedId}
                children_={children}
                dueCount={dueCount}
                twins={twinsOf}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        {nodes.length === 0 && (
          <button
            onClick={seedStarter}
            className="mb-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-accent-dim px-3 py-2 text-[12.5px] text-accent transition-colors hover:bg-accent-soft"
          >
            <Sparkles size={14} /> {t("rep.seedStarter")}
          </button>
        )}
        <button
          onClick={() => setMode("add")}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 px-3 py-2 text-left text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
        >
          <Plus size={14} className="shrink-0" />
          <span className="min-w-0 truncate">
            {selected ? t("rep.addLineFrom", { label: moveLabel(selected) }) : t("rep.addLine")}
          </span>
        </button>
      </div>
    </Panel>
  );

  const boardPane = (
    <div>
      <Board
        boardId="repertoire"
        fen={fen}
        width={BOARD_WIDTH}
        orientation={selected?.side ?? "white"}
      />
      <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(baseSans) || t("rep.startPos")}
      </div>
    </div>
  );

  const detailsPane = (
    <div className="flex flex-col gap-4">
      {selected ? (
        <>
          <Card
            title={moveLabel(selected)}
            action={
              <button
                onClick={() => remove(selected.id)}
                className="text-ink3 transition-colors hover:text-loss"
                title={t("rep.deleteVariant")}
              >
                <Trash2 size={15} />
              </button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">{t("rep.reps")}</div>
                <div className="mt-1 text-[20px] font-semibold">
                  {selected.reps}
                  {selected.lapses > 0 && (
                    <span className="ml-1.5 text-[12px] font-normal text-loss">
                      {t("rep.lapses", { n: selected.lapses })}
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">{t("rep.nextReview")}</div>
                <div className="mt-1 text-[20px] font-semibold">
                  {selected.my_move ? dueLabel(t, selected, now) : "—"}
                </div>
              </div>
            </div>
            <div className="mt-3 text-[12.5px] leading-relaxed text-ink3">
              {selected.my_move
                ? t("rep.stability", { n: de(Math.max(selected.stability, 0)) })
                : t("rep.opponentMove")}
            </div>
            <NoteEditor
              key={selected.id}
              node={selected}
              onSaved={reload}
              onError={(e) => setNotice(e)}
            />
            {twinsOf(selected).length > 0 && (
              <div className="mt-3 flex gap-2 rounded-lg border border-gold/40 bg-[#2a2414] px-3 py-2 text-[12px] leading-relaxed text-gold">
                <Shuffle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t("rep.transposition", {
                    lines: twinsOf(selected)
                      .map((n) => moveText(pathSans(n.id)))
                      .join(" · "),
                  })}
                </span>
              </div>
            )}
          </Card>

          <Card title={t("rep.gamesCard")}>
            {nodeStats && nodeStats.games > 0 ? (
              <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
                <li className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-win" />
                  <span className="text-ink2">
                    {t("rep.reachedIn", {
                      games: `${nodeStats.games} ${t(nodeStats.games === 1 ? "common.games.one" : "common.games.many")}`,
                      p: de(nodeStats.score_pct),
                    })}
                  </span>
                </li>
                {nodeStats.book_sans.length > 0 && (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                    <span className="text-ink2">
                      {t("rep.bookContinuation", {
                        sans: nodeStats.book_sans.join(" / "),
                        n: nodeStats.followed_book,
                      })}
                    </span>
                  </li>
                )}
                {nodeStats.deviations.length > 0 && (
                  <li className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-loss" />
                    <span className="text-ink2">
                      {t("rep.deviations", {
                        list: nodeStats.deviations.map((d) => `${d.san} (${d.count}×)`).join(", "),
                      })}
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <div className="text-[12.5px] leading-relaxed text-ink3">{t("rep.posNotInGames")}</div>
            )}
          </Card>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-6 text-center text-[12.5px] leading-relaxed text-ink3">
          {t(compact ? "rep.selectHintMobile" : "rep.selectHint")}
        </div>
      )}

      <CoverageCard stats={stats} plies={plies} onPlies={setPlies} />
      <GapsCard gaps={gaps} onAdopt={adoptGap} />
      <BookCard onDone={reload} onNotice={setNotice} />
    </div>
  );

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("rep.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {stats
              ? t("rep.summary", {
                  n: stats.my_positions,
                  p: de(stats.coverage_pct),
                  g: stats.games_checked,
                })
              : t("common.loading")}
          </p>
        </div>
        {mode !== "train" && (
          <Button
            primary
            onClick={() => setMode("train")}
            className={dueTotal === 0 ? "opacity-60" : ""}
          >
            <GraduationCap size={16} />
            {t("rep.startTraining", { n: dueTotal })}
          </Button>
        )}
      </header>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-line2 bg-panel2 px-4 py-2.5 text-[12.5px] text-ink2">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-ink3 hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {mode === "train" ? (
        <RepertoireTrainer
          nodes={nodes}
          dueLimit={limits.due}
          newLimit={limits.fresh}
          onExit={() => {
            setMode("browse");
            reload();
          }}
        />
      ) : mode === "add" ? (
        <AddLine
          baseSans={baseSans}
          baseSide={selected?.side ?? null}
          onDone={(err) => {
            setMode("browse");
            if (err) setNotice(err);
            reload();
          }}
        />
      ) : compact ? (
        // Auf dem Handy zuerst das Brett · der Variantenbaum ist eine lange
        // Liste und schöbe sonst alles Wesentliche unter die Falz.
        <div className="flex flex-col gap-4">
          {boardPane}
          {detailsPane}
          {treePanel}
        </div>
      ) : (
        <RepertoireGrid tree={treePanel} board={boardPane} details={detailsPane} />
      )}
    </div>
  );
}

/**
 * Die drei Bereiche der Browse-Ansicht über die Fensterbreite verteilt.
 *
 * Das Brett hat eine feste Kantenlänge, die beiden anderen Spalten nicht ·
 * deshalb hängt die Aufteilung an genau zwei Schwellen:
 *
 * - schmal · eine Spalte, Brett zuerst; der Baum ist Navigation und darf nach
 *   unten, sonst steht die Stellung unter der Falz.
 * - ab 1180 px · Brett und Baum links untereinander, Details rechts daneben.
 *   Dieselbe Schwelle wie auf der Puzzle-Seite, die dieselbe Form hat.
 * - ab 1480 px · alle drei nebeneinander, wie gehabt.
 *
 * Ohne die mittlere Stufe stand auf jedem üblichen Fenster (1440 px minus
 * Seitenleiste) alles untereinander, mit einem 1200 px breiten Variantenbaum
 * ganz oben.
 */
function RepertoireGrid({
  tree,
  board,
  details,
}: {
  tree: ReactNode;
  board: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1180px]:grid-cols-[528px_minmax(0,1fr)] min-[1480px]:grid-cols-[280px_528px_minmax(0,1fr)]">
      <div className="order-1 min-[1180px]:col-start-1 min-[1180px]:row-start-1 min-[1480px]:col-start-2">
        {board}
      </div>
      <div className="order-2 min-[1180px]:col-start-2 min-[1180px]:row-start-1 min-[1180px]:row-span-2 min-[1480px]:col-start-3">
        {details}
      </div>
      <div className="order-3 min-[1180px]:col-start-1 min-[1180px]:row-start-2 min-[1480px]:col-start-1 min-[1480px]:row-start-1 min-[1480px]:row-span-2">
        {tree}
      </div>
    </div>
  );
}

/** Freitext zur Stellung · Plan, Idee, Falle. */
function NoteEditor({
  node,
  onSaved,
  onError,
}: {
  node: RepNode;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(node.note);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== node.note.trim();

  const save = async () => {
    setBusy(true);
    try {
      await repSetNote(node.id, text);
      onSaved();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <label className="text-[11.5px] text-ink3">{t("rep.note")}</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t("rep.notePlaceholder")}
        className="mt-1.5 w-full resize-y rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={() => setText(node.note)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button primary onClick={save} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Abdeckung: wie oft die letzten Partien im Buch blieben · je Farbe getrennt. */
function CoverageCard({
  stats,
  plies,
  onPlies,
}: {
  stats: RepStats | null;
  plies: number;
  onPlies: (value: number) => void;
}) {
  const t = useT();
  return (
    <Card title={t("rep.coverage")}>
      <div className="flex flex-wrap gap-1.5">
        {COVERAGE_PLIES.map((value) => (
          <Chip key={value} active={plies === value} onClick={() => onPlies(value)}>
            {t("rep.coveragePlies", { n: value })}
          </Chip>
        ))}
      </div>
      {stats ? (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[24px] font-semibold">{de(stats.coverage_pct)} %</span>
            <span className="text-[12px] text-ink3">
              {t("rep.coverageOf", { g: stats.games_checked })}
            </span>
          </div>
          {stats.by_side.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {stats.by_side.map((side) => (
                <div key={side.side} className="flex items-center gap-3 text-[12.5px]">
                  <span className="w-20 shrink-0 text-ink3">
                    {side.side === "white" ? t("common.asWhite") : t("common.asBlack")}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${side.pct}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right tabular-nums text-ink2">
                    {de(side.pct)} % · {side.games}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 text-[12.5px] text-ink3">{t("common.loading")}</div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.coverageNote")}</p>
    </Card>
  );
}

/**
 * Lücken aus den eigenen Partien · der kürzeste Weg zu neuen Varianten.
 *
 * Zugeklappt, weil die Liste lang wird und niemand sie bei jedem Blick aufs
 * Repertoire braucht · die Kopfzeile sagt trotzdem, wie viele es sind.
 */
function GapsCard({ gaps, onAdopt }: { gaps: RepGap[] | null; onAdopt: (gap: RepGap) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card
      title={
        <span className="flex items-baseline gap-2">
          {t("rep.gaps")}
          {gaps != null && gaps.length > 0 && (
            <span className="text-[11.5px] font-normal tabular-nums text-ink3">{gaps.length}</span>
          )}
        </span>
      }
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
        >
          {t(open ? "rep.gapsHide" : "rep.gapsShow")}
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {!open ? (
        <p className="text-[12px] leading-relaxed text-ink3">
          {gaps == null
            ? t("common.loading")
            : gaps.length === 0
              ? t("rep.gapsNone")
              : t("rep.gapsCollapsed", { n: gaps.length })}
        </p>
      ) : gaps == null ? (
        <div className="text-[12.5px] text-ink3">{t("common.loading")}</div>
      ) : gaps.length === 0 ? (
        <div className="text-[12.5px] leading-relaxed text-ink3">{t("rep.gapsNone")}</div>
      ) : (
        <ul className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
          {gaps.map((gap) => (
            <li
              key={`${gap.node_id}-${gap.side}-${gap.san}`}
              className="rounded-lg border border-line bg-panel2 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink">
                    {gap.mine
                      ? t("rep.gapMine", { san: gap.san, n: gap.count })
                      : t("rep.gapTheirs", { san: gap.san, n: gap.count })}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink3">
                    {moveText(gap.path_sans) || t("rep.startPos")}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">
                    {t("rep.gapBook", { sans: gap.book_sans.join(" / ") })} · {de(gap.score_pct)} %
                  </div>
                </div>
                <Button onClick={() => onAdopt(gap)} title={t("rep.gapAdopt")}>
                  <Plus size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.gapsNote")}</p>}
    </Card>
  );
}

/** Buch als PGN einlesen und ausgeben · mit Varianten in Klammern. */
function BookCard({
  onDone,
  onNotice,
}: {
  onDone: () => void;
  onNotice: (message: string) => void;
}) {
  const t = useT();
  const [side, setSide] = useState<"white" | "black">("white");
  const [name, setName] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  const report = (result: { lines: number; added: number; skipped: number }) => {
    onNotice(t("rep.pgnImported", { lines: result.lines, n: result.added }));
    onDone();
  };

  const importFile = async () => {
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (typeof chosen !== "string") return;
    setBusy(true);
    try {
      report(await repImportPgnFile(side, name.trim(), chosen));
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const importText = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    try {
      report(await repImportPgn(side, name.trim(), pasted));
      setPasted("");
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportFile = async () => {
    const chosen = await saveDialog({
      defaultPath: `kiebitz-repertoire-${side}.pgn`,
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (!chosen) return;
    setBusy(true);
    try {
      const path = await repExportPgnFile(side, chosen);
      onNotice(t("rep.pgnExported", { path }));
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t("rep.book")}>
      <div className="flex flex-wrap gap-1.5">
        {(["white", "black"] as const).map((s) => (
          <Chip key={s} active={side === s} onClick={() => setSide(s)}>
            {s === "white" ? t("common.asWhite") : t("common.asBlack")}
          </Chip>
        ))}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("rep.namePlaceholder")}
        className="mt-3 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => !busy && importFile()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{" "}
          {t("rep.pgnImport")}
        </Button>
        <Button onClick={() => !busy && exportFile()}>
          <Download size={14} /> {t("rep.pgnExport")}
        </Button>
        <Button onClick={() => setShowPaste((v) => !v)}>{t("rep.pgnPaste")}</Button>
      </div>
      {showPaste && (
        <div className="mt-3">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder="1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6"
            className="w-full resize-y rounded-lg border border-line bg-panel2 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button primary onClick={() => !busy && importText()} disabled={!pasted.trim()}>
              <Check size={14} /> {t("common.import")}
            </Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("rep.pgnNote")}</p>
    </Card>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
  children_,
  dueCount,
  twins,
}: {
  node: RepNode;
  depth: number;
  selected: number | null;
  onSelect: (id: number) => void;
  children_: Map<string, RepNode[]>;
  dueCount: (n: RepNode) => number;
  twins: (n: RepNode) => RepNode[];
}) {
  const [open, setOpen] = useState(depth < 2);
  const kids = children_.get(`${node.side}:${node.id}`) ?? [];
  const due = dueCount(node);
  const hasTwins = twins(node).length > 0;

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors ${
          selected === node.id ? "bg-panel3 text-ink" : "text-ink2 hover:bg-panel2"
        }`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => onSelect(node.id)}
      >
        {kids.length > 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-ink3 hover:text-ink"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px]" />
        )}
        <span className="flex-1 truncate text-[13px]">{moveLabel(node)}</span>
        {node.note.trim() !== "" && <Lightbulb size={12} className="shrink-0 text-ink3" />}
        {hasTwins && <Shuffle size={12} className="shrink-0 text-gold" />}
        {due > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
            {due}
          </span>
        )}
      </div>
      {open &&
        kids.map((c) => (
          <TreeNode
            key={c.id}
            node={c}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            children_={children_}
            dueCount={dueCount}
            twins={twins}
          />
        ))}
    </div>
  );
}

// ── Variante am Brett eingeben ───────────────────────────────────────────────

function AddLine({
  baseSans,
  baseSide,
  onDone,
}: {
  baseSans: string[];
  baseSide: "white" | "black" | null;
  onDone: (err?: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [side, setSide] = useState<"white" | "black">(baseSide ?? "white");
  const [book, setBook] = useState<ChessDbResult | null>(null);
  const [twins, setTwins] = useState<RepNode[]>([]);
  const chessRef = useRef<Chess>(new Chess());

  const sans = useMemo(() => [...baseSans, ...draft], [baseSans, draft]);

  useEffect(() => {
    const c = new Chess();
    for (const s of sans) c.move(s);
    chessRef.current = c;
  }, [sans]);

  const fen = useMemo(() => fenAfter(sans), [sans]);

  // Steht diese Stellung schon woanders im Buch? Entprellt, weil beim
  // schnellen Durchklicken sonst jede Zwischenstellung nachfragt.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      repLookup(side, sans)
        .then((found) => {
          if (!stale) setTwins(found);
        })
        .catch(() => {});
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [side, sans]);

  // ChessDB als Orientierung beim Bauen · ohne sie legt man Varianten an,
  // ohne zu wissen, was überhaupt gespielt wird.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      chessdbQuery(fen)
        .then((r) => {
          if (!stale) setBook(r);
        })
        .catch(() => {
          if (!stale) setBook(null);
        });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [fen]);

  const tryMove = (from: string, to: string): boolean => {
    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      setDraft((d) => [...d, move.san]);
      return true;
    } catch {
      return false;
    }
  };
  const addSelection = useBoardSelection(fen, tryMove);

  /** Zug aus dem Eröffnungsbuch übernehmen. */
  const playSan = (san: string) => {
    try {
      const move = chessRef.current.move(san);
      setDraft((d) => [...d, move.san]);
    } catch {
      /* Zug passt nicht zur Stellung · dann eben nicht. */
    }
  };

  const save = async () => {
    if (draft.length === 0) return;
    try {
      await repAddLine(side, name, sans);
      onDone();
    } catch (e) {
      onDone(errorMessage(e));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-[528px_minmax(0,1fr)]">
      <div>
        <Board
          boardId="rep-add"
          fen={fen}
          width={BOARD_WIDTH}
          draggable
          onPieceDrop={tryMove}
          onSquareClick={addSelection.onSquareClick}
          squareStyles={addSelection.squareStyles}
          orientation={side}
          mouseDrag
        />
        <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
          {moveText(sans) || t("rep.playOnBoard")}
        </div>
      </div>
      <div className="flex max-w-[420px] flex-col gap-3">
        <Card title={t("rep.newVariant")}>
          {baseSide == null && (
            <div className="mb-3 flex gap-2">
              {(["white", "black"] as const).map((s) => (
                <Chip key={s} active={side === s} onClick={() => setSide(s)}>
                  {s === "white" ? t("common.asWhite") : t("common.asBlack")}
                </Chip>
              ))}
            </div>
          )}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("rep.namePlaceholder")}
            className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
          />
          {twins.length > 0 && (
            <div className="mt-3 flex gap-2 rounded-lg border border-gold/40 bg-[#2a2414] px-3 py-2 text-[12px] leading-relaxed text-gold">
              <Shuffle size={14} className="mt-0.5 shrink-0" />
              <span>{t("rep.transpositionAdd", { n: twins.length })}</span>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => setDraft((d) => d.slice(0, -1))}
              className={draft.length === 0 ? "opacity-50" : ""}
            >
              <CornerUpLeft size={14} /> {t("rep.undoMove")}
            </Button>
            <Button primary onClick={save} className={draft.length === 0 ? "opacity-50" : "flex-1"}>
              <Check size={14} />{" "}
              {t(draft.length === 1 ? "rep.saveMoves.one" : "rep.saveMoves.many", {
                n: draft.length,
              })}
            </Button>
            <Button onClick={() => onDone()}>
              <X size={14} />
            </Button>
          </div>
        </Card>

        <Card title={t("an.book")}>
          {book && book.status === "ok" && book.moves.length > 0 ? (
            <div className="flex flex-col gap-1">
              {book.moves.slice(0, 6).map((m) => (
                <button
                  key={m.uci}
                  onClick={() => playSan(m.san || m.uci)}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-panel2"
                >
                  <span className="w-14 text-left font-medium">{m.san || m.uci}</span>
                  <span className="tabular-nums text-ink2">
                    {m.score != null
                      ? `${m.score >= 0 ? "+" : "−"}${de(Math.abs(m.score) / 100, 2)}`
                      : "—"}
                  </span>
                  <span className="w-16 text-right text-[11.5px] text-ink3">
                    {m.winrate != null ? `${m.winrate} %` : ""}
                  </span>
                </button>
              ))}
              <div className="mt-1 border-t border-line pt-1.5 text-[11px] text-ink3">
                {t("rep.bookClickHint")}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-ink3">{t("an.bookUnknown")}</div>
          )}
        </Card>

        <LiveEngine fen={fen} demoLines={[]} />

        <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
          {t("rep.playBothSides", {
            side: side === "white" ? t("common.white") : t("common.black"),
          })}
        </div>
      </div>
    </div>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function flatten(nodes: DemoNode[]): DemoNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}
const allDemoNodes = flatten(demoRepertoire.flatMap((r) => r.nodes));

const STORE_EN_NODE_LABELS: Record<string, string> = {
  w1: "Italian Game",
  w1a: "Giuoco Pianissimo (3…Bc5 4.c3)",
  w1b: "Two Knights Defense (3…Nf6 4.d3)",
  w1c: "Hungarian Defense (3…Be7)",
  w2: "Open Sicilian",
  w2a: "Najdorf (5…a6 6.Be3)",
  b1: "Queen's Gambit Declined",
  b2: "Caro–Kann",
  b2a: "Advance Variation (3.e5 Bf5)",
};

function DemoTreeNode({
  node,
  depth,
  selected,
  onSelect,
  englishCapture,
}: {
  node: DemoNode;
  depth: number;
  selected: string;
  onSelect: (id: string) => void;
  englishCapture: boolean;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = !!node.children?.length;

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors ${
          selected === node.id ? "bg-panel3 text-ink" : "text-ink2 hover:bg-panel2"
        }`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            className="text-ink3 hover:text-ink"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-[14px]" />
        )}
        <span className="flex-1 truncate text-[13px]">
          {englishCapture ? STORE_EN_NODE_LABELS[node.id] ?? node.label : node.label}
        </span>
        {node.due > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
            {node.due}
          </span>
        )}
      </div>
      {open &&
        node.children?.map((c) => (
          <DemoTreeNode
            key={c.id}
            node={c}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            englishCapture={englishCapture}
          />
        ))}
    </div>
  );
}

function DemoRepertoire() {
  const { locale, t } = useI18n();
  const compact = useMobileShell();
  const storeCapture = isStoreCapture();
  const englishCapture = storeCapture && locale === "en";
  const [selectedId, setSelectedId] = useState("w1a");
  const node = useMemo(() => allDemoNodes.find((n) => n.id === selectedId)!, [selectedId]);
  const fen = useMemo(() => fenAfter(node.moveSeq), [node]);

  const treePanel = (
    <Panel compact={compact} icon={<ListTree size={14} />} title={t("rep.variants")} pad={false}>
      <div className="max-h-[min(58vh,620px)] overflow-y-auto p-2">
        {demoRepertoire.map((side) => (
          <div key={side.side} className="mb-2">
            <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">
              {side.side === "Weiß" ? t("common.asWhite") : t("common.asBlack")}
            </div>
            {side.nodes.map((n) => (
              <DemoTreeNode
                key={n.id}
                node={n}
                depth={0}
                selected={selectedId}
                onSelect={setSelectedId}
                englishCapture={englishCapture}
              />
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );

  const boardPane = (
    <div>
      <Board boardId="repertoire" fen={fen} width={BOARD_WIDTH} />
      <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(node.moveSeq)}
      </div>
    </div>
  );

  const detailsPane = (
    <div className="flex flex-col gap-4">
      <Card title={englishCapture ? STORE_EN_NODE_LABELS[node.id] ?? node.label : node.label}>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-panel2 px-3 py-2.5">
            <div className="text-[11.5px] text-ink3">{t("rep.trainSuccess")}</div>
            <div
              className="mt-1 text-[20px] font-semibold"
              style={{
                color:
                  node.score >= 85
                    ? "var(--color-win)"
                    : node.score >= 70
                      ? "var(--color-gold)"
                      : "var(--color-loss)",
              }}
            >
              {node.score} %
            </div>
          </div>
          <div className="rounded-lg bg-panel2 px-3 py-2.5">
            <div className="text-[11.5px] text-ink3">{t("rep.dueLabel")}</div>
            <div className="mt-1 text-[20px] font-semibold">
              {node.due}
              <span className="ml-1 text-[12px] font-normal text-ink3">{t("rep.positions")}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
        {t("rep.demoNote")}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("rep.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {storeCapture
              ? locale === "de"
                ? `${repertoireStats.positions} Stellungen · dein persönlicher Eröffnungsplan`
                : `${repertoireStats.positions} positions · your personal opening plan`
              : t("rep.demoSummary", { n: repertoireStats.positions })}
          </p>
        </div>
        <Button primary>
          <GraduationCap size={16} />
          {t("rep.startTraining", { n: repertoireStats.dueToday })}
        </Button>
      </header>

      {compact ? (
        <div className="flex flex-col gap-4">
          {boardPane}
          {detailsPane}
          {treePanel}
        </div>
      ) : (
        <RepertoireGrid tree={treePanel} board={boardPane} details={detailsPane} />
      )}
    </div>
  );
}
