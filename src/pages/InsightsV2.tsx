import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Gauge,
  Puzzle as PuzzleIcon,
  ShieldCheck,
  Stethoscope,
  Target,
  TrendingUp,
} from "lucide-react";
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
import { Card } from "../components/ui";
import { barCursor, chart, DarkTooltip } from "../components/chartTheme";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
import { errorStats, type PhaseErrors } from "../lib/analysis";
import { puzzleInsights, themeLabel, type PuzzleInsights } from "../lib/puzzles";
import { buildInsights, type LiveInsights } from "../lib/stats";
import { dateLocale, de, deInt } from "../lib/util";

type InsightTab = "overview" | "performance" | "openings" | "patterns" | "puzzles";

const DEMO_OPENINGS = ["Italian Game", "Sicilian Defense", "Queen's Gambit", "Caro-Kann Defense", "London System"];
const DEMO_RECORDS: GameRecord[] = Array.from({ length: 96 }, (_, index) => {
  const playedTs = Math.floor(Date.now() / 1000) - (95 - index) * 3 * 86_400;
  const result = index % 7 < 3 ? "win" : index % 7 < 5 ? "loss" : "draw";
  const color = index % 2 === 0 ? "white" : "black";
  return {
    id: index + 1,
    source: index % 3 === 0 ? "lichess" : "chess.com",
    source_id: `demo-${index}`,
    url: "",
    played_at: new Date(playedTs * 1000).toISOString().slice(0, 10),
    played_ts: playedTs,
    time_class: index % 4 === 0 ? "blitz" : "rapid",
    color,
    opponent: `Opponent ${index + 1}`,
    opp_elo: 1380 + index % 240,
    my_elo: 1460 + Math.floor(index / 8),
    result,
    opening: DEMO_OPENINGS[index % DEMO_OPENINGS.length],
    eco: "",
    moves_count: 16 + index % 38,
    accuracy: 72 + index % 19,
    accuracy_opening: 78 + index % 14,
    accuracy_middlegame: 70 + index % 20,
    accuracy_endgame: index % 3 === 0 ? 74 + index % 16 : null,
    moves: "",
    note: "",
    tags: [],
    analyzed: index % 8 !== 0,
  };
});

const DEMO_ERRORS: PhaseErrors[] = [
  { phase: "opening", inaccuracy: 18, mistake: 7, blunder: 3 },
  { phase: "middlegame", inaccuracy: 29, mistake: 14, blunder: 8 },
  { phase: "endgame", inaccuracy: 12, mistake: 9, blunder: 5 },
];

const TAB_KEYS: { id: InsightTab; key: Key; icon: typeof Activity }[] = [
  { id: "overview", key: "ins.tabOverview", icon: Gauge },
  { id: "performance", key: "ins.tabPerformance", icon: BarChart3 },
  { id: "openings", key: "ins.tabOpenings", icon: BookOpen },
  { id: "patterns", key: "ins.tabPatterns", icon: CalendarClock },
  { id: "puzzles", key: "ins.tabPuzzles", icon: PuzzleIcon },
];

