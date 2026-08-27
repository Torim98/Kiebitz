import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Chess } from "chess.js";
import {
  Check,
  ChevronDown,
  CornerUpLeft,
  Download,
  FileUp,
  GraduationCap,
  GripVertical,
  Lightbulb,
  ListTree,
  Loader2,
  Plus,
  Share2,
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
  repReorder,
  repSetNote,
  repStats,
  type NodeGameStats,
  type RepGap,
  type RepNode,
  type RepStats,
} from "../lib/repertoire";
import { chessdbQuery, getSettings, type ChessDbResult } from "../lib/settings";
import { useTrainingSession } from "../lib/session";
import Board from "../components/Board";
import LiveEngine from "../components/LiveEngine";
import RepertoireTrainer from "../components/RepertoireTrainer";
import ShareDialog, { type ShareSubject } from "../components/ShareDialog";
import { useMobileShell } from "../components/MobileShell";
import { BOARD_WIDTH } from "../lib/boardLayout";
import { useBoardSelection } from "../lib/boardMoves";
import { Button, Card, Chip } from "../components/ui";
import { de } from "../lib/format";
import { errorMessage } from "../lib/errors";
import { replaySans } from "../lib/position";
import { isStoreCapture } from "../lib/storeCapture";
import { batchDataChanges } from "../lib/changes";
import { CoverageCard, GapsCard } from "./repertoire/RepertoireStats";

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

/** Eine laufende Ziehbewegung in der Variantenliste. */
interface DragState {
  side: "white" | "black";
  /** Reihenfolge der Seite, wie sie beim Greifen aussah. */
  keys: string[];
  from: number;
  /** Wohin die Linie fiele, wenn jetzt losgelassen wird. */
  to: number;
  dy: number;
  startY: number;
  rects: { top: number; height: number }[];
}

interface VariationLine {
  key: string;
  side: "white" | "black";
  targetId: number | string;
  name: string;
  sans: string[];
  due: number;
  nodeIds?: number[];
  hasNote?: boolean;
  hasTransposition?: boolean;
  /** Selbst gezogener Platz · 0 oder fehlend heisst "noch nie sortiert". */
  sortOrder?: number;
}

/**
 * Eine flache, tastaturbedienbare Linienliste. Der Repertoire-Baum bleibt das
 * Datenmodell, in der UI ist aber jede spielbare Variante ein lesbarer Eintrag.
 */
