import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  GraduationCap,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { repertoire as demoRepertoire, repertoireStats, type RepNode as DemoNode } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import {
  repAddLine,
  repDelete,
  repDue,
  repList,
  repNodeGames,
  repReview,
  repStats,
  type DueItem,
  type NodeGameStats,
  type RepNode,
  type RepStats,
} from "../lib/repertoire";
import Board from "../components/Board";
import { Button, Card } from "../components/ui";
import { de, fenAfter } from "../lib/util";

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

function dueLabel(n: RepNode, now: number): string {
  if (!n.my_move) return "";
  if (n.reps === 0) return "neu";
  if (n.due_ts <= now) return "fällig";
  const days = Math.ceil((n.due_ts - now) / 86_400);
  return `in ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}

function LiveRepertoire() {
  const [nodes, setNodes] = useState<RepNode[]>([]);
  const [stats, setStats] = useState<RepStats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [nodeStats, setNodeStats] = useState<NodeGameStats | null>(null);
  const [mode, setMode] = useState<"browse" | "add" | "train">("browse");
  const [notice, setNotice] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);

  const reload = useCallback(() => {
    repList().then(setNodes).catch(() => {});
    repStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const children = useMemo(() => {
    const map = new Map<string, RepNode[]>();
    for (const n of nodes) {
      const key = `${n.side}:${n.parent_id}`;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [nodes]);

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
      setNotice(String(e));
    }
  };

  const remove = async (id: number) => {
    await repDelete(id).catch((e) => setNotice(String(e)));
    if (selectedId === id) setSelectedId(null);
    reload();
  };

  const dueTotal = stats?.due_now ?? 0;
  const moveText = baseSans.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m)).join(" ");

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Eröffnungs-Repertoire</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {stats
              ? `${stats.my_positions} eigene Züge im Buch · Abdeckung ${de(stats.coverage_pct)} % deiner letzten ${stats.games_checked} Partien bis Zug 4`
              : "Lade …"}
          </p>
        </div>
        {mode !== "train" && (
          <Button primary onClick={() => setMode("train")} className={dueTotal === 0 ? "opacity-60" : ""}>
            <GraduationCap size={16} />
            Training starten ({dueTotal} fällig)
          </Button>
        )}
      </header>

      {notice && (
        <div className="mb-4 rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5 text-[12.5px] text-loss">
          {notice}
        </div>
      )}

      {mode === "train" ? (
        <Trainer
          onExit={() => {
            setMode("browse");
            reload();
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[1240px]:grid-cols-[300px_auto_1fr]">
          <Card title="Varianten" pad={false}>
            <div className="p-2">
              {(["white", "black"] as const).map((side) => (
                <div key={side} className="mb-2">
                  <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">
                    Als {side === "white" ? "Weiß" : "Schwarz"}
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
                    />
                  ))}
                </div>
              ))}
              {nodes.length === 0 && (
                <button
                  onClick={seedStarter}
                  className="mb-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-accent-dim px-3 py-2 text-[12.5px] text-accent transition-colors hover:bg-accent-soft"
                >
                  <Sparkles size={14} /> Starter-Repertoire übernehmen
                </button>
              )}
              <button
                onClick={() => setMode("add")}
                className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 px-3 py-2 text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
              >
                <Plus size={14} /> Variante hinzufügen {selected ? `(ab ${moveLabel(selected)})` : ""}
              </button>
            </div>
          </Card>

          {mode === "add" ? (
            <AddLine
              baseSans={baseSans}
              baseSide={selected?.side ?? null}
              onDone={(err) => {
                setMode("browse");
                if (err) setNotice(err);
                reload();
              }}
            />
          ) : (
            <>
              <div>
                <Board boardId="repertoire" fen={fen} width={380} orientation={selected?.side ?? "white"} />
                <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
                  {moveText || "Grundstellung — wähle links eine Variante."}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {selected ? (
                  <>
                    <Card
                      title={moveLabel(selected)}
                      action={
                        <button onClick={() => remove(selected.id)} className="text-ink3 transition-colors hover:text-loss" title="Variante löschen">
                          <Trash2 size={15} />
                        </button>
                      }
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg bg-panel2 px-3 py-2.5">
                          <div className="text-[11.5px] text-ink3">Wiederholungen</div>
                          <div className="mt-1 text-[20px] font-semibold">
                            {selected.reps}
                            {selected.lapses > 0 && (
                              <span className="ml-1.5 text-[12px] font-normal text-loss">({selected.lapses}× falsch)</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg bg-panel2 px-3 py-2.5">
                          <div className="text-[11.5px] text-ink3">Nächste Abfrage</div>
                          <div className="mt-1 text-[20px] font-semibold">
                            {selected.my_move ? dueLabel(selected, now) : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 text-[12.5px] leading-relaxed text-ink3">
                        {selected.my_move ? (
                          <>
                            FSRS-Stabilität:{" "}
                            <span className="text-ink2">{de(Math.max(selected.stability, 0))} Tage</span> — steigt mit
                            jeder korrekten Antwort.
                          </>
                        ) : (
                          <>Gegnerzug — trainiert werden deine eigenen Antworten darauf.</>
                        )}
                      </div>
                    </Card>

                    <Card title="Abgleich mit deinen Partien">
                      {nodeStats && nodeStats.games > 0 ? (
                        <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
                          <li className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-win" />
                            <span className="text-ink2">
                              Stellung in <span className="text-ink">{nodeStats.games} {nodeStats.games === 1 ? "Partie" : "Partien"}</span>{" "}
                              erreicht · {de(nodeStats.score_pct)} % Punkte
                            </span>
                          </li>
                          {nodeStats.book_sans.length > 0 && (
                            <li className="flex gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                              <span className="text-ink2">
                                Buch-Fortsetzung {nodeStats.book_sans.join(" / ")} —{" "}
                                <span className="text-ink">{nodeStats.followed_book}× gefolgt</span>
                              </span>
                            </li>
                          )}
                          {nodeStats.deviations.length > 0 && (
                            <li className="flex gap-2">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-loss" />
                              <span className="text-ink2">
                                Vom Buch abgewichen:{" "}
                                <span className="text-ink">
                                  {nodeStats.deviations.map((d) => `${d.san} (${d.count}×)`).join(", ")}
                                </span>
                              </span>
                            </li>
                          )}
                        </ul>
                      ) : (
                        <div className="text-[12.5px] leading-relaxed text-ink3">
                          Diese Stellung kam in deinen importierten Partien noch nicht vor.
                          {nodeStats == null ? "" : " Tipp: Auf der Analyse-Seite den Positionsindex füllen (läuft bei der Auto-Analyse automatisch mit)."}
                        </div>
                      )}
                    </Card>
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-line2 px-4 py-6 text-center text-[12.5px] leading-relaxed text-ink3">
                    Wähle links eine Variante — oder lege mit „Variante hinzufügen" los.
                  </div>
                )}

                <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
                  Im Training zeigt Kiebitz die Stellung — du spielst den Repertoire-Zug auf dem Brett. Richtige
                  Antworten verlängern das Wiederholungsintervall (FSRS).
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
  children_,
  dueCount,
}: {
  node: RepNode;
  depth: number;
  selected: number | null;
  onSelect: (id: number) => void;
  children_: Map<string, RepNode[]>;
  dueCount: (n: RepNode) => number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const kids = children_.get(`${node.side}:${node.id}`) ?? [];
  const due = dueCount(node);

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
  const [draft, setDraft] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [side, setSide] = useState<"white" | "black">(baseSide ?? "white");
  const chessRef = useRef<Chess>(new Chess());

  useEffect(() => {
    const c = new Chess();
    for (const s of [...baseSans, ...draft]) c.move(s);
    chessRef.current = c;
  }, [baseSans, draft]);

  const fen = fenAfter([...baseSans, ...draft]);

  const tryMove = (from: string, to: string): boolean => {
    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      setDraft((d) => [...d, move.san]);
      return true;
    } catch {
      return false;
    }
  };

  const save = async () => {
    if (draft.length === 0) return;
    try {
      await repAddLine(side, name, [...baseSans, ...draft]);
      onDone();
    } catch (e) {
      onDone(String(e));
    }
  };

  const moveText = [...baseSans, ...draft]
    .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m))
    .join(" ");

  return (
    <div className="min-[1240px]:col-span-2">
      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[auto_1fr]">
        <div>
          <Board boardId="rep-add" fen={fen} width={380} draggable onPieceDrop={tryMove} orientation={side} />
          <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
            {moveText || "Züge direkt auf dem Brett spielen …"}
          </div>
        </div>
        <div className="flex max-w-[420px] flex-col gap-3">
          <Card title="Neue Variante">
            {baseSide == null && (
              <div className="mb-3 flex gap-2">
                {(["white", "black"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                      side === s
                        ? "border-accent-dim bg-accent-soft text-accent"
                        : "border-line bg-panel2 text-ink2 hover:border-line2"
                    }`}
                  >
                    Als {s === "white" ? "Weiß" : "Schwarz"}
                  </button>
                ))}
              </div>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name der Variante (optional)"
              className="w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <Button onClick={() => setDraft((d) => d.slice(0, -1))} className={draft.length === 0 ? "opacity-50" : ""}>
                <CornerUpLeft size={14} /> Zug zurück
              </Button>
              <Button primary onClick={save} className={draft.length === 0 ? "opacity-50" : "flex-1"}>
                <Check size={14} /> Speichern ({draft.length} {draft.length === 1 ? "Zug" : "Züge"})
              </Button>
              <Button onClick={() => onDone()}>
                <X size={14} />
              </Button>
            </div>
          </Card>
          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            Spiele beide Seiten der Variante nach — trainiert werden später nur deine eigenen Züge
            ({side === "white" ? "Weiß" : "Schwarz"}).
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FSRS-Training ────────────────────────────────────────────────────────────