/** Web-Preview: plausible Puzzle-Zahlen, damit der Reiter etwas zeigt. */
function demoPuzzleInsights(): PuzzleInsights {
  const today = Math.floor(Date.now() / 1000 / 86_400);
  const themes = [
    ["fork", 64, 47],
    ["pin", 51, 33],
    ["backRankMate", 38, 31],
    ["skewer", 30, 17],
    ["discoveredAttack", 27, 14],
    ["hangingPiece", 24, 20],
    ["deflection", 19, 8],
  ] as const;
  return {
    personal_rating: 1568,
    attempts: 312,
    solved: 214,
    avg_puzzle_rating: 1520,
    avg_solved_rating: 1462,
    best_run: 11,
    current_run: 3,
    themes: themes.map(([theme, attempts, solved]) => ({ theme, attempts, solved })),
    by_rating: [800, 1200, 1600, 2000].map((key, index) => ({
      key,
      attempts: [46, 118, 106, 42][index],
      solved: [42, 92, 63, 17][index],
    })),
    by_weekday: [...Array(7)].map((_, key) => ({
      key,
      attempts: [58, 41, 47, 39, 33, 52, 42][key],
      solved: [41, 27, 33, 26, 19, 38, 30][key],
    })),
    by_hour: [...Array(24)].map((_, key) => {
      const attempts = key >= 7 && key <= 22 ? 8 + ((key * 7) % 17) : 1;
      return { key, attempts, solved: Math.round(attempts * (0.45 + ((key * 3) % 9) / 20)) };
    }),
    timeline: [...Array(30)].map((_, index) => ({
      day_ts: (today - 29 + index) * 86_400,
      attempts: index % 4 === 0 ? 0 : 4 + ((index * 3) % 9),
      solved: index % 4 === 0 ? 0 : 2 + ((index * 2) % 6),
      rating: 1480 + index * 3 + ((index * 7) % 11),
    })),
  };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[11.5px] text-ink3">{label}</div>
      <div className="mt-1.5 text-[25px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-ink3">{sub}</div>
    </div>
  );
}

function MetricBar({ label, games, score, accuracy, unit }: {
  label: string;
  games: number;
  score: number;
  accuracy: number | null;
  /** Eigene Einheit statt „Partien“ (z. B. Puzzle-Versuche). */
  unit?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[minmax(105px,1fr)_2fr_52px] items-center gap-3">
      <div className="min-w-0">
        <div className="truncate text-[12px] text-ink2">{label}</div>
        <div className="text-[10.5px] text-ink3">
          {unit ? `${deInt(games)} ${unit}` : t("ins.metricGames", { n: games })}
          {accuracy != null ? ` · ${t("ins.metricAccuracy", { p: de(accuracy) })}` : ""}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel3">
        <div
          className="h-full rounded-full"
          style={{ width: `${score}%`, background: score >= 55 ? chart.win : score >= 45 ? chart.draw : chart.loss }}
        />
      </div>
      <div className="text-right text-[12px] tabular-nums text-ink2">{score} %</div>
    </div>
  );
}

