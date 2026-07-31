/**
 * Training: wirkt es?
 *
 * Der obere Teil ist neu und beantwortet die Frage, die den Study-Reiter erst
 * sinnvoll macht · verändert sich das Können, und lässt sich der Effekt einer
 * Trainingsphase in den Partien wiederfinden. Darunter steht die
 * Puzzle-Detailauswertung, die es vorher schon gab.
 */
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { barCursor, chart, DarkTooltip } from "../../components/chartTheme";
import { useMobileShell } from "../../components/MobileShell";
import { useI18n } from "../../lib/i18n";
import { dateLocale, de, deInt } from "../../lib/util";
import { themeLabel, type PuzzleInsights } from "../../lib/puzzles";
import type { DeepInsights } from "../../lib/insights";
import type { Finding } from "../../lib/findings";
import { Empty, FindingStrip, Kpi, MetricBar, Section, Stat, Versus } from "./parts";

function solveRate(entry: { attempts: number; solved: number }): number {
  return entry.attempts === 0 ? 0 : Math.round((entry.solved / entry.attempts) * 100);
}

export default function Training({
  deep,
  puzzles,
  findings,
  onAction,
}: {
  deep: DeepInsights;
  puzzles: PuzzleInsights | null;
  findings: Finding[];
  onAction: (finding: Finding) => void;
}) {
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const [themesOpen, setThemesOpen] = useState(false);
  const { progress } = deep;

  const monthData = progress.months.map((month) => ({
    ...month,
    label: month.month.slice(5) + "/" + month.month.slice(2, 4),
  }));

  return (
    <div className="space-y-4">
      <FindingStrip findings={findings} onAction={onAction} />

      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi
          label={t("ins.trAccuracyTrend")}
          value={
            progress.accuracy_delta == null
              ? "—"
              : `${progress.accuracy_delta > 0 ? "+" : ""}${de(progress.accuracy_delta)}`
          }
          sub={t("ins.trAccuracyTrendSub")}
          tone={
            progress.accuracy_delta == null
              ? undefined
              : progress.accuracy_delta > 0
                ? "good"
                : progress.accuracy_delta < 0
                  ? "bad"
                  : undefined
          }
        />
        <Kpi
          label={t("ins.trRatingTrend")}
          value={
            progress.rating_delta == null
              ? "—"
              : `${progress.rating_delta > 0 ? "+" : ""}${deInt(progress.rating_delta)}`
          }
          sub={t("ins.trRatingTrendSub")}
          tone={
            progress.rating_delta == null
              ? undefined
              : progress.rating_delta > 0
                ? "good"
                : progress.rating_delta < 0
                  ? "bad"
                  : undefined
          }
        />
        <Kpi
          label={t("ins.pzRating")}
          value={puzzles ? deInt(puzzles.personal_rating) : "—"}
          sub={t("ins.pzRatingSub")}
        />
        <Kpi
          label={t("ins.pzSolveRate")}
          value={puzzles ? `${solveRate(puzzles)} %` : "—"}
          sub={
            puzzles
              ? t("ins.pzSolveRateSub", { s: deInt(puzzles.solved), n: deInt(puzzles.attempts) })
              : t("ins.pzNoAttempts")
          }
        />
      </div>

      <Section
        title={t("ins.trSkillTitle")}
        summary={t("ins.trSkillSummary")}
        disabled={monthData.length < 3}
        defaultOpen
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={monthData} margin={{ top: 12, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={18} />
            <YAxis
              yAxisId="accuracy"
              domain={["dataMin - 3", "dataMax + 3"]}
              tick={chart.tick}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="rating"
              orientation="right"
              domain={["dataMin - 40", "dataMax + 40"]}
              tick={chart.tick}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<DarkTooltip />} />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
            <Line
              yAxisId="accuracy"
              type="monotone"
              dataKey="accuracy"
              name={t("ins.avgAccuracy")}
              stroke={chart.accent}
              strokeWidth={2}
              connectNulls
              dot={false}
            />
            <Line
              yAxisId="rating"
              type="monotone"
              dataKey="rating"
              name={t("ins.fmtRating")}
              stroke={chart.gold}
              strokeWidth={2}
              connectNulls
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.trSkillNote")}</p>
      </Section>

      <Section
        title={t("ins.trVolumeTitle")}
        summary={t("ins.trVolumeSummary")}
        disabled={monthData.length < 3}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthData} margin={{ top: 12, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={18} />
            <YAxis yAxisId="left" tick={chart.tick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tick={chart.tick} tickLine={false} axisLine={false} />
            <Tooltip content={<DarkTooltip />} cursor={barCursor} />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
            <Bar
              yAxisId="left"
              dataKey="puzzle_attempts"
              name={t("ins.pzAttempts")}
              fill={chart.violet}
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="blunders_per_100"
              name={t("ins.fmtBlunders")}
              stroke={chart.loss}
              strokeWidth={2}
              connectNulls
              dot={false}
            />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.trVolumeNote")}</p>
      </Section>

      <Section
        title={t("ins.trEffectTitle")}
        summary={t("ins.trEffectSummary")}
        disabled={progress.themes.length === 0 && progress.rep_effect.after_games === 0}
        disabledNote={t("ins.trEffectNeed")}
      >
        <div className="space-y-5">
          {progress.themes.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] text-ink3">{t("ins.trThemeCurve")}</div>
              <div className="space-y-3">
                {progress.themes.slice(0, 8).map((theme) => (
                  <MetricBar
                    key={theme.theme}
                    label={themeLabel(theme.theme, locale)}
                    note={t("ins.trThemeNote", {
                      e: de(theme.early_pct),
                      l: de(theme.late_pct),
                      n: deInt(theme.attempts),
                    })}
                    value={theme.late_pct}
                    good={60}
                    bad={45}
                  />
                ))}
              </div>
            </div>
          )}
          {progress.rep_effect.before_games > 0 && progress.rep_effect.after_games > 0 && (
            <div>
              <div className="mb-2 text-[12px] text-ink3">{t("ins.trRepEffect")}</div>
              <Versus
                leftLabel={t("ins.trBefore", { n: deInt(progress.rep_effect.before_games) })}
                leftValue={progress.rep_effect.before_score}
                rightLabel={t("ins.trAfter", { n: deInt(progress.rep_effect.after_games) })}
                rightValue={progress.rep_effect.after_score}
                unit=" %"
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("ins.trRepEffectNote")}</p>
            </div>
          )}
        </div>
      </Section>

      {puzzles && puzzles.attempts > 0 ? (
        <PuzzleSections data={puzzles} themesOpen={themesOpen} setThemesOpen={setThemesOpen} mobile={mobile} />
      ) : (
        <Section title={t("ins.tabPuzzles")} disabled disabledNote={t("ins.pzNoAttempts")}>
          <div />
        </Section>
      )}
    </div>
  );

  function PuzzleSections({
    data,
    themesOpen,
    setThemesOpen,
    mobile,
  }: {
    data: PuzzleInsights;
    themesOpen: boolean;
    setThemesOpen: (open: boolean) => void;
    mobile: boolean;
  }) {
    const timeline = data.timeline.map((point) => ({
      ...point,
      failed: point.attempts - point.solved,
      label: new Date(point.day_ts * 1000).toLocaleDateString(dateLocale(), {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }),
    }));
    const reliable = data.themes.filter((theme) => theme.attempts >= 5);
    const weakest = [...reliable].sort((a, b) => solveRate(a) - solveRate(b)).slice(0, 5);
    const strongest = [...reliable].sort((a, b) => solveRate(b) - solveRate(a)).slice(0, 5);
    const activeHours = data.by_hour.filter((slot) => slot.attempts > 0);

    return (
      <>
        <Section
          title={t("ins.pzRatingTrend")}
          summary={t("ins.trPuzzleSummary", {
            r: deInt(data.personal_rating),
            b: deInt(data.best_run),
          })}
        >
          <div className="grid gap-4 min-[950px]:grid-cols-2">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={timeline} margin={{ top: 12, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={24} />
                <YAxis domain={["dataMin - 40", "dataMax + 40"]} tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} />
                <Line type="monotone" dataKey="rating" name={t("ins.pzRating")} stroke={chart.accent} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={timeline} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={24} />
                <YAxis tick={chart.tick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<DarkTooltip />} cursor={barCursor} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="solved" name={t("ins.pzSolved")} stackId="a" fill={chart.win} />
                <Bar dataKey="failed" name={t("ins.pzFailed")} stackId="a" fill={chart.loss} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
            <Stat label={t("ins.pzHardest")} value={deInt(data.avg_solved_rating)} hint={t("ins.pzHardestSub", { n: deInt(data.avg_puzzle_rating) })} />
            <Stat label={t("ins.pzRun")} value={deInt(data.best_run)} hint={t("ins.pzRunSub", { n: deInt(data.current_run) })} />
            <Stat label={t("ins.pzAttempts")} value={deInt(data.attempts)} hint={t("ins.pzSolvedOfAttempts", { s: deInt(data.solved), n: deInt(data.attempts) })} />
            <Stat label={t("ins.pzSolveRate")} value={`${solveRate(data)} %`} hint={t("ins.pzRatingSub")} />
          </div>
        </Section>

        <Section title={t("ins.pzWeakThemes")} summary={t("ins.trWeakSummary", { n: weakest.length })}>
          <div className="space-y-4">
            {weakest.length > 0 ? (
              weakest.map((theme) => (
                <MetricBar
                  key={theme.theme}
                  label={themeLabel(theme.theme, locale)}
                  note={t("ins.trAttemptsNote", { n: deInt(theme.attempts) })}
                  value={solveRate(theme)}
                  good={60}
                  bad={45}
                />
              ))
            ) : (
              <Empty text={t("ins.pzThemesTooFew")} />
            )}
            {strongest.length > 0 && (
              <div className="border-t border-line pt-3 text-[12px] text-ink3">
                {t("ins.pzStrongThemes")}{" "}
                <span className="text-ink2">
                  {strongest.map((theme) => `${themeLabel(theme.theme, locale)} ${solveRate(theme)} %`).join(" · ")}
                </span>
              </div>
            )}
          </div>
        </Section>

        <Section title={t("ins.pzByDifficulty")} summary={t("ins.pzByDifficultyNote")}>
          <div className="space-y-4">
            {data.by_rating.map((bucket) => (
              <MetricBar
                key={bucket.key}
                label={`${deInt(bucket.key)}–${deInt(bucket.key + 399)}`}
                note={t("ins.trAttemptsNote", { n: deInt(bucket.attempts) })}
                value={solveRate(bucket)}
                good={60}
                bad={45}
              />
            ))}
          </div>
        </Section>

        <Section title={t("ins.pzByHour")} summary={t("ins.pzByHourNote")} disabled={activeHours.length === 0}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={activeHours.map((slot) => ({ ...slot, label: `${slot.key}`, rate: solveRate(slot) }))}
              margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
            >
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
              <YAxis domain={[0, 100]} tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip />} cursor={barCursor} />
              <Bar dataKey="rate" name={t("ins.pzSolveRate")} radius={[4, 4, 0, 0]}>
                {activeHours.map((slot) => (
                  <Cell
                    key={slot.key}
                    fill={solveRate(slot) >= 60 ? chart.win : solveRate(slot) >= 45 ? chart.draw : chart.loss}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title={t("ins.pzThemeTable")} summary={t("ins.trThemeTableSummary", { n: data.themes.length })}>
          <button
            type="button"
            onClick={() => setThemesOpen(!themesOpen)}
            className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] text-ink3 transition-colors hover:text-ink"
          >
            {t(themesOpen ? "ins.collapse" : "ins.expand", { n: data.themes.length })}
          </button>
          {themesOpen &&
            (mobile ? (
              <div className="-mx-4">
                {data.themes.map((theme) => (
                  <div key={theme.theme} className="border-b border-line/70 px-4 py-2.5 last:border-0">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                        {themeLabel(theme.theme, locale)}
                      </span>
                      <span
                        className={`shrink-0 text-[12.5px] font-medium tabular-nums ${
                          solveRate(theme) >= 60 ? "text-win" : solveRate(theme) < 45 ? "text-loss" : "text-ink2"
                        }`}
                      >
                        {solveRate(theme)} %
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] tabular-nums text-ink3">
                      {t("ins.pzSolvedOfAttempts", { s: deInt(theme.solved), n: deInt(theme.attempts) })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left">
                  <thead className="border-b border-line bg-panel2 text-[10.5px] uppercase tracking-wide text-ink3">
                    <tr>
                      <th className="px-4 py-2.5">{t("ins.pzTheme")}</th>
                      <th className="px-3 py-2.5 text-right">{t("ins.pzAttempts")}</th>
                      <th className="px-3 py-2.5 text-right">{t("ins.pzSolved")}</th>
                      <th className="px-4 py-2.5 text-right">{t("ins.pzSolveRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.themes.map((theme) => (
                      <tr key={theme.theme} className="border-b border-line/70 last:border-0">
                        <td className="max-w-[280px] truncate px-4 py-2.5 text-[12.5px] text-ink">
                          {themeLabel(theme.theme, locale)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                          {deInt(theme.attempts)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                          {deInt(theme.solved)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right text-[12px] font-medium tabular-nums ${
                            solveRate(theme) >= 60 ? "text-win" : solveRate(theme) < 45 ? "text-loss" : "text-ink2"
                          }`}
                        >
                          {solveRate(theme)} %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </Section>
      </>
    );
  }
}
