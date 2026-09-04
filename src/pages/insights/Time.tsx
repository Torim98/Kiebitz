/**
 * Zeit & Formate.
 *
 * Zwei Fragen: Nutzt du deine Bedenkzeit an den richtigen Stellen, und passt
 * das Zeitformat, das du am meisten spielst, zu dem, in dem du am besten
 * spielst? Beides hängt an denselben Uhrdaten, deshalb steht es zusammen.
 */
import { Lightbulb } from "lucide-react";
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
import { barCursor, chart, chartSurface, ChartTooltip } from "../../components/chartTheme";
import { useMobileShell } from "../../components/MobileShell";
import { useI18n, type Key } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import { tcLabel } from "../../lib/gameUi";
import type { DeepInsights, FormatStat } from "../../lib/insights";
import { toReference, REFERENCE_LABEL, REFERENCE_SOURCE } from "../../lib/formatScale";
import { isMeaningful, recommendFormat, type FormatRecommendation } from "../../lib/formatChoice";
import type { Finding } from "../../lib/findings";
import { CoverageNote, Empty, FindingStrip, Kpi, MetricBar, Section, Stat, Versus } from "./parts";

function ScaleValue({ format }: { format: FormatStat }) {
  const { t } = useI18n();
  const scaled = toReference(format.rating, format.source, format.time_class);
  if (!scaled) return <span className="text-ink3">—</span>;
  const dimmed = scaled.confidence !== "measured";
  return (
    <span
      className={dimmed ? "text-ink3" : "text-ink2"}
      title={t(`ins.fmtConf.${scaled.confidence}` as Key)}
    >
      {deInt(scaled.value)}
      {dimmed && <span className="ml-0.5 align-super text-[9px]">≈</span>}
    </span>
  );
}