function Overview({ data, phaseLabel }: { data: LiveInsights; phaseLabel: (phase: string) => string }) {
  const { t } = useI18n();
  const weakestPhase = [...data.phaseAccuracy]
    .filter((phase) => phase.accuracy != null)
    .sort((a, b) => a.accuracy! - b.accuracy!)[0];
  const reliableOpenings = data.openingDetails.filter((opening) => opening.games >= 3);
  const weakestOpening = [...reliableOpenings].sort((a, b) => a.scorePct - b.scorePct)[0];
  const formDelta = data.recentForm.previousScorePct == null
    ? null
    : data.recentForm.scorePct - data.recentForm.previousScorePct;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi label={t("ins.totalGames")} value={deInt(data.totalGames)} sub={t("ins.localDb")} />
        <Kpi label={t("ins.scoreRate")} value={`${de(data.scoreRate)} %`} sub={t("ins.pointsNotWins")} />
        <Kpi label={t("ins.avgAccuracy")} value={data.avgAccuracy == null ? "—" : `${de(data.avgAccuracy)} %`} sub={t("ins.analysisCoverage", { p: data.analysisCoverage })} />
        <Kpi label={t("ins.form20")} value={`${data.recentForm.scorePct} %`} sub={formDelta == null ? t("ins.noComparison") : t(formDelta >= 0 ? "ins.formUp" : "ins.formDown", { p: Math.abs(formDelta) })} />
      </div>

      <Card
        title={<span className="flex items-center gap-2"><Stethoscope size={15} className="text-accent" /> {t("ins.diagnosisTitle")}</span>}
      >
        <div className="grid gap-3 min-[800px]:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel2 p-3.5">
            <TrendingUp size={16} className="text-accent" />
            <div className="mt-2 text-[12.5px] font-medium text-ink">{t("ins.formDiagnosis")}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink3">
              {formDelta == null ? t("ins.formNeeds40") : t(formDelta >= 0 ? "ins.formPositive" : "ins.formNegative", { p: Math.abs(formDelta), n: data.recentForm.games })}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-3.5">
            <Target size={16} className="text-gold" />
            <div className="mt-2 text-[12.5px] font-medium text-ink">{t("ins.phaseFocus")}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink3">
              {weakestPhase?.accuracy != null
                ? t("ins.phaseFocusBody", { phase: phaseLabel(weakestPhase.phase), p: de(weakestPhase.accuracy), n: weakestPhase.games })
                : t("ins.needsAnalysis")}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel2 p-3.5">
            <ShieldCheck size={16} className="text-violet" />
            <div className="mt-2 text-[12.5px] font-medium text-ink">{t("ins.openingFocus")}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink3">
              {weakestOpening
                ? t("ins.openingFocusBody", { name: weakestOpening.name, p: weakestOpening.scorePct, n: weakestOpening.games })
                : t("ins.needsOpeningSample")}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <Card title={t("ins.resultTrendTitle")}>
          {data.resultTrend.length >= 2 ? (
            <ResponsiveContainer width="100%" height={245}>
              <LineChart data={data.resultTrend} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="month" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
                <YAxis domain={[0, 100]} tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} />
                <Line type="monotone" dataKey="scorePct" name={t("ins.scoreRate")} stroke={chart.accent} strokeWidth={2} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="flex h-[245px] items-center justify-center text-[12px] text-ink3">{t("ins.tooFewData")}</div>}
          <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink3">
            {t("ins.resultTrendNote")}
          </p>
        </Card>
        <Card title={t("ins.dataQualityTitle")}>
          <div className="space-y-4 py-1">
            <MetricBar label={t("ins.analyzedGames")} games={Math.round(data.totalGames * data.analysisCoverage / 100)} score={data.analysisCoverage} accuracy={null} />
            <div className="rounded-lg border border-line bg-panel2 p-3">
              <div className="text-[11.5px] text-ink3">{t("ins.consistency")}</div>
              <div className="mt-1 text-xl font-semibold">{data.accuracyConsistency == null ? "—" : `± ${de(data.accuracyConsistency)}`}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">{t("ins.consistencyNote")}</p>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.dataQualityNote")}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Performance({ data, errors, phaseLabel }: { data: LiveInsights; errors: PhaseErrors[]; phaseLabel: (phase: string) => string }) {
  const { t } = useI18n();
  const errorData = errors.map((entry) => ({ ...entry, phase: phaseLabel(entry.phase) }));
  return (
    <div className="space-y-4">
      <Card title={t("ins.phaseAccuracyTitle")}>
        <div className="grid grid-cols-3 gap-3">
          {data.phaseAccuracy.map((phase) => (
            <div key={phase.phase} className="rounded-lg border border-line bg-panel2 p-4 text-center">
              <div className="text-[11.5px] text-ink3">{phaseLabel(phase.phase)}</div>
              <div className="mt-1 text-2xl font-semibold">{phase.accuracy == null ? "—" : `${de(phase.accuracy)} %`}</div>
              <div className="mt-1 text-[10.5px] text-ink3">{t("ins.phaseAccuracyGames", { n: phase.games })}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 min-[950px]:grid-cols-2">
        <Card title={t("ins.errorsTitle")}>
          {errorData.some((entry) => entry.inaccuracy + entry.mistake + entry.blunder > 0) ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={errorData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="phase" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
                <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<DarkTooltip />} cursor={barCursor} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="inaccuracy" name={t("ins.legInaccuracies")} stackId="errors" fill={chart.inaccuracy} />
                <Bar dataKey="mistake" name={t("ins.legMistakes")} stackId="errors" fill={chart.mistake} />
                <Bar dataKey="blunder" name={t("ins.legBlunders")} stackId="errors" fill={chart.blunder} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex h-[260px] items-center justify-center px-6 text-center text-[12px] text-ink3">{t("ins.noErrors")}</div>}
        </Card>
        <Card title={t("ins.oppStrengthTitle")}>
          <div className="space-y-4 py-2">
            {data.byOppStrength.map((bucket) => <MetricBar key={bucket.bucket} label={bucket.bucket} games={bucket.games} score={bucket.winRate} accuracy={null} />)}
          </div>
        </Card>
        <Card title={t("ins.timeControlTitle")}>
          <div className="space-y-4 py-2">
            {data.byTimeControl.map((bucket) => <MetricBar key={bucket.tc} label={bucket.tc} games={bucket.games} score={bucket.winRate} accuracy={null} />)}
          </div>
        </Card>
        <Card title={t("ins.lengthTitle")}>
          <div className="space-y-4 py-2">
            {data.byLength.map((bucket) => <MetricBar key={bucket.bucket} label={bucket.bucket} games={bucket.games} score={bucket.scorePct} accuracy={bucket.accuracy} />)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Openings({ data }: { data: LiveInsights }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 min-[1000px]:grid-cols-[1fr_1.4fr]">
      <Card title={t("ins.openingsTitle")}>
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={data.openings} layout="vertical" margin={{ top: 0, right: 42, bottom: 0, left: 12 }} barSize={17}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" width={170} tick={{ ...chart.tick, fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<DarkTooltip />} cursor={barCursor} />
            <Bar dataKey="win" name={t("ins.winRate")} radius={[0, 4, 4, 0]}>
              {data.openings.map((opening) => <Cell key={opening.name} fill={opening.win >= 50 ? chart.win : chart.loss} />)}
              <LabelList dataKey="win" position="right" formatter={(value: number) => `${value} %`} style={{ fill: "#b9b8ae", fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title={t("ins.openingTableTitle")} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead className="border-b border-line bg-panel2 text-[10.5px] uppercase tracking-wide text-ink3">
              <tr><th className="px-4 py-2.5">{t("ins.opening")}</th><th className="px-3 py-2.5">{t("ins.color")}</th><th className="px-3 py-2.5 text-right">{t("ins.games")}</th><th className="px-3 py-2.5 text-right">{t("ins.scoreRate")}</th><th className="px-4 py-2.5 text-right">{t("ins.accuracyShort")}</th></tr>
            </thead>
            <tbody>
              {data.openingDetails.map((opening) => (
                <tr key={`${opening.name}-${opening.color}`} className="border-b border-line/70 last:border-0">
                  <td className="max-w-[310px] truncate px-4 py-3 text-[12.5px] text-ink">{opening.name}</td>
                  <td className="px-3 py-3 text-[12px] text-ink3">{t(opening.color === "white" ? "common.white" : "common.black")}</td>
                  <td className="px-3 py-3 text-right text-[12px] tabular-nums text-ink2">{opening.games}</td>
                  <td className={`px-3 py-3 text-right text-[12px] font-medium tabular-nums ${opening.scorePct >= 55 ? "text-win" : opening.scorePct < 40 ? "text-loss" : "text-ink2"}`}>{opening.scorePct} %</td>
                  <td className="px-4 py-3 text-right text-[12px] tabular-nums text-ink2">{opening.accuracy == null ? "—" : `${de(opening.accuracy)} %`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.openingDetails.length === 0 && <div className="p-8 text-center text-[12px] text-ink3">{t("ins.tooFewData")}</div>}
        </div>
      </Card>
    </div>
  );
}

function Patterns({ data }: { data: LiveInsights }) {
  const { t } = useI18n();
  const maxActivity = Math.max(1, ...data.activity.values.flat());
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 min-[900px]:grid-cols-4">
        <Kpi label={t("ins.bounceBack")} value={`${data.bounceBack.scorePct} %`} sub={t("ins.afterLoss", { n: data.bounceBack.games })} />
        <Kpi label={t("ins.lossStreak")} value={deInt(data.longestLossStreak)} sub={t("ins.lossStreakNote")} />
        <Kpi label={t("ins.bestDay")} value={data.byWeekday.filter((day) => day.games > 0).sort((a, b) => b.scorePct - a.scorePct)[0]?.day ?? "—"} sub={t("ins.scoreByDay")} />
        <Kpi label={t("ins.activeSlot")} value={data.topSlot?.label ?? "—"} sub={data.topSlot ? t("ins.gamesCount", { n: data.topSlot.games }) : t("ins.noTimeData")} />
      </div>
      <div className="grid gap-4 min-[950px]:grid-cols-2">
        <Card title={t("ins.weekdayPerformance")}><div className="space-y-3">{data.byWeekday.map((day) => <MetricBar key={day.day} label={day.day} games={day.games} score={day.scorePct} accuracy={day.accuracy} />)}</div></Card>
        <Card title={t("ins.timePerformance")}><div className="space-y-3">{data.byTimeSlot.map((slot) => <MetricBar key={slot.slot} label={`${slot.slot} ${t("ins.oclock")}`} games={slot.games} score={slot.scorePct} accuracy={slot.accuracy} />)}</div></Card>
      </div>
      <Card title={t("ins.activityTitle")}>
        <div className="grid gap-1" style={{ gridTemplateColumns: `44px repeat(${data.activity.slots.length}, 1fr)` }}>
          <div />
          {data.activity.slots.map((slot) => <div key={slot} className="pb-1 text-center text-[10.5px] text-ink3">{slot}</div>)}
          {data.activity.days.map((day, dayIndex) => (
            <Fragment key={day}>
              <div className="flex items-center text-[11px] text-ink3">{day}</div>
              {data.activity.values[dayIndex].map((value, slotIndex) => (
                <div key={`${day}-${slotIndex}`} className="flex h-9 items-center justify-center rounded-md text-[10.5px]" style={{ background: value === 0 ? "var(--color-panel2)" : `rgba(34,192,138,${0.12 + value / maxActivity * 0.75})`, color: value / maxActivity > 0.55 ? "#06251a" : "var(--color-ink3)" }}>{value || ""}</div>
              ))}
            </Fragment>
          ))}
        </div>
      </Card>
    </div>
  );
}

function solveRate(entry: { attempts: number; solved: number }): number {
  return entry.attempts === 0 ? 0 : Math.round((entry.solved / entry.attempts) * 100);
}

function Puzzles({ data }: { data: PuzzleInsights }) {
  const { locale, t } = useI18n();
  const [themesOpen, setThemesOpen] = useState(false);
  const rate = solveRate(data);
  const weekdayLabel = (key: number) =>
    // 2024-01-01 war ein Montag — passend zu Index 0 aus dem Backend.
    new Date(Date.UTC(2024, 0, 1 + key)).toLocaleDateString(dateLocale(), {
      weekday: "short",
      timeZone: "UTC",
    });
  const timeline = data.timeline.map((point) => ({
    ...point,
    failed: point.attempts - point.solved,
    label: new Date(point.day_ts * 1000).toLocaleDateString(dateLocale(), {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }),
  }));
  // Belastbare Motive: ab fünf Versuchen; sonst dominiert der Zufall.
  const reliable = data.themes.filter((theme) => theme.attempts >= 5);
  const weakest = [...reliable].sort((a, b) => solveRate(a) - solveRate(b)).slice(0, 5);
  const strongest = [...reliable].sort((a, b) => solveRate(b) - solveRate(a)).slice(0, 5);
  const activeHours = data.by_hour.filter((slot) => slot.attempts > 0);

  if (data.attempts === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line2 px-4 py-8 text-center text-[12.5px] text-ink3">
        {t("ins.pzNoAttempts")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi label={t("ins.pzRating")} value={deInt(data.personal_rating)} sub={t("ins.pzRatingSub")} />
        <Kpi label={t("ins.pzSolveRate")} value={`${rate} %`} sub={t("ins.pzSolveRateSub", { s: deInt(data.solved), n: deInt(data.attempts) })} />
        <Kpi label={t("ins.pzHardest")} value={deInt(data.avg_solved_rating)} sub={t("ins.pzHardestSub", { n: deInt(data.avg_puzzle_rating) })} />
        <Kpi label={t("ins.pzRun")} value={deInt(data.best_run)} sub={t("ins.pzRunSub", { n: deInt(data.current_run) })} />
      </div>

      <div className="grid gap-4 min-[950px]:grid-cols-2">
        <Card title={t("ins.pzRatingTrend")}>
          <ResponsiveContainer width="100%" height={245}>
            <LineChart data={timeline} margin={{ top: 12, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={24} />
              <YAxis domain={["dataMin - 40", "dataMax + 40"]} tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<DarkTooltip />} />
              <Line type="monotone" dataKey="rating" name={t("ins.pzRating")} stroke={chart.accent} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title={t("ins.pzVolume")}>
          <ResponsiveContainer width="100%" height={245}>
            <BarChart data={timeline} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} minTickGap={24} />
              <YAxis tick={chart.tick} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<DarkTooltip />} cursor={barCursor} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="solved" name={t("ins.pzSolved")} stackId="attempts" fill={chart.win} />
              <Bar dataKey="failed" name={t("ins.pzFailed")} stackId="attempts" fill={chart.loss} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 min-[950px]:grid-cols-2">
        <Card title={t("ins.pzByDifficulty")}>
          <div className="space-y-4 py-2">
            {data.by_rating.map((bucket) => (
              <MetricBar
                key={bucket.key}
                label={`${deInt(bucket.key)}–${deInt(bucket.key + 399)}`}
                games={bucket.attempts}
                score={solveRate(bucket)}
                accuracy={null}
                unit={t("ins.pzAttempts")}
              />
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("ins.pzByDifficultyNote")}</p>
        </Card>
        <Card title={t("ins.pzWeakThemes")}>
          <div className="space-y-4 py-2">
            {weakest.length > 0 ? (
              weakest.map((theme) => (
                <MetricBar
                  key={theme.theme}
                  label={themeLabel(theme.theme, locale)}
                  games={theme.attempts}
                  score={solveRate(theme)}
                  accuracy={null}
                  unit={t("ins.pzAttempts")}
                />
              ))
            ) : (
              <p className="text-[12px] text-ink3">{t("ins.pzThemesTooFew")}</p>
            )}
          </div>
          {strongest.length > 0 && (
            <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
              {t("ins.pzStrongThemes")}{" "}
              <span className="text-ink2">
                {strongest.map((theme) => `${themeLabel(theme.theme, locale)} ${solveRate(theme)} %`).join(" · ")}
              </span>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 min-[950px]:grid-cols-2">
        <Card title={t("ins.pzByWeekday")}>
          <div className="space-y-3 py-1">
            {data.by_weekday.map((day) => (
              <MetricBar key={day.key} label={weekdayLabel(day.key)} games={day.attempts} score={solveRate(day)} accuracy={null} unit={t("ins.pzAttempts")} />
            ))}
          </div>
        </Card>
        <Card title={t("ins.pzByHour")}>
          {activeHours.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
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
                    <Cell key={slot.key} fill={solveRate(slot) >= 60 ? chart.win : solveRate(slot) >= 45 ? chart.draw : chart.loss} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-[12px] text-ink3">{t("ins.pzNoAttempts")}</div>
          )}
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">{t("ins.pzByHourNote")}</p>
        </Card>
      </div>

      <Card
        title={t("ins.pzThemeTable")}
        pad={false}
        action={
          <button
            type="button"
            onClick={() => setThemesOpen((open) => !open)}
            aria-expanded={themesOpen}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink3 hover:bg-panel2 hover:text-ink"
          >
            {t(themesOpen ? "ins.collapse" : "ins.expand", { n: data.themes.length })}
            <ChevronDown size={15} className={`transition-transform ${themesOpen ? "rotate-180" : ""}`} />
          </button>
        }
      >
        {themesOpen && (
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
                  <td className="max-w-[280px] truncate px-4 py-2.5 text-[12.5px] text-ink">{themeLabel(theme.theme, locale)}</td>
                  <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink2">{deInt(theme.attempts)}</td>
                  <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink2">{deInt(theme.solved)}</td>
                  <td className={`px-4 py-2.5 text-right text-[12px] font-medium tabular-nums ${solveRate(theme) >= 60 ? "text-win" : solveRate(theme) < 45 ? "text-loss" : "text-ink2"}`}>
                    {solveRate(theme)} %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </div>
  );
}

export default function InsightsV2() {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<InsightTab>("overview");
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [errors, setErrors] = useState<PhaseErrors[]>([]);
  const [puzzles, setPuzzles] = useState<PuzzleInsights | null>(null);

  useEffect(() => {
    if (backend.mode !== "desktop") return;
    let cancelled = false;
    Promise.all([
      listGames().catch(() => [] as GameRecord[]),
      errorStats().catch(() => [] as PhaseErrors[]),
    ]).then(([nextRecords, nextErrors]) => {
      if (cancelled) return;
      setRecords(nextRecords);
      setErrors(nextErrors);
    });
    return () => {
      cancelled = true;
    };
  }, [backend.mode]);

  // Puzzle-Detailanalyse erst laden, wenn der Reiter wirklich geöffnet wird.
  useEffect(() => {
    if (backend.mode !== "desktop" || tab !== "puzzles" || puzzles) return;
    let cancelled = false;
    puzzleInsights()
      .then((next) => !cancelled && setPuzzles(next))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backend.mode, tab, puzzles]);

  const analysisRecords = backend.mode === "desktop" ? records : DEMO_RECORDS;
  const data = useMemo(() => buildInsights(analysisRecords, locale), [analysisRecords, locale]);
  const analysisErrors = backend.mode === "desktop" ? errors : DEMO_ERRORS;
  const puzzleData = backend.mode === "desktop" ? puzzles : demoPuzzleInsights();
  const phaseLabel = (phase: string) => t(`ins.phase.${phase}` as Key);

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-[21px] font-semibold tracking-tight">{t("ins.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("ins.subtitleDeep", { n: deInt(data.totalGames) })}</p>
      </header>

      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1" aria-label={t("ins.sections")}>
        {TAB_KEYS.map(({ id, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[12.5px] font-medium transition-colors ${tab === id ? "bg-panel3 text-ink shadow-sm" : "text-ink3 hover:bg-panel2 hover:text-ink2"}`}
          >
            <Icon size={14} className={tab === id ? "text-accent" : ""} /> {t(key)}
          </button>
        ))}
      </nav>

      {records.length === 0 && backend.mode === "desktop" && tab !== "puzzles" && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-3 text-[12.5px] text-ink3">{t("ins.noGames")}</div>
      )}
      {tab === "overview" && <Overview data={data} phaseLabel={phaseLabel} />}
      {tab === "performance" && <Performance data={data} errors={analysisErrors} phaseLabel={phaseLabel} />}
      {tab === "openings" && <Openings data={data} />}
      {tab === "patterns" && <Patterns data={data} />}
      {tab === "puzzles" &&
        (puzzleData ? (
          <Puzzles data={puzzleData} />
        ) : (
          <div className="rounded-xl border border-dashed border-line2 px-4 py-8 text-center text-[12.5px] text-ink3">
            {t("common.loading")}
          </div>
        ))}
    </div>
  );
}
