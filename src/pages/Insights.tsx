import { Fragment, useEffect, useMemo, useState } from "react";
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
import { insights as demo } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
import { errorStats, type PhaseErrors } from "../lib/analysis";
import { buildInsights, type LiveInsights } from "../lib/stats";
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
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const [records, setRecords] = useState<GameRecord[] | null>(null);
  const [errors, setErrors] = useState<PhaseErrors[] | null>(null);

  useEffect(() => {
    if (backend.mode === "desktop") {
      listGames().then(setRecords).catch(() => setRecords(null));
      errorStats().then(setErrors).catch(() => setErrors(null));
    }
  }, [backend.mode]);

  const liveData: LiveInsights | null = useMemo(
    () => (records && records.length > 0 ? buildInsights(records, locale) : null),
    [records, locale]
  );
  const live = liveData !== null;

  const openings = live ? liveData.openings : demo.openings;
  const byColor = live ? liveData.byColor : demo.byColor;
  const activity = live ? liveData.activity : demo.activity;
  const accuracyTrend = live ? liveData.accuracyTrend : demo.accuracyTrend;
  const maxActivity = Math.max(1, ...activity.values.flat());

  const phaseLabel = (p: string) =>
    p === "opening"
      ? t("ins.phase.opening")
      : p === "middlegame"
        ? t("ins.phase.middlegame")
        : t("ins.phase.endgame");

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-[21px] font-semibold tracking-tight">{t("ins.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">
          {live
            ? t("ins.subtitleLive", { n: deInt(liveData.totalGames) })
            : t("ins.subtitleDemo")}
        </p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        {live ? (
          <>
            <Kpi label={t("ins.totalGames")} value={deInt(liveData.totalGames)} sub={t("ins.localDb")} />
            <Kpi label={t("ins.winRate")} value={`${de(liveData.winRate)} %`} sub={t("ins.allGames")} />
            <Kpi
              label={t("ins.avgAccuracy")}
              value={liveData.avgAccuracy != null ? `${de(liveData.avgAccuracy)} %` : "—"}
              sub={liveData.avgAccuracy != null ? t("ins.ccAnalyses") : t("ins.noAnalysisData")}
            />
            <Kpi label={t("ins.avgOppElo")} value={deInt(liveData.avgOppElo)} sub={t("ins.weightedStrength")} />
          </>
        ) : (
          <>
            <Kpi label={t("ins.totalGames")} value={deInt(demo.totalGames)} sub={t("ins.sinceJan")} />
            <Kpi label={t("ins.winRate")} value={`${de(demo.winRate)} %`} sub={t("ins.vsLastYear")} />
            <Kpi label={t("ins.avgAccuracy")} value={`${de(demo.avgAccuracy)} %`} sub={t("ins.sfDepth")} />
            <Kpi label={t("ins.playTime")} value={`${demo.hoursPlayed} h`} sub={t("ins.fullDays")} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
        <Card title={t("ins.openingsTitle")}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={openings} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 8 }} barSize={16}>
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
                        {t("ins.openingTooltip", { n: payload[0].payload.games, p: payload[0].payload.win })}
                      </div>
                    </div>
                  ) : null
                }
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
              />
              <Bar dataKey="win" radius={[0, 4, 4, 0]}>
                {openings.map((o) => (
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

        {live && (
          <Card title={t("ins.errorsTitle")}>
            {errors && errors.some((e) => e.inaccuracy + e.mistake + e.blunder > 0) ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={errors.map((e) => ({ ...e, phase: phaseLabel(e.phase) }))}
                  margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
                  barSize={22}
                  barGap={6}
                >
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
                  <Bar dataKey="inaccuracy" name={t("ins.legInaccuracies")} fill={chart.inaccuracy} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="mistake" name={t("ins.legMistakes")} fill={chart.mistake} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="blunder" name={t("ins.legBlunders")} fill={chart.blunder} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[240px] items-center justify-center px-6 text-center text-[12.5px] leading-relaxed text-ink3">
                {t("ins.noErrors")}
              </div>
            )}
          </Card>
        )}

        {live ? (
          <Card title={t("ins.oppStrengthTitle")}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={liveData.byOppStrength} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barSize={40}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="bucket" tick={{ ...chart.tick, fontSize: 11 }} tickLine={false} axisLine={{ stroke: chart.axis }} />
                <YAxis domain={[0, 100]} tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 text-[12.5px]">
                        <div className="text-ink">{payload[0].payload.bucket}</div>
                        <div className="mt-0.5 text-ink2">
                          {t("ins.openingTooltip", { n: payload[0].payload.games, p: payload[0].payload.winRate })}
                        </div>
                      </div>
                    ) : null
                  }
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                />
                <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                  {liveData.byOppStrength.map((b) => (
                    <Cell key={b.bucket} fill={b.winRate >= 50 ? chart.win : chart.loss} fillOpacity={0.85} />
                  ))}
                  <LabelList
                    dataKey="winRate"
                    position="top"
                    formatter={(v: number) => `${v} %`}
                    style={{ fill: "#b9b8ae", fontSize: 12 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        ) : (
          <Card title={t("ins.errorsDemoTitle")}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={demo.errorsByPhase} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barSize={22} barGap={6}>
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
                <Bar dataKey="inaccuracy" name={t("ins.legInaccuracies")} fill={chart.inaccuracy} radius={[4, 4, 0, 0]} />
                <Bar dataKey="mistake" name={t("ins.legMistakes")} fill={chart.mistake} radius={[4, 4, 0, 0]} />
                <Bar dataKey="blunder" name={t("ins.legBlunders")} fill={chart.blunder} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <Card title={t("ins.byColorTitle")}>
          <div className="flex flex-col gap-5 pt-2">
            {byColor.map((c) => {
              const total = c.win + c.draw + c.loss;
              if (total === 0) return null;
              return (
                <div key={c.color}>
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span className="font-medium text-ink">{c.color}</span>
                    <span className="text-ink3">
                      {t("ins.colorSummary", { n: deInt(total), p: de((c.win / total) * 100) })}
                    </span>
                  </div>
                  <div className="flex h-5 gap-0.5 overflow-hidden rounded-md">
                    {c.win > 0 && <div style={{ width: `${(c.win / total) * 100}%`, background: chart.win }} />}
                    {c.draw > 0 && <div style={{ width: `${(c.draw / total) * 100}%`, background: chart.draw }} />}
                    {c.loss > 0 && <div style={{ width: `${(c.loss / total) * 100}%`, background: chart.loss }} />}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 text-[12px] text-ink3">
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.win }} /> {t("common.win")}</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.draw }} /> {t("common.draw")}</span>
              <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: chart.loss }} /> {t("common.loss")}</span>
            </div>
            <div className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink3">
              {live
                ? liveData.whiteAdvantagePts >= 0
                  ? t("ins.whiteBetter", { p: de(Math.abs(liveData.whiteAdvantagePts)) })
                  : t("ins.blackBetter", { p: de(Math.abs(liveData.whiteAdvantagePts)) })
                : t("ins.demoColorNote")}
            </div>
          </div>
        </Card>

        <Card title={live ? t("ins.accuracyTitleLive") : t("ins.accuracyTitleDemo")}>
          {accuracyTrend.length >= 2 ? (
            <ResponsiveContainer width="100%" height={228}>
              <LineChart data={accuracyTrend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
                <YAxis domain={live ? ["auto", "auto"] : [76, 86]} tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} cursor={{ stroke: chart.axis }} />
                <Line
                  type="monotone"
                  dataKey="acc"
                  name={t("ins.accuracySeries")}
                  stroke={chart.accent}
                  strokeWidth={2}
                  dot={accuracyTrend.length < 8}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#171716" }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[228px] items-center justify-center text-[12.5px] text-ink3">
              {t("ins.tooFewData")}
            </div>
          )}
        </Card>

        <Card title={t("ins.activityTitle")} className="min-[1000px]:col-span-2">
          <div className="flex flex-col gap-4 min-[700px]:flex-row">
            <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `44px repeat(${activity.slots.length}, 1fr)` }}>
              <div />
              {activity.slots.map((s) => (
                <div key={s} className="pb-1 text-center text-[11px] text-ink3">{s} {t("ins.oclock")}</div>
              ))}
              {activity.days.map((d, di) => (
                <Fragment key={d}>
                  <div className="flex items-center text-[11.5px] text-ink3">{d}</div>
                  {activity.values[di].map((v, si) => (
                    <div
                      key={`${d}-${si}`}
                      title={t("ins.activityCell", { d, s: activity.slots[si], n: v })}
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
            <div className="border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink3 min-[700px]:w-56 min-[700px]:shrink-0 min-[700px]:border-l min-[700px]:border-t-0 min-[700px]:pl-4 min-[700px]:pt-0">
              {live
                ? liveData.topSlot
                  ? t("ins.topSlot", { label: liveData.topSlot.label, n: liveData.topSlot.games })
                  : t("ins.noTimeData")
                : t("ins.demoActivityNote")}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
