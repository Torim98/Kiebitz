/**
 * Training: wirkt es?
 *
 * Der obere Teil ist neu und beantwortet die Frage, die den Study-Reiter erst
 * sinnvoll macht · verändert sich das Können, und lässt sich der Effekt einer
 * Trainingsphase in den Partien wiederfinden. Darunter steht die
 * Puzzle-Detailauswertung, die es vorher schon gab.
 */
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { useI18n, type Key } from "../../lib/i18n";
import { dateLocale, de, deInt } from "../../lib/util";
import { themeLabel, type PuzzleInsights } from "../../lib/puzzles";
import { studyMetrics, type DeepInsights, type MetricWindow } from "../../lib/insights";
import { trainingProgram, type StudyFocus, type TrainingProgram } from "../../lib/study";
import { lagComparison, weeklyLoad, type LagComparison, type WeekLoad } from "../../lib/balance";
import { cycleWindows, measureEffect } from "../../lib/effect";
import { EffectLine } from "../../components/StudyFocusCard";
import type { Finding } from "../../lib/findings";
import { Empty, FindingStrip, Kpi, MetricBar, Section, Stat, Versus } from "./parts";

function solveRate(entry: { attempts: number; solved: number }): number {
  return entry.attempts === 0 ? 0 : Math.round((entry.solved / entry.attempts) * 100);
}

/** ISO-Kalenderwoche · Beschriftung der Wochenbalken. */
function isoWeek(date: Date): number {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // Auf den Donnerstag derselben Woche schieben · dessen Jahr bestimmt nach
  // ISO 8601 die Wochennummer.
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7)
  );
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

function dayLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(dateLocale(), {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

export default function Training({
  deep,
  puzzles,
  findings,
  onAction,
  desktop = true,
}: {
  deep: DeepInsights;
  puzzles: PuzzleInsights | null;
  findings: Finding[];
  onAction: (finding: Finding) => void;
  desktop?: boolean;
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

      {desktop && <Balance />}

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

  /**
   * Trainingsbilanz: Last je Woche, die Leitkennzahl daneben, und die
   * abgeschlossenen Fokus-Zyklen mit ihrem Vorher-Nachher.
   *
   * Lädt eigenständig nach, weil `deep_insights` diese Daten nicht mitbringt
   * und der Reiter ohnehin erst beim Öffnen befüllt wird.
   */
  function Balance() {
    const [program, setProgram] = useState<TrainingProgram | null>(null);
    const [weeks, setWeeks] = useState<WeekLoad[]>([]);
    const [weekMetrics, setWeekMetrics] = useState<MetricWindow[]>([]);
    const [cycles, setCycles] = useState<{ focus: StudyFocus; windows: MetricWindow[] }[]>([]);

    useEffect(() => {
      let cancelled = false;
      trainingProgram(180)
        .then(async (next) => {
          if (cancelled) return;
          setProgram(next);
          const load = weeklyLoad(next.days);
          setWeeks(load);

          // Ein Fenster je Woche für die Verlaufskurve, plus zwei je
          // abgeschlossenem Zyklus. Beides in einem Aufruf · der Backend-Befehl
          // geht die Datenbank sonst mehrfach durch.
          const done = next.history.filter((focus) => focus.status !== "active").slice(0, 4);
          const specs = [
            ...load.map((week) => ({ from_ts: week.from_ts, to_ts: week.to_ts })),
            ...done.flatMap((focus) => {
              const { before, after } = cycleWindows(
                focus.start_ts,
                focus.cycle_days,
                focus.end_ts || focus.start_ts + focus.cycle_days * 86_400
              );
              return [before, after];
            }),
          ];
          if (specs.length === 0) return;
          const measured = await studyMetrics(specs).catch(() => [] as MetricWindow[]);
          if (cancelled || measured.length !== specs.length) return;
          setWeekMetrics(measured.slice(0, load.length));
          setCycles(
            done.map((focus, index) => ({
              focus,
              windows: measured.slice(load.length + index * 2, load.length + index * 2 + 2),
            }))
          );
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, []);

    if (!program || weeks.length === 0) return null;

    // Die Leitkennzahl der Verlaufskurve: die Patzerrate reagiert am
    // schnellsten von allem, was über Partien messbar ist.
    const metricKey = "blunders_per100";
    const rows = weeks.map((week, index) => {
      const metric = weekMetrics[index]?.metrics.find((entry) => entry.key === metricKey);
      const date = new Date(week.from_ts * 1000);
      return {
        label: `${t("ins.trWeek")}${isoWeek(date)}`,
        play: week.play,
        tactics: week.tactics,
        openings: week.openings,
        endgames: week.endgames,
        analysis: week.analysis,
        metric: metric?.n ? metric.value : null,
      };
    });
    const lag = lagComparison(weeks, weekMetrics, metricKey);

    return (
      <>
        <Section
          title={t("ins.trLoadTitle")}
          summary={t("ins.trLoadSummary")}
          disabled={weeks.length < 3}
          defaultOpen
        >
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={rows} margin={{ top: 12, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={chart.tick}
                tickLine={false}
                axisLine={{ stroke: chart.axis }}
                minTickGap={18}
              />
              <YAxis
                yAxisId="load"
                tick={chart.tick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="metric"
                orientation="right"
                tick={chart.tick}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<DarkTooltip />} cursor={barCursor} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
              {(
                [
                  ["play", chart.accent],
                  ["tactics", chart.violet],
                  ["openings", chart.gold],
                  ["endgames", chart.draw],
                  ["analysis", chart.axis],
                ] as const
              ).map(([area, color], index, list) => (
                <Bar
                  key={area}
                  yAxisId="load"
                  dataKey={area}
                  name={t(`plan.area${area[0].toUpperCase()}${area.slice(1)}` as Key)}
                  stackId="load"
                  fill={color}
                  radius={index === list.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
              <Line
                yAxisId="metric"
                type="monotone"
                dataKey="metric"
                name={t(`metric.${metricKey}` as Key)}
                stroke={chart.loss}
                strokeWidth={2}
                connectNulls
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.trLoadNote")}</p>
        </Section>

        <Section
          title={t("ins.trLagTitle")}
          summary={t("ins.trLagSummary")}
          disabled={lag == null}
          disabledNote={t("ins.trLagNeed")}
        >
          {lag && <LagPanel lag={lag} />}
        </Section>

        <Section
          title={t("ins.trCycleTitle")}
          summary={t("ins.trCycleSummary", { n: cycles.length })}
          disabled={cycles.length === 0}
          disabledNote={t("ins.trCycleNone")}
        >
          <div className="flex flex-col gap-2.5">
            {cycles.map(({ focus, windows }) => (
              <div key={focus.id} className="rounded-lg border border-line bg-panel2 px-3.5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ink">
                    {t(`plan.area${focus.area[0].toUpperCase()}${focus.area.slice(1)}` as Key)}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-ink3">
                    {t("ins.trCycleRange", {
                      from: dayLabel(focus.start_ts),
                      to: dayLabel(focus.end_ts || focus.start_ts + focus.cycle_days * 86_400),
                    })}
                  </span>
                </div>
                <div className="mt-1.5">
                  <EffectLine
                    effect={measureEffect(
                      focus.metric_key,
                      windows[0] ?? null,
                      windows[1] ?? null
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      </>
    );
  }

  function LagPanel({ lag }: { lag: LagComparison }) {
    return (
      <>
        <Versus
          leftLabel={t("ins.trLagHigh")}
          leftValue={lag.high}
          rightLabel={t("ins.trLagLow")}
          rightValue={lag.low}
          lowerIsBetter={lag.lowerIsBetter}
        />
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">
          {t("metric." + lag.metricKey as Key)} ·{" "}
          {t("ins.trAttemptsNote", { n: deInt(lag.highWeeks + lag.lowWeeks) })}
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("ins.trLagNote")}</p>
      </>
    );
  }

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