function Trainer({ onExit }: { onExit: () => void }) {
  const [items, setItems] = useState<DueItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<"ask" | "correct" | "wrong">("ask");
  const [shake, setShake] = useState(false);
  const [doneCount, setDoneCount] = useState({ ok: 0, fail: 0 });
  const failedRef = useRef(false);
  const chessRef = useRef<Chess>(new Chess());

  useEffect(() => {
    repDue().then(setItems).catch(() => setItems([]));
  }, []);

  const item = items?.[idx] ?? null;
  const fen = useMemo(() => fenAfter(item?.prompt_sans), [item]);

  useEffect(() => {
    chessRef.current = new Chess(fen);
    failedRef.current = false;
    setState("ask");
  }, [fen, idx]);

  const next = () => {
    setIdx((i) => i + 1);
  };

  const tryMove = (from: string, to: string): boolean => {
    if (!item || state === "correct") return false;
    let san: string;
    try {
      const move = chessRef.current.move({ from, to, promotion: "q" });
      san = move.san;
      chessRef.current.undo();
    } catch {
      return false;
    }
    if (san.replace(/[+#]/g, "") === item.expected_san.replace(/[+#]/g, "")) {
      chessRef.current.move(san);
      setState("correct");
      if (!failedRef.current) {
        repReview(item.node_id, 3).catch(() => {});
        setDoneCount((c) => ({ ...c, ok: c.ok + 1 }));
      }
      setTimeout(next, 900);
      return true;
    }
    if (!failedRef.current) {
      failedRef.current = true;
      repReview(item.node_id, 1).catch(() => {});
      setDoneCount((c) => ({ ...c, fail: c.fail + 1 }));
    }
    setState("wrong");
    setShake(true);
    setTimeout(() => setShake(false), 600);
    return false;
  };

  if (items == null) return null;
  if (!item) {
    return (
      <div className="mx-auto max-w-[480px] rounded-xl border border-line bg-panel px-6 py-10 text-center">
        <GraduationCap size={28} className="mx-auto text-accent" />
        <div className="mt-3 text-[17px] font-semibold">
          {doneCount.ok + doneCount.fail > 0 ? "Training abgeschlossen!" : "Nichts fällig."}
        </div>
        <div className="mt-1.5 text-[13px] text-ink3">
          {doneCount.ok + doneCount.fail > 0
            ? `${doneCount.ok} richtig · ${doneCount.fail} falsch — falsche Züge kommen in ~10 Minuten wieder.`
            : "Alle Repertoire-Züge sind gelernt. Komm später wieder oder ergänze neue Varianten."}
        </div>
        <Button primary onClick={onExit} className="mt-5">
          Zurück zum Repertoire
        </Button>
      </div>
    );
  }

  const moveNo = Math.floor(item.prompt_sans.length / 2) + 1;
  return (
    <div className="grid grid-cols-1 gap-6 min-[1000px]:grid-cols-[auto_1fr]">
      <div>
        <div className="mb-3 flex items-center justify-between text-[13px]">
          <span className="font-medium">
            {item.line || "Repertoire"} · {item.side === "white" ? "Weiß" : "Schwarz"}
          </span>
          <span className="text-ink3">
            {idx + 1} / {items.length} {item.is_new && "· neu"}
          </span>
        </div>
        <Board
          boardId="rep-train"
          fen={fen}
          width={420}
          draggable={state !== "correct"}
          onPieceDrop={tryMove}
          orientation={item.side}
          shake={shake}
        />
        <div className="mt-3 flex h-[52px] items-center">
          {state === "correct" ? (
            <div className="flex w-full items-center gap-2 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[13.5px] font-medium text-accent">
              <Check size={17} /> Richtig: {item.expected_san}
            </div>
          ) : state === "wrong" ? (
            <div className="flex w-full items-center justify-between rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5">
              <span className="text-[13.5px] text-loss">
                Der Buchzug ist <span className="font-semibold">{item.expected_san}</span>.
              </span>
              <Button
                onClick={() => {
                  chessRef.current.move(item.expected_san);
                  setState("correct");
                  setTimeout(next, 900);
                }}
              >
                Zeigen & weiter
              </Button>
            </div>
          ) : (
            <span className="text-[13px] text-ink3">
              Zug {moveNo}: Was spielst du hier als {item.side === "white" ? "Weiß" : "Schwarz"}?
            </span>
          )}
        </div>
      </div>

      <div className="flex max-w-[420px] flex-col gap-4">
        <Card title="Sitzung">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-win">{doneCount.ok} richtig</span>
            <span className="text-loss">{doneCount.fail} falsch</span>
            <span className="text-ink3">{items.length - idx} übrig</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${(idx / items.length) * 100}%` }}
            />
          </div>
        </Card>
        <Button onClick={onExit}>Training beenden</Button>
      </div>
    </div>
  );
}

// ── Demo-Ansicht (Web-Preview) ───────────────────────────────────────────────

function flatten(nodes: DemoNode[]): DemoNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}
const allDemoNodes = flatten(demoRepertoire.flatMap((r) => r.nodes));

function DemoTreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: DemoNode;
  depth: number;
  selected: string;
  onSelect: (id: string) => void;
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
        <span className="flex-1 truncate text-[13px]">{node.label}</span>
        {node.due > 0 && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
            {node.due}
          </span>
        )}
      </div>
      {open &&
        node.children?.map((c) => (
          <DemoTreeNode key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </div>
  );
}

function DemoRepertoire() {
  const [selectedId, setSelectedId] = useState("w1a");
  const node = useMemo(() => allDemoNodes.find((n) => n.id === selectedId)!, [selectedId]);
  const fen = useMemo(() => fenAfter(node.moveSeq), [node]);

  const moveText = node.moveSeq
    .map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}.${m}` : m))
    .join(" ");

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Eröffnungs-Repertoire</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            Demo-Daten — {repertoireStats.positions} Stellungen · das echte Repertoire lebt in der Desktop-App
          </p>
        </div>
        <Button primary>
          <GraduationCap size={16} />
          Training starten ({repertoireStats.dueToday} fällig)
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 min-[1240px]:grid-cols-[300px_auto_1fr]">
        <Card title="Varianten" pad={false}>
          <div className="p-2">
            {demoRepertoire.map((side) => (
              <div key={side.side} className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">
                  Als {side.side}
                </div>
                {side.nodes.map((n) => (
                  <DemoTreeNode key={n.id} node={n} depth={0} selected={selectedId} onSelect={setSelectedId} />
                ))}
              </div>
            ))}
          </div>
        </Card>

        <div>
          <Board boardId="repertoire" fen={fen} width={380} />
          <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
            {moveText}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card title={node.label}>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">Trainingserfolg</div>
                <div className="mt-1 text-[20px] font-semibold" style={{ color: node.score >= 85 ? "var(--color-win)" : node.score >= 70 ? "var(--color-gold)" : "var(--color-loss)" }}>
                  {node.score} %
                </div>
              </div>
              <div className="rounded-lg bg-panel2 px-3 py-2.5">
                <div className="text-[11.5px] text-ink3">Fällig</div>
                <div className="mt-1 text-[20px] font-semibold">
                  {node.due}
                  <span className="ml-1 text-[12px] font-normal text-ink3">Positionen</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            Demo-Ansicht: Baum-Verwaltung, FSRS-Training und Partien-Abgleich laufen in der Desktop-App.
          </div>
        </div>
      </div>
    </div>
  );
}
