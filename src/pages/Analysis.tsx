import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Cpu } from "lucide-react";
import { featuredGame } from "../data/demo";
import Board from "../components/Board";
import { Button, Card } from "../components/ui";
import { evalLabel, fenAfter, nagColor, winProb } from "../lib/util";

const sans = featuredGame.moves.map((m) => m.san);

export default function Analysis() {
  const [ply, setPly] = useState(featuredGame.moves.length);

  const fen = useMemo(() => fenAfter(sans, ply), [ply]);
  const currentEval = ply === 0 ? 20 : featuredGame.moves[ply - 1].eval;
  const currentMove = ply > 0 ? featuredGame.moves[ply - 1] : null;
  const whitePct = winProb(currentEval);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setPly((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight") setPly((p) => Math.min(sans.length, p + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const evalSeries = featuredGame.moves.map((m, i) => ({
    ply: i + 1,
    eval: Math.max(-600, Math.min(600, m.eval)) / 100,
  }));

  const s = featuredGame.summary;

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">Analyse</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {featuredGame.white} vs. {featuredGame.black} · {featuredGame.event} · {featuredGame.result}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] text-ink2">
          <Cpu size={14} className="text-accent" />
          {featuredGame.engine}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 min-[1240px]:grid-cols-[auto_1fr_300px]">
        {/* Brett + Eval-Bar */}
        <div className="flex gap-3">
          <div className="flex w-5 flex-col overflow-hidden rounded-md border border-line" style={{ height: 400 }}>
            <div className="w-full" style={{ height: `${100 - whitePct}%`, background: "#3a3a37", transition: "height 0.3s" }} />
            <div className="w-full bg-[#e6e3d3]" style={{ height: `${whitePct}%`, transition: "height 0.3s" }} />
          </div>
          <div>
            <Board boardId="analysis" fen={fen} width={400} />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                <Button onClick={() => setPly(0)}><ChevronFirst size={15} /></Button>
                <Button onClick={() => setPly((p) => Math.max(0, p - 1))}><ChevronLeft size={15} /></Button>
                <Button onClick={() => setPly((p) => Math.min(sans.length, p + 1))}><ChevronRight size={15} /></Button>
                <Button onClick={() => setPly(sans.length)}><ChevronLast size={15} /></Button>
              </div>
              <div className="text-[15px] font-semibold tabular-nums" style={{ color: currentEval >= 0 ? "var(--color-ink)" : "var(--color-ink2)" }}>
                {evalLabel(currentEval)}
              </div>
            </div>
          </div>
        </div>

        {/* Zugliste + Eval-Graph */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Partie" pad={false} className="flex-1">
            <div className="max-h-[290px] overflow-y-auto p-3">
              <div className="flex flex-wrap gap-x-1 gap-y-1.5 text-[13.5px] leading-relaxed">
                {featuredGame.moves.map((m, i) => (
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
                <span className="ml-1 self-center text-[12.5px] text-ink3">1–0</span>
              </div>
              {currentMove?.comment && (
                <div className="mt-3 rounded-lg border-l-2 bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink2"
                  style={{ borderColor: currentMove.nag ? nagColor[currentMove.nag] : "var(--color-accent)" }}>
                  <span className="font-medium" style={{ color: currentMove.nag ? nagColor[currentMove.nag] : "var(--color-accent)" }}>
                    {Math.ceil(ply / 2)}.{ply % 2 === 0 ? ".." : ""} {currentMove.san}{currentMove.nag}
                  </span>{" "}
                  {currentMove.comment}
                </div>
              )}
            </div>
          </Card>

          <Card title="Bewertungsverlauf" pad={false}>
            <div className="px-2 pb-1 pt-2">
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
                          Zug {Math.ceil(Number(payload[0].payload.ply) / 2)} · {evalLabel(Number(payload[0].value) * 100)}
                        </div>
                      ) : null
                    }
                  />
                  <Area type="monotone" dataKey="eval" stroke="#22c08a" strokeWidth={2}
                    fill="#22c08a" fillOpacity={0.12} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Engine-Panel */}
        <div className="flex flex-col gap-4">
          <Card title="Engine-Varianten">
            <div className="flex flex-col gap-2.5">
              {featuredGame.pvLines.map((l, i) => (
                <div key={i} className="rounded-lg border border-line bg-panel2 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-accent">{l.eval}</span>
                    <span className="text-[11px] text-ink3">Tiefe {l.depth}</span>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-ink2">{l.line}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Auto-Annotation">
            <ul className="flex flex-col gap-2 text-[13px]">
              <li className="flex justify-between">
                <span style={{ color: nagColor["!"] }}>! Starke Züge</span>
                <span className="font-medium">{s.good}</span>
              </li>
              <li className="flex justify-between">
                <span style={{ color: nagColor["?!"] }}>?! Ungenauigkeiten</span>
                <span className="font-medium">{s.inaccuracy}</span>
              </li>
              <li className="flex justify-between">
                <span style={{ color: nagColor["?"] }}>? Fehler</span>
                <span className="font-medium">{s.mistake}</span>
              </li>
              <li className="flex justify-between">
                <span style={{ color: nagColor["??"] }}>?? Patzer</span>
                <span className="font-medium">{s.blunder}</span>
              </li>
            </ul>
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
              Ø Centipawn-Verlust: <span className="text-ink2">Weiß {s.acplWhite}</span> ·{" "}
              <span className="text-ink2">Schwarz {s.acplBlack}</span>
            </div>
          </Card>

          <div className="rounded-xl border border-dashed border-line2 px-4 py-3 text-[12px] leading-relaxed text-ink3">
            Tipp: Mit ← → durch die Partie blättern. Klick auf einen Zug springt zur Stellung.
          </div>
        </div>
      </div>
    </div>
  );
}