function VariationList({
  lines,
  selectedLineKey,
  selectedPly,
  onSelect,
  onReorder,
}: {
  lines: VariationLine[];
  selectedLineKey: string | null;
  selectedPly: number;
  onSelect: (line: VariationLine, ply: number) => void;
  /**
   * Neue Reihenfolge einer Seite · ohne den Handler gibt es keine Griffe
   * (die Demo-Liste der Web-Vorschau ist fest).
   */
  onReorder?: (side: "white" | "black", keys: string[]) => void;
}) {
  const t = useT();
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);

  /** Schlüssel einer Seite in der gerade sichtbaren Reihenfolge. */
  const keysOf = (side: "white" | "black") =>
    lines.filter((line) => line.side === side).map((line) => line.key);

  /** Eine Linie an eine andere Stelle derselben Seite setzen. */
  const commitMove = (side: "white" | "black", from: number, to: number) => {
    const keys = keysOf(side);
    if (from === to || to < 0 || to >= keys.length) return;
    const next = [...keys];
    next.splice(to, 0, ...next.splice(from, 1));
    onReorder?.(side, next);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, line: VariationLine) => {
    if (!onReorder || drag || event.button !== 0) return;
    const keys = keysOf(line.side);
    // Die Zeilenhöhen stehen fest, sobald gegriffen wird · sie unterscheiden
    // sich je nach Länge der Zugliste, deshalb wird jede einzeln gemessen.
    const rects = keys.map((key) => {
      const rect = rowRefs.current.get(key)?.getBoundingClientRect();
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 };
    });
    const from = keys.indexOf(line.key);
    if (from < 0) return;
    // Der Zeiger bleibt beim Griff, auch wenn der Finger die Zeile verlässt.
    // Fehlt die Methode (Testumgebung) oder lehnt der Browser den Zeiger ab,
    // zieht die Zeile trotzdem · nur eben ohne Fang.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ohne Zeigerfang weiterziehen */
    }
    setDrag({ side: line.side, keys, from, to: from, dy: 0, startY: event.clientY, rects });
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const pointerY = event.clientY;
    setDrag((state) => {
      if (!state) return state;
      const held = state.rects[state.from];
      const last = state.rects[state.rects.length - 1];
      // Sichtbar bleibt die Zeile zwischen erster und letzter Linie ihrer
      // Seite · sonst zieht man sie aus der scrollenden Liste heraus und sieht
      // nicht mehr, was man in der Hand hat.
      const dy = Math.max(
        state.rects[0].top - held.top,
        Math.min(last.top + last.height - (held.top + held.height), pointerY - state.startY)
      );
      // Das Ziel richtet sich nach dem Finger, nicht nach der Zeile: über
      // welcher Zeile er steht, dorthin fällt die Variante. Am oberen und
      // unteren Rand ist das der erste bzw. letzte Platz.
      let to = state.rects.length - 1;
      if (pointerY < state.rects[0].top) to = 0;
      else {
        const hit = state.rects.findIndex((rect) => pointerY < rect.top + rect.height);
        if (hit >= 0) to = hit;
      }
      return { ...state, dy, to };
    });
  };

  const endDrag = () => {
    if (!drag) return;
    commitMove(drag.side, drag.from, drag.to);
    setDrag(null);
  };

  /**
   * Der Strich, der zeigt, wo die gegriffene Variante landet. Er steht vor der
   * Zeile mit dem Index `slot`; die Zeilen selbst bleiben stehen, weil sie
   * unterschiedlich hoch sind und ein Verrutschen der ganzen Liste beim Ziehen
   * mehr verwirrt als hilft.
   */
  const dropMarker = (side: "white" | "black", slot: number) => {
    if (!drag || drag.side !== side || drag.to === drag.from) return null;
    const target = drag.to > drag.from ? drag.to + 1 : drag.to;
    if (target !== slot) return null;
    return <div aria-hidden="true" className="h-0.5 rounded-full bg-accent" />;
  };

  const selectAndFocus = (line: VariationLine, ply: number) => {
    onSelect(line, ply);
    optionRefs.current.get(line.key)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, line: VariationLine) => {
    const index = lines.findIndex((candidate) => candidate.key === line.key);
    const currentPly = selectedLineKey === line.key ? selectedPly : line.sans.length - 1;

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = lines[Math.max(0, Math.min(lines.length - 1, index + delta))];
      if (next) selectAndFocus(next, next.sans.length - 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      onSelect(line, Math.max(-1, Math.min(line.sans.length - 1, currentPly + delta)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onSelect(line, event.key === "Home" ? -1 : line.sans.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(line, line.sans.length - 1);
    }
  };

  return (
    <div>
      <div className="border-b border-line px-3 py-2 text-[11px] leading-relaxed text-ink3">
        {t("rep.variationKeys")}
      </div>
      <div
        role="listbox"
        aria-label={t("rep.variants")}
        className="max-h-[min(58vh,620px)] overflow-y-auto p-2"
      >
        {(["white", "black"] as const).map((side) => {
          const sideLines = lines.filter((line) => line.side === side);
          if (sideLines.length === 0) return null;
          return (
            <div
              key={side}
              role="group"
              aria-label={side === "white" ? t("common.asWhite") : t("common.asBlack")}
              className="mb-3 last:mb-0"
            >
              <div className="sticky top-0 z-10 bg-panel/95 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3 backdrop-blur-sm">
                {side === "white" ? t("common.asWhite") : t("common.asBlack")}
              </div>
              <div className={`space-y-1.5 ${drag ? "select-none" : ""}`}>
                {sideLines.map((line, index) => {
                  const active = selectedLineKey === line.key;
                  const globalIndex = lines.findIndex((candidate) => candidate.key === line.key);
                  const held = drag != null && drag.side === side && drag.from === index;
                  return (
                    <Fragment key={line.key}>
                      {dropMarker(side, index)}
                      <div
                        ref={(element) => {
                          if (element) rowRefs.current.set(line.key, element);
                          else rowRefs.current.delete(line.key);
                        }}
                        className={`flex items-stretch gap-1 ${held ? "relative z-10" : ""}`}
                        style={held ? { transform: `translateY(${drag.dy}px)` } : undefined}
                      >
                        <button
                          ref={(element) => {
                            if (element) optionRefs.current.set(line.key, element);
                            else optionRefs.current.delete(line.key);
                          }}
                          type="button"
                          role="option"
                          aria-selected={active}
                          aria-label={`${line.name}: ${moveText(line.sans)}`}
                          tabIndex={active || (selectedLineKey == null && globalIndex === 0) ? 0 : -1}
                          onClick={() => onSelect(line, line.sans.length - 1)}
                          onKeyDown={(event) => onKeyDown(event, line)}
                          className={`min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-accent-dim ${
                            active
                              ? "border-accent-dim bg-accent-soft text-ink"
                              : "border-line bg-panel2/60 text-ink2 hover:border-line2 hover:bg-panel2"
                          } ${held ? "shadow-lg shadow-black/40" : ""}`}
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{line.name}</span>
                            {line.hasNote && <Lightbulb aria-hidden="true" size={12} className="shrink-0 text-ink3" />}
                            {line.hasTransposition && <Shuffle aria-hidden="true" size={12} className="shrink-0 text-gold" />}
                            {line.due > 0 && (
                              <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                                {line.due}
                              </span>
                            )}
                          </span>
                          <span className="mt-1.5 flex flex-wrap gap-1 font-mono text-[11px] leading-5">
                            <span
                              className={`rounded px-1 ${active && selectedPly === -1 ? "bg-accent text-[#06251a]" : "text-ink3"}`}
                            >
                              {t("rep.startShort")}
                            </span>
                            {line.sans.map((san, ply) => (
                              <span
                                key={`${ply}:${san}`}
                                className={`rounded px-1 ${active && selectedPly === ply ? "bg-accent text-[#06251a]" : "bg-panel3/70 text-ink2"}`}
                              >
                                {ply % 2 === 0 ? `${ply / 2 + 1}.${san}` : san}
                              </span>
                            ))}
                          </span>
                        </button>
                        {/* Der Griff zieht die Variante an ihren Platz, mit der
                            Maus wie mit dem Finger; ueber die Tastatur schieben
                            ihn die Pfeiltasten um eine Position. */}
                        {onReorder && (
                          <button
                            type="button"
                            aria-label={t("rep.reorderHandle", { name: line.name })}
                            title={t("rep.reorderHandle", { name: line.name })}
                            onPointerDown={(event) => startDrag(event, line)}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                              event.preventDefault();
                              commitMove(side, index, index + (event.key === "ArrowUp" ? -1 : 1));
                            }}
                            className={`flex w-7 shrink-0 touch-none items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-accent-dim ${
                              held
                                ? "border-accent-dim bg-accent-soft text-accent"
                                : "border-line bg-panel2/60 text-ink3 hover:border-line2 hover:text-ink2"
                            }`}
                          >
                            <GripVertical aria-hidden="true" size={14} />
                          </button>
                        )}
                      </div>
                    </Fragment>
                  );
                })}
                {dropMarker(side, sideLines.length)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  // Eröffnungsbudget: gemessene Zeit im Repertoire statt 30 Sekunden je Karte.
  useTrainingSession("openings");
  const [nodes, setNodes] = useState<RepNode[]>([]);
  const [stats, setStats] = useState<RepStats | null>(null);
  const [gaps, setGaps] = useState<RepGap[] | null>(null);
  const [plies, setPlies] = useState(8);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
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

  /** Vollständige Knotenfolge von der Grundstellung bis zu diesem Zug. */
  const pathNodes = useCallback(
    (id: number | null): RepNode[] => {
      const path: RepNode[] = [];
      let cur = id;
      while (cur != null && cur !== 0) {
        const n = byId.get(cur);
        if (!n) break;
        path.push(n);
        cur = n.parent_id;
      }
      return path.reverse();
    },
    [byId]
  );

  const pathSans = useCallback(
    (id: number | null): string[] => pathNodes(id).map((node) => node.san),
    [pathNodes]
  );

  const variationLines = useMemo<VariationLine[]>(() => {
    const ordered = nodes
      // Benannte Zwischenlinien bleiben eigene Varianten (z. B. "Italian
      // Game" neben den längeren Fortsetzungen); unbenannte Pfade erscheinen
      // nur an ihrem Endpunkt.
      .filter((node) => node.name.trim() !== "" || (children.get(`${node.side}:${node.id}`) ?? []).length === 0)
      .map((endpoint) => {
        const path = pathNodes(endpoint.id);
        const ancestorName = [...path.slice(0, -1)].reverse().find((node) => node.name.trim() !== "")?.name.trim();
        return {
          key: `${endpoint.side}:${endpoint.id}`,
          side: endpoint.side,
          targetId: endpoint.id,
          name: endpoint.name.trim() || (ancestorName ? `${ancestorName} · ${moveLabel(endpoint)}` : moveLabel(endpoint)),
          sans: path.map((node) => node.san),
          nodeIds: path.map((node) => node.id),
          due: path.filter((node) => node.my_move && (node.reps === 0 || node.due_ts <= now)).length,
          hasNote: path.some((node) => node.note.trim() !== ""),
          hasTransposition: path.some((node) => twinsOf(node).length > 0),
          sortOrder: endpoint.sort_order,
        };
      });
    // Selbst gezogene Reihenfolge zuerst; was nie sortiert wurde (0), haengt
    // sich hinten an und bleibt dort in der Reihenfolge des Anlegens.
    return ordered.sort(
      (a, b) => (a.sortOrder || Number.MAX_SAFE_INTEGER) - (b.sortOrder || Number.MAX_SAFE_INTEGER)
    );
  }, [children, nodes, now, pathNodes, twinsOf]);

  /**
   * Neue Reihenfolge einer Seite speichern. Das Backend bekommt die Endpunkte
   * als Id-Liste; danach steht sie in `sort_order` und der Sync traegt sie zum
   * anderen Geraet.
   */
  const reorderLines = useCallback(
    (side: "white" | "black", keys: string[]) => {
      const byKey = new Map(variationLines.map((line) => [line.key, line]));
      const ids = keys
        .map((key) => byKey.get(key)?.targetId)
        .filter((id): id is number => typeof id === "number");
      repReorder(side, ids)
        .then(reload)
        .catch((e) => setNotice(errorMessage(e)));
    },
    [reload, variationLines]
  );

  const selectedLine = variationLines.find((line) => line.key === selectedLineKey) ?? null;
  const selectedPly = selectedLine && selectedId != null
    ? (selectedLine.nodeIds ?? []).indexOf(selectedId)
    : -1;

  const selectVariation = useCallback((line: VariationLine, ply: number) => {
    setSelectedLineKey(line.key);
    setSelectedId(ply >= 0 ? (line.nodeIds?.[ply] ?? null) : null);
  }, []);

  const selected = selectedId != null ? (byId.get(selectedId) ?? null) : null;
  const [sharing, setSharing] = useState<ShareSubject | null>(null);
  const baseSans = useMemo(() => pathSans(selectedId), [pathSans, selectedId]);
  const position = useMemo(() => replaySans(baseSans), [baseSans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

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
      await batchDataChanges(async () => {
        for (const line of flat) await repAddLine(line.side, line.name, line.sans);
      });
      reload();
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const remove = async (id: number) => {
    await repDelete(id).catch((e) => setNotice(errorMessage(e)));
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedLineKey(null);
    }
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
      <VariationList
        lines={variationLines}
        selectedLineKey={selectedLineKey}
        selectedPly={selectedPly}
        onSelect={selectVariation}
        onReorder={reorderLines}
      />
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

  /**
   * Die Variante, wie sie beim Empfänger ankommt.
   *
   * Geteilt wird die Stellung, die auf dem Brett steht, und dazu die Züge, die
   * im Buch danach kommen · eine Eröffnung ist eine Fortsetzung und keine
   * Einzelstellung. Der Name der Linie steht schon in der Überschrift, damit
   * niemand abtippt, was die Seite längst weiß.
   */
  const openShare = () => {
    const line = selectedLine ? replaySans(selectedLine.sans).moves.slice(baseSans.length) : [];
    setSharing({
      kind: "repertoire",
      fen,
      orientation: selected?.side ?? "white",
      lastMove,
      line,
      title: selectedLine?.name,
    });
  };

  const boardPane = (
    <div>
      <Board
        boardId="repertoire"
        fen={fen}
        width={BOARD_WIDTH}
        lastMove={lastMove}
        orientation={selected?.side ?? "white"}
      />
      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 py-2.5">
        <span className="min-w-0 font-mono text-[12.5px] leading-relaxed text-ink2">
          {moveText(baseSans) || t("rep.startPos")}
        </span>
        <Button onClick={openShare} className="shrink-0 px-2" title={t("sh.title")}>
          <Share2 size={14} />
        </Button>
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

      {sharing && <ShareDialog subject={sharing} onClose={() => setSharing(null)} />}
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
  const [nameEdited, setNameEdited] = useState(false);
  const [side, setSide] = useState<"white" | "black">(baseSide ?? "white");
  const [book, setBook] = useState<ChessDbResult | null>(null);
  const [twins, setTwins] = useState<RepNode[]>([]);
  const chessRef = useRef<Chess>(new Chess());

  const sans = useMemo(() => [...baseSans, ...draft], [baseSans, draft]);

  // Der große ECO-Datensatz wird erst beim Anlegen einer Variante geladen. So
  // bleibt der normale Seitenstart klein, der Name funktioniert aber offline.
  useEffect(() => {
    if (nameEdited) return;
    let stale = false;
    import("../lib/openings")
      .then(({ openingName }) => {
        if (!stale) setName(openingName(sans));
      })
      .catch(() => {
        if (!stale) setName("");
      });
    return () => {
      stale = true;
    };
  }, [nameEdited, sans]);

  useEffect(() => {
    const c = new Chess();
    for (const s of sans) c.move(s);
    chessRef.current = c;
  }, [sans]);

  const position = useMemo(() => replaySans(sans), [sans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

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

  /** Ersten Zug einer angeklickten Engine-Linie auf das Brett übernehmen. */
  const playUci = (uci: string) => {
    try {
      const move = chessRef.current.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] ?? "q",
      });
      setDraft((d) => [...d, move.san]);
    } catch {
      /* Veraltete Engine-Zeile nach einem Stellungswechsel ignorieren. */
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
          lastMove={lastMove}
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
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
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

        <LiveEngine fen={fen} demoLines={[]} onMove={playUci} />

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

function DemoRepertoire() {
  const { locale, t } = useI18n();
  const compact = useMobileShell();
  const storeCapture = isStoreCapture();
  const englishCapture = storeCapture && locale === "en";
  const [selectedId, setSelectedId] = useState("w1a");
  const [selectedPly, setSelectedPly] = useState(
    () => (allDemoNodes.find((candidate) => candidate.id === "w1a")?.moveSeq.length ?? 1) - 1
  );
  const node = useMemo(() => allDemoNodes.find((n) => n.id === selectedId)!, [selectedId]);
  const demoLines = useMemo<VariationLine[]>(
    () => demoRepertoire.flatMap((group) =>
      flatten(group.nodes).map((variation) => ({
        key: `demo:${variation.id}`,
        side: group.side === "Weiß" ? "white" : "black",
        targetId: variation.id,
        name: englishCapture ? STORE_EN_NODE_LABELS[variation.id] ?? variation.label : variation.label,
        sans: variation.moveSeq,
        due: variation.due,
      }))
    ),
    [englishCapture]
  );
  const selectDemoVariation = useCallback((line: VariationLine, ply: number) => {
    setSelectedId(String(line.targetId));
    setSelectedPly(ply);
  }, []);
  const visibleSans = useMemo(() => node.moveSeq.slice(0, selectedPly + 1), [node, selectedPly]);
  const position = useMemo(() => replaySans(visibleSans), [visibleSans]);
  const fen = position.fen;
  const lastMove = position.moves[position.moves.length - 1] ?? null;

  const treePanel = (
    <Panel compact={compact} icon={<ListTree size={14} />} title={t("rep.variants")} pad={false}>
      <VariationList
        lines={demoLines}
        selectedLineKey={`demo:${selectedId}`}
        selectedPly={selectedPly}
        onSelect={selectDemoVariation}
      />
    </Panel>
  );

  const boardPane = (
    <div>
      <Board boardId="repertoire" fen={fen} width={BOARD_WIDTH} lastMove={lastMove} />
      <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink2">
        {moveText(visibleSans) || t("rep.startPos")}
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
