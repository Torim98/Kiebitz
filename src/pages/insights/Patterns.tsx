/**
 * Muster: wann und wie gespielt wird, statt was auf dem Brett passiert.
 *
 * Der neue Kern sind die Sitzungen · „nach der vierten Partie" erklärt mehr als
 * „abends", weil es die Ursache benennt statt der Uhrzeit.
 */
import { Fragment } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { barCursor, chart, DarkTooltip } from "../../components/chartTheme";
import { useI18n } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import type { DeepInsights } from "../../lib/insights";
import type { LiveInsights } from "../../lib/stats";
import type { Finding } from "../../lib/findings";
import { FindingStrip, Kpi, MetricBar, Section, Stat, Versus } from "./parts";

export default function Patterns({
  deep,
  live,
  findings,
  onAction,
}: {
  deep: DeepInsights;
  live: LiveInsights;
  findings: Finding[];
  onAction: (finding: Finding) => void;
}) {
  const { t } = useI18n();
  const { sessions } = deep;
  const maxActivity = Math.max(1, ...live.activity.values.flat());

  const indexData = sessions.by_index.map((bucket) => ({
    ...bucket,
    label: bucket.index >= 5 ? `${bucket.index}+` : `${bucket.index}`,
  }));

  return (
    <div className="space-y-4">
      <FindingStrip findings={findings} window={deep.window} onAction={onAction} />

      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi
          label={t("ins.paSessions")}
          value={deInt(sessions.sessions)}
          sub={t("ins.paSessionsSub", { n: de(sessions.avg_games) })}
        />
        <Kpi
          label={t("ins.paLimit")}
          value={sessions.recommended_length > 0 ? deInt(sessions.recommended_length) : "—"}
          sub={
            sessions.recommended_length > 0 ? t("ins.paLimitSub") : t("ins.paLimitNone")
          }
          tone={sessions.recommended_length > 0 ? "warn" : "good"}
        />
        <Kpi
          label={t("ins.bounceBack")}
          value={`${live.bounceBack.scorePct} %`}
          sub={t("ins.afterLoss", { n: live.bounceBack.games })}
        />
        <Kpi
          label={t("ins.bestDay")}
          value={
            [...live.byWeekday].filter((d) => d.games > 0).sort((a, b) => b.scorePct - a.scorePct)[0]
              ?.day ?? "—"
          }
          sub={t("ins.scoreByDay")}
        />
      </div>

      <Section
        title={t("ins.paCurveTitle")}
        summary={
          indexData.length >= 2
            ? t("ins.paCurveSummary", {
                a: de(indexData[0].score_pct),
                b: de(indexData[indexData.length - 1].score_pct),
              })
            : undefined
        }
        disabled={indexData.length < 2}
        defaultOpen
      >
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={indexData} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="label" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis domain={[0, 100]} tick={chart.tick} tickLine={false} axisLine={false} />
            <Tooltip content={<DarkTooltip />} cursor={barCursor} />
            <Bar dataKey="score_pct" name={t("ins.scoreRate")} radius={[4, 4, 0, 0]}>
              {indexData.map((bucket) => (
                <Cell
                  key={bucket.index}
                  fill={bucket.score_pct >= 52 ? chart.win : bucket.score_pct >= 45 ? chart.draw : chart.loss}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-2 gap-2 min-[700px]:grid-cols-5">
          {indexData.map((bucket) => (
            <Stat
              key={bucket.index}
              label={t("ins.paGameNo", { n: bucket.label })}
              value={`${de(bucket.score_pct)} %`}
              hint={t("ins.gamesCount", { n: bucket.games })}
            />
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.paCurveNote")}</p>
      </Section>

      <Section
        title={t("ins.paRequeueTitle")}
        summary={t("ins.paRequeueSummary", {
          f: de(sessions.requeue.fast_score),
          s: de(sessions.requeue.slow_score),
        })}
        disabled={sessions.requeue.fast_games < 5}
      >
        <Versus
          leftLabel={t("ins.paFast", {
            t: Math.round(sessions.requeue.threshold / 60),
            n: deInt(sessions.requeue.fast_games),
          })}
          leftValue={sessions.requeue.fast_score}
          rightLabel={t("ins.paSlow", { n: deInt(sessions.requeue.slow_games) })}
          rightValue={sessions.requeue.slow_score}
          unit=" %"
        />
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.paRequeueNote")}</p>
      </Section>

      <Section
        title={t("ins.paWarmupTitle")}
        summary={t("ins.paWarmupSummary", {
          f: de(sessions.warmup.first_score),
          r: de(sessions.warmup.rest_score),
        })}
        disabled={sessions.warmup.first_games < 10}
      >
        <div className="space-y-4">
          <Versus
            leftLabel={t("ins.paFirstOfDay", { n: deInt(sessions.warmup.first_games) })}
            leftValue={sessions.warmup.first_score}
            rightLabel={t("ins.paRestOfDay", { n: deInt(sessions.warmup.rest_games) })}
            rightValue={sessions.warmup.rest_score}
            unit=" %"
          />
          {sessions.warmup.primed_games >= 5 && sessions.warmup.cold_games >= 5 && (
            <>
              <Versus
                leftLabel={t("ins.paPrimed", { n: deInt(sessions.warmup.primed_games) })}
                leftValue={sessions.warmup.primed_score}
                rightLabel={t("ins.paCold", { n: deInt(sessions.warmup.cold_games) })}
                rightValue={sessions.warmup.cold_score}
                unit=" %"
              />
              <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.paPrimedNote")}</p>
            </>
          )}
        </div>
      </Section>

      <Section
        title={t("ins.paDamageTitle")}
        summary={t("ins.paDamageSummary", { p: de(sessions.damage.worst3_pct) })}
        disabled={sessions.damage.sessions < 10}
      >
        <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-3">
          <Stat
            label={t("ins.paTotalLoss")}
            value={deInt(sessions.damage.total_loss)}
            hint={t("ins.paTotalLossHint", { n: deInt(sessions.damage.sessions) })}
          />
          <Stat
            label={t("ins.paWorst3")}
            value={`${de(sessions.damage.worst3_pct)} %`}
            hint={t("ins.paWorst3Hint")}
          />
          <Stat
            label={t("ins.paWorstSingle")}
            value={deInt(sessions.damage.worst_delta)}
            hint={t("ins.paWorstSingleHint")}
          />
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.paDamageNote")}</p>
      </Section>

      <Section title={t("ins.paRhythmTitle")} summary={t("ins.paRhythmSummary")}>
        <div className="grid gap-5 min-[850px]:grid-cols-2">
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.weekdayPerformance")}</div>
            <div className="space-y-3">
              {live.byWeekday.map((day) => (
                <MetricBar
                  key={day.day}
                  label={day.day}
                  note={t("ins.gamesCount", { n: day.games })}
                  value={day.scorePct}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.timePerformance")}</div>
            <div className="space-y-3">
              {live.byTimeSlot.map((slot) => (
                <MetricBar
                  key={slot.slot}
                  label={`${slot.slot} ${t("ins.oclock")}`}
                  note={t("ins.gamesCount", { n: slot.games })}
                  value={slot.scorePct}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("ins.activityTitle")} summary={t("ins.paActivitySummary")}>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `44px repeat(${live.activity.slots.length}, 1fr)` }}
        >
          <div />
          {live.activity.slots.map((slot) => (
            <div key={slot} className="pb-1 text-center text-[10.5px] text-ink3">
              {slot}
            </div>
          ))}
          {live.activity.days.map((day, dayIndex) => (
            <Fragment key={day}>
              <div className="flex items-center text-[11px] text-ink3">{day}</div>
              {live.activity.values[dayIndex].map((value, slotIndex) => (
                <div
                  key={`${day}-${slotIndex}`}
                  className="flex h-9 items-center justify-center rounded-md text-[10.5px]"
                  style={{
                    background:
                      value === 0
                        ? "var(--color-panel2)"
                        : `rgba(34,192,138,${0.12 + (value / maxActivity) * 0.75})`,
                    color: value / maxActivity > 0.55 ? "#06251a" : "var(--color-ink3)",
                  }}
                >
                  {value || ""}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </Section>

      <Section
        title={t("ins.resultTrendTitle")}
        summary={t("ins.paTrendSummary")}
        disabled={live.resultTrend.length < 2}
      >
        <ResponsiveContainer width="100%" height={245}>
          <LineChart data={live.resultTrend} margin={{ top: 12, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis dataKey="month" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis domain={[0, 100]} tick={chart.tick} tickLine={false} axisLine={false} />
            <Tooltip content={<DarkTooltip />} />
            <Line
              type="monotone"
              dataKey="scorePct"
              name={t("ins.scoreRate")}
              stroke={chart.accent}
              strokeWidth={2}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink3">{t("ins.resultTrendNote")}</p>
      </Section>
    </div>
  );
}
