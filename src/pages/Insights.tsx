import { Fragment } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { insights } from "../data/demo";
import { Card } from "../components/ui";
import { chart, DarkTooltip } from "../components/chartTheme";
import { de, deInt } from "../lib/util";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[12px] text-ink3">{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-ink3">{sub}</div>}
    </div>
  );
}

export default function Insights() {
  const maxActivity = Math.max(...insights.activity.values.flat());

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-[21px] font-semibold tracking-tight">Insights</h1>
        <p className="mt-0.5 text-[13px] text-ink3">
          Datenbankweite Analyse über alle {deInt(insights.totalGames)} Partien · chess.com + lichess kombiniert
        </p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        <Kpi label="Partien gesamt" value={deInt(insights.totalGames)} sub="seit Januar 2024" />
        <Kpi label="Siegquote" value={`${de(insights.winRate)} %`} sub="+1,8 Punkte ggü. Vorjahr" />
        <Kpi label="Ø Genauigkeit" value={`${de(insights.avgAccuracy)} %`} sub="Stockfish-Analyse, Tiefe 20" />
        <Kpi label="Spielzeit" value={`${insights.hoursPlayed} h`} sub="≈ 13 volle Tage am Brett" />
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
        <Card title="Siegquote nach Eröffnung · Top 6 nach Häufigkeit">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={insights.openings} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 8 }} barSize={16}>
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="name"
                width={168}
                tick={{ ...chart.tick, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 text-[12.5px]">
                      <div className="text-ink">{payload[0].payload.name}</div>
                      <div className="mt-0.5 text-ink2">
                        {payload[0].payload.games} Partien · {payload[0].payload.win} % Siege
                      </div>
                    </div>
                  ) : null
                }
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
              />
              <Bar dataKey="win" radius={[0, 4, 4, 0]}>
                {insights.openings.map((o) => (
                  <Cell key={o.name} fill={o.win >= 50 ? chart.win : chart.loss} fillOpacity={0.85} />
                ))}
                <LabelList
                  dataKey="win"
                  position="right"
                  formatter={(v: number) => `${v} %`}
                  style={{ fill: "#b9b8ae", fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Fehler nach Spielphase · alle analysierten Partien">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={insights.errorsByPhase} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barSize={22} barGap={6}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="phase" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
              <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="circle"
                iconSize={8}
                formatter={(v) => <span className="text-[12px] text-ink2">{v}</span>}
              />
              <Bar dataKey="inaccuracy" name="Ungenauigkeiten" fill={chart.inaccuracy} radius={[4, 4, 0, 0]} />
              <Bar dataKey="mistake" name="Fehler" fill={chart.mistake} radius={[4, 4, 0, 0]} />
              <Bar dataKey="blunder" name="Patzer" fill={chart.blunder} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Ergebnisse nach Farbe">
          <div className="flex flex-col gap-5 pt-2">
            {insights.byColor.map((c) => {
              const total = c.win + c.draw + c.loss;
              return (
                <div key={c.color}>
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span className="font-medium text-ink">{c.color}</span>
                    <span className="text-ink3">{deInt(total)} Partien · {de((c.win / total) * 100)} % Siege</span>
                  </div>
                  <div className="flex h-5 gap-0.5 overflow-hidden rounded-md">
                    <div style={{ width: `${(c.win / total) * 100}%`, background: chart.win }} />
                    <div style={{ width: `${(c.draw / total) * 100}%`, background: chart.draw }} />
                    <div style={{ width: `${(c.loss / total) * 100}%`, background: chart.loss }} />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 text-[12px] text-ink3">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.win }} /> Sieg</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.draw }} /> Remis</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.loss }} /> Niederlage</span>
            </div>
            <div className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink3">
              Mit Weiß punktest du <span className="text-ink2">4,1 Punkte</span> besser — dein
              1.e4-Repertoire trägt. Als Schwarz kosten dich vor allem{" "}
              <span className="text-ink2">Londoner-Aufbauten</span> Punkte.
            </div>
          </div>
        </Card>

        <Card title="Genauigkeit · 12 Monate">
          <ResponsiveContainer width="100%" height={228}>
            <LineChart data={insights.accuracyTrend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
              <YAxis domain={[76, 86]} tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip />} cursor={{ stroke: chart.axis }} />
              <Line
                type="monotone"
                dataKey="acc"
                name="Ø Genauigkeit %"
                stroke={chart.accent}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#171716" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Aktivität · Partien nach Wochentag und Uhrzeit" className="min-[1000px]:col-span-2">
          <div className="flex gap-4">
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `44px repeat(${insights.activity.slots.length}, 1fr)` }}>
              <div />
              {insights.activity.slots.map((s) => (
                <div key={s} className="pb-1 text-center text-[11px] text-ink3">{s} Uhr</div>
              ))}
              {insights.activity.days.map((d, di) => (
                <Fragment key={d}>
                  <div className="flex items-center text-[11.5px] text-ink3">{d}</div>
                  {insights.activity.values[di].map((v, si) => (
                    <div
                      key={`${d}-${si}`}
                      title={`${d}, ${insights.activity.slots[si]} Uhr: ${v} Partien`}
                      className="flex h-9 items-center justify-center rounded-md text-[11px]"
                      style={{
                        background: v === 0 ? "var(--color-panel2)" : `rgba(34,192,138,${0.12 + (v / maxActivity) * 0.75})`,
                        color: v / maxActivity > 0.55 ? "#06251a" : "var(--color-ink3)",
                      }}
                    >
                      {v > 0 ? v : ""}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
            <div className="w-56 shrink-0 border-l border-line pl-4 text-[12.5px] leading-relaxed text-ink3">
              Deine beste Zeit: <span className="text-ink2">Samstagabend</span> (58 % Siege). Nach
              23 Uhr fällt deine Genauigkeit um <span className="text-loss">−6,2 Punkte</span> —
              Tilt-Gefahr.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
