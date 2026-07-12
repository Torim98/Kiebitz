import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GraduationCap, Plus } from "lucide-react";
import { repertoire, repertoireStats, type RepNode } from "../data/demo";
import Board from "../components/Board";
import { Button, Card } from "../components/ui";
import { fenAfter } from "../lib/util";

function flatten(nodes: RepNode[]): RepNode[] {
  return nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
}
const allNodes = flatten(repertoire.flatMap((r) => r.nodes));

function TreeNode({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: RepNode;
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
          <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </div>
  );
}

export default function Repertoire() {
  const [selectedId, setSelectedId] = useState("w1a");
  const node = useMemo(() => allNodes.find((n) => n.id === selectedId)!, [selectedId]);
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
            {repertoireStats.positions} Stellungen · Abdeckung {repertoireStats.coverage} % deiner letzten 50 Partien bis Zug 8
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
            {repertoire.map((side) => (
              <div key={side.side} className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink3">
                  Als {side.side}
                </div>
                {side.nodes.map((n) => (
                  <TreeNode key={n.id} node={n} depth={0} selected={selectedId} onSelect={setSelectedId} />
                ))}
              </div>
            ))}
            <button className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 px-3 py-2 text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent">
              <Plus size={14} /> Variante hinzufügen
            </button>
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
            <div className="mt-3 text-[12.5px] leading-relaxed text-ink3">
              FSRS-Wiederholung: nächste Abfrage{" "}
              <span className="text-ink2">{node.due > 0 ? "heute" : "in 3 Tagen"}</span> · Stabilität steigt mit
              jeder korrekten Antwort.
            </div>
          </Card>

          <Card title="Abgleich mit deinen Partien">
            <ul className="flex flex-col gap-2.5 text-[13px] leading-relaxed">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-win" />
                <span className="text-ink2">
                  In <span className="text-ink">23 Partien</span> gespielt · 61 % Punkte
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                <span className="text-ink2">
                  <span className="text-ink">12× vom Buch abgewichen</span> — am häufigsten bei Zug 6 (…h6 statt …d6)
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-loss" />
                <span className="text-ink2">
                  Schwächste Fortsetzung: <span className="text-ink">5.d3 O-O 6.Lg5</span> (33 % aus 6 Partien)
                </span>
              </li>
            </ul>
          </Card>

          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            Im Training zeigt Kiebitz die Stellung — du spielst den Repertoire-Zug auf dem Brett. Richtige
            Antworten verlängern das Wiederholungsintervall (FSRS).
          </div>
        </div>
      </div>
    </div>
  );
}