export default function Time({
  deep,
  findings,
  onAction,
}: {
  deep: DeepInsights;
  findings: Finding[];
  onAction: (finding: Finding) => void;
}) {
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const { time, formats, coverage } = deep;
  const flagLossPct = time.games > 0 ? (time.trouble.flag_losses / time.games) * 100 : 0;

  if (time.games === 0) {
    return (
      <div className="space-y-4">
        <Empty text={t("ins.tmNoClocks")} />
        <FormatsSection deep={deep} />
      </div>
    );
  }

  const speedData = time.by_speed.map((bucket) => ({
    ...bucket,
    label: t(`ins.tmSpeed.${bucket.key}` as Key),
  }));
  const driftData = time.drift.map((point) => ({
    ...point,
    label: point.index >= 5 ? `${point.index}+` : `${point.index}`,
  }));

  return (
    <div className="space-y-4">
      <FindingStrip findings={findings} window={deep.window} onAction={onAction} />

      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi
          label={t("ins.tmTroubleShare")}
          value={`${de(time.trouble.share_pct)} %`}
          sub={t("ins.tmTroubleSub", { n: deInt(time.trouble.games), p: de(time.trouble.games_pct) })}
          tone={time.trouble.share_pct >= 15 ? "bad" : time.trouble.share_pct >= 8 ? "warn" : "good"}
        />
        <Kpi
          label={t("ins.tmBookShare")}
          value={`${de(time.theory.book_share_pct)} %`}
          sub={t("ins.tmBookSub", { n: deInt(time.theory.book_moves) })}
          tone={time.theory.book_share_pct >= 25 ? "warn" : undefined}
        />
        <Kpi
          label={t("ins.tmEdge")}
          value={`${time.edge.avg_diff > 0 ? "+" : ""}${de(time.edge.avg_diff)} s`}
          sub={t("ins.tmEdgeSub", { n: deInt(time.edge.games) })}
          tone={time.edge.avg_diff >= 0 ? "good" : "warn"}
        />
        <Kpi
          label={t("ins.tmFlag")}
          value={deInt(time.trouble.flag_losses)}
          sub={t("ins.tmFlagSub", { p: de(flagLossPct) })}
          tone={time.trouble.flag_losses >= 3 && flagLossPct >= 3 ? "bad" : undefined}
        />
      </div>

      <Section
        title={t("ins.tmSpeedTitle")}
        summary={t("ins.tmSpeedSummary", {
          fast: de(time.by_speed.find((b) => b.key === "instant")?.errors_per_100 ?? 0),
          slow: de(time.by_speed.find((b) => b.key === "long")?.errors_per_100 ?? 0),
        })}
        defaultOpen
      >
        <ResponsiveContainer width="100%" height={250}>
          <BarChart {...chartSurface} data={speedData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={barCursor} />
            <Bar dataKey="errors_per_100" name={t("ins.tmErrorsPer100")} radius={[4, 4, 0, 0]}>
              {speedData.map((bucket) => (
                <Cell
                  key={bucket.key}
                  fill={bucket.errors_per_100 >= 6 ? chart.loss : bucket.errors_per_100 >= 3 ? chart.draw : chart.win}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
          {speedData.map((bucket) => (
            <Stat
              key={bucket.key}
              label={bucket.label}
              value={`${de(bucket.errors_per_100)}`}
              hint={t("ins.tmSpeedHint", { n: deInt(bucket.moves), s: de(bucket.share_pct) })}
            />
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.tmSpeedNote")}</p>
      </Section>

      <Section
        title={t("ins.tmFocusTitle")}
        summary={t("ins.tmFocusSummary", {
          e: de(time.focus.error_share),
          o: de(time.focus.ok_share),
        })}
      >
        <div className="space-y-4">
          <Versus
            leftLabel={t("ins.tmOnErrors")}
            leftValue={time.focus.error_share}
            rightLabel={t("ins.tmOnRest")}
            rightValue={time.focus.ok_share}
            unit=" %"
          />
          <Versus
            leftLabel={t("ins.tmBalanced")}
            leftValue={time.focus.balanced_share}
            rightLabel={t("ins.tmDecided")}
            rightValue={time.focus.decided_share}
            unit=" %"
          />
          <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.tmFocusNote")}</p>
        </div>
      </Section>

      <Section
        title={t("ins.tmTroubleTitle")}
        summary={t("ins.tmTroubleSummary", {
          e: de(time.trouble.errors_per_100),
          b: de(time.trouble.baseline_per_100),
        })}
      >
        <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
          <Stat
            label={t("ins.tmTroubleMoves")}
            value={deInt(time.trouble.moves)}
            hint={t("ins.tmTroubleMovesHint", { p: de(time.trouble.share_pct) })}
          />
          <Stat
            label={t("ins.tmTroubleStart")}
            value={t("ins.tmMoveNo", { n: de(time.trouble.first_move) })}
            hint={t("ins.tmTroubleStartHint")}
          />
          <Stat
            label={t("ins.tmScoreTrouble")}
            value={`${de(time.trouble.score_in_trouble)} %`}
            hint={t("ins.tmScoreWithout", { p: de(time.trouble.score_without) })}
          />
          <Stat
            label={t("ins.tmIncrement")}
            value={`${de(time.increment.over_increment_pct)} %`}
            hint={t("ins.tmIncrementHint", {
              s: de(time.increment.avg_spent),
              i: de(time.increment.increment),
            })}
          />
        </div>
        <CoverageNote shown={time.games} total={coverage.games} unitKey="ins.unitGames" />
      </Section>

      <Section
        title={t("ins.tmEdgeTitle")}
        summary={t("ins.tmEdgeSummary", {
          a: de(time.edge.ahead_score),
          b: de(time.edge.behind_score),
        })}
        disabled={time.edge.games < 15}
      >
        <Versus
          leftLabel={t("ins.tmAhead", { n: deInt(time.edge.ahead_games) })}
          leftValue={time.edge.ahead_score}
          rightLabel={t("ins.tmBehind", { n: deInt(time.edge.behind_games) })}
          rightValue={time.edge.behind_score}
          unit=" %"
        />
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.tmEdgeNote")}</p>
      </Section>

      <Section
        title={t("ins.tmTheoryTitle")}
        summary={t("ins.tmTheorySummary", { p: de(time.theory.book_share_pct) })}
      >
        <Versus
          leftLabel={t("ins.tmBookMove")}
          leftValue={time.theory.book_avg_share}
          rightLabel={t("ins.tmOwnMove")}
          rightValue={time.theory.own_avg_share}
          unit=" %"
          lowerIsBetter
        />
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.tmTheoryNote")}</p>
      </Section>

      <Section
        title={t("ins.tmDriftTitle")}
        summary={t("ins.tmDriftSummary")}
        disabled={driftData.length < 3}
      >
        <ResponsiveContainer width="100%" height={230}>
          <LineChart {...chartSurface} data={driftData} margin={{ top: 10, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="avg_share"
              name={t("ins.tmAvgShare")}
              stroke={chart.accent}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="score_pct"
              name={t("ins.scoreRate")}
              stroke={chart.gold}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.tmDriftNote")}</p>
      </Section>

      <Section title={t("ins.tmPhaseTitle")} summary={t("ins.tmPhaseSummary")}>
        <div className="space-y-3">
          {time.by_phase.map((phase) => (
            <MetricBar
              key={phase.phase}
              label={t(`ins.phase.${phase.phase}` as Key)}
              note={t("ins.tmPhaseNote", { n: deInt(phase.moves), s: de(phase.avg_share) })}
              value={phase.clock_pct}
              good={101}
              bad={101}
            />
          ))}
        </div>
      </Section>

      <FormatsSection deep={deep} />
    </div>
  );

  function FormatsSection({ deep }: { deep: DeepInsights }) {
    const list = formats.formats;
    if (list.length === 0) {
      return null;
    }
    // Die Empfehlung steht schon in der Zusammenfassung, damit sie auch bei
    // zugeklappter Karte lesbar ist · sie ist die Antwort auf die Frage, mit
    // der die meisten diesen Reiter überhaupt öffnen.
    const pick = recommendFormat(list);

    return (
      <Section
        title={t("ins.fmtTitle")}
        summary={pick ? recommendationLine(pick) : t("ins.fmtSummaryPlain", { n: list.length })}
        defaultOpen
      >
        {pick && <RecommendationCard pick={pick} />}
        {mobile ? (
          <div className="flex flex-col gap-2">
            {list.map((format) => (
              <div key={format.key} className="rounded-lg border border-line bg-panel2 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] text-ink">
                    {tcLabel(format.time_class, locale)}{" "}
                    <span className="text-ink3">· {format.source}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-ink2">
                    {de(format.score_pct)} %
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px] text-ink3">
                  <span>
                    {t("ins.fmtRating")}: {format.rating == null ? "—" : deInt(format.rating)}
                  </span>
                  <span>
                    {t("ins.fmtScale")}: <ScaleValue format={format} />
                  </span>
                  <span>
                    {t("ins.fmtEdge")}:{" "}
                    {format.perf_edge == null
                      ? "—"
                      : `${format.perf_edge > 0 ? "+" : ""}${deInt(format.perf_edge)}`}
                  </span>
                  <span>
                    {t("ins.fmtBlunders")}:{" "}
                    {format.blunders_per_100 == null ? "—" : de(format.blunders_per_100)}
                  </span>
                  <span>
                    {t("ins.games")}: {deInt(format.games)}
                  </span>
                  <span>
                    {t("ins.fmtMinutes")}: {deInt(format.minutes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-line bg-panel2 text-[10.5px] uppercase tracking-wide text-ink3">
                <tr>
                  <th className="px-3 py-2.5">{t("ins.fmtFormat")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.games")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.scoreRate")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.fmtRating")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.fmtScale")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.fmtEdge")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.accuracyShort")}</th>
                  <th className="px-2 py-2.5 text-right">{t("ins.fmtBlunders")}</th>
                  <th className="px-3 py-2.5 text-right">{t("ins.fmtMinutes")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((format) => (
                  <tr key={format.key} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2.5 text-[12.5px] text-ink">
                      {tcLabel(format.time_class, locale)}
                      <span className="ml-1.5 text-[11px] text-ink3">{format.source}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {deInt(format.games)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {de(format.score_pct)} %
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {format.rating == null ? "—" : deInt(format.rating)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums">
                      <ScaleValue format={format} />
                    </td>
                    <td
                      className={`px-2 py-2.5 text-right text-[12px] font-medium tabular-nums ${
                        (format.perf_edge ?? 0) > 0 ? "text-win" : (format.perf_edge ?? 0) < 0 ? "text-loss" : "text-ink2"
                      }`}
                    >
                      {format.perf_edge == null
                        ? "—"
                        : `${format.perf_edge > 0 ? "+" : ""}${deInt(format.perf_edge)}`}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {format.accuracy == null ? "—" : `${de(format.accuracy)} %`}
                    </td>
                    <td className="px-2 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {format.blunders_per_100 == null ? "—" : de(format.blunders_per_100)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-ink2">
                      {deInt(format.minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink3">
          {t("ins.fmtSkillNote")}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
          {t("ins.fmtScaleNote", { ref: REFERENCE_LABEL, src: REFERENCE_SOURCE })}
        </p>
        {deep.formats.comparable < 2 && (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">{t("ins.fmtNeedAnalysis")}</p>
        )}
      </Section>
    );
  }

  /**
   * Die Empfehlung als ein Satz. Drei Fälle, weil es drei ehrliche Antworten
   * gibt: Fokus erhöhen, Fokus beibehalten, oder kein belastbarer Unterschied.
   */
  function recommendationLine(pick: FormatRecommendation): string {
    const best = tcLabel(pick.best.timeClass, locale);
    const weak = tcLabel(pick.weakest.timeClass, locale);
    if (!isMeaningful(pick)) return t("ins.fmtPickEven", { best, other: weak });
    if (pick.weakest.key === pick.busiest.key) {
      return t("ins.fmtPickStay", { weak, best, p: pick.weakestShare });
    }
    return t("ins.fmtPickSwitch", {
      best,
      weak,
      p: pick.weakestShare,
    });
  }

  /** Die Zahlen hinter der Empfehlung · ohne sie ist sie nur eine Behauptung. */
  function recommendationReason(pick: FormatRecommendation): string {
    const best = tcLabel(pick.best.timeClass, locale);
    const other = tcLabel(pick.weakest.timeClass, locale);
    switch (pick.evidence) {
      case "pool":
        return t("ins.fmtWhyPool", {
          best,
          other,
          b: deInt(pick.best.reference ?? 0),
          o: deInt(pick.weakest.reference ?? 0),
          n: deInt(pick.weakest.games),
        });
      case "skill":
        return t("ins.fmtWhySkill", {
          best,
          other,
          b: de(pick.best.blundersPer100 ?? 0),
          o: de(pick.weakest.blundersPer100 ?? 0),
        });
      case "score":
        return t("ins.fmtWhyScore", {
          best,
          other,
          b: de(pick.best.scorePct),
          o: de(pick.weakest.scorePct),
        });
    }
  }

  function RecommendationCard({ pick }: { pick: FormatRecommendation }) {
    const switching = isMeaningful(pick) && pick.weakest.key !== pick.busiest.key;
    return (
      <div
        className={`mb-4 flex gap-3 rounded-lg border px-3.5 py-3 ${
          switching ? "border-gold-dim bg-gold-soft" : "border-accent-dim bg-accent-soft"
        }`}
      >
        <Lightbulb
          size={15}
          className={`mt-0.5 shrink-0 ${switching ? "text-gold" : "text-accent"}`}
        />
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-snug text-ink">
            {recommendationLine(pick)}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">
            {recommendationReason(pick)}
          </p>
        </div>
      </div>
    );
  }
}
