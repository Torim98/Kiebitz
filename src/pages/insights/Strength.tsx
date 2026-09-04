/**
 * Stärke: was in den Partien selbst passiert.
 *
 * Der Kern ist der Vergleich mit dem eigenen Gegnerfeld · weil `move_evals`
 * auch die Züge der Gegner bewertet, beantwortet diese Seite als einzige die
 * Frage, die eine nackte Prozentzahl nie beantwortet: ist das gut?
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { barCursor, chart, chartSurface, ChartTooltip } from "../../components/chartTheme";
import { useI18n, type Key } from "../../lib/i18n";
import { de, deInt } from "../../lib/format";
import type { PhaseErrors } from "../../lib/analysis";
import type { DeepInsights } from "../../lib/insights";
import type { LiveInsights } from "../../lib/stats";
import type { Finding } from "../../lib/findings";
import { CoverageNote, Empty, FindingStrip, Kpi, MetricBar, Section, Stat, Versus } from "./parts";

export default function Strength({
  deep,
  live,
  errors,
  findings,
  onAction,
}: {
  deep: DeepInsights;
  live: LiveInsights;
  errors: PhaseErrors[];
  findings: Finding[];
  onAction: (finding: Finding) => void;
}) {
  const { t } = useI18n();
  const { content, benchmark, coverage } = deep;
  const phaseLabel = (phase: string) => t(`ins.phase.${phase}` as Key);
  const errorData = errors.map((entry) => ({ ...entry, phase: phaseLabel(entry.phase) }));
  const hasErrors = errorData.some((e) => e.inaccuracy + e.mistake + e.blunder > 0);

  if (content.games === 0) {
    return (
      <div className="space-y-4">
        <Empty text={t("ins.stNoAnalysis")} />
      </div>
    );
  }

  const benchData =
    benchmark.me && benchmark.field
      ? benchmark.me.by_phase.map((phase) => ({
          phase: phaseLabel(phase.phase),
          me: phase.blunders_per_100,
          field:
            benchmark.field!.by_phase.find((p) => p.phase === phase.phase)?.blunders_per_100 ?? 0,
        }))
      : [];

  return (
    <div className="space-y-4">
      <FindingStrip findings={findings} window={deep.window} onAction={onAction} />

      <div className="grid grid-cols-2 gap-4 min-[1050px]:grid-cols-4">
        <Kpi
          label={t("ins.stConversion")}
          value={`${de(content.conversion.score_pct)} %`}
          sub={t("ins.stConversionSub", {
            w: deInt(content.conversion.won),
            n: deInt(content.conversion.games),
          })}
          tone={content.conversion.score_pct < 75 ? "bad" : content.conversion.score_pct < 85 ? "warn" : "good"}
        />
        <Kpi
          label={t("ins.stDefense")}
          value={`${de(content.defense.save_pct)} %`}
          sub={t("ins.stDefenseSub", {
            s: deInt(content.defense.saved),
            n: deInt(content.defense.games),
          })}
          tone={content.defense.save_pct >= 18 ? "good" : undefined}
        />
        <Kpi
          label={t("ins.stBlunders")}
          value={benchmark.me == null ? "—" : de(benchmark.me.blunders_per_100)}
          sub={
            benchmark.field == null
              ? t("ins.stBlundersSub")
              : t("ins.stBlundersField", { f: de(benchmark.field.blunders_per_100) })
          }
          tone={
            benchmark.me && benchmark.field
              ? benchmark.me.blunders_per_100 <= benchmark.field.blunders_per_100
                ? "good"
                : "bad"
              : undefined
          }
        />
        <Kpi
          label={t("ins.stDecisive")}
          value={content.decisive.games === 0 ? "—" : t("ins.tmMoveNo", { n: de(content.decisive.avg_move) })}
          sub={t("ins.stDecisiveSub", {
            phase: phaseLabel(
              [...content.decisive.by_phase].sort((a, b) => b.games - a.games)[0]?.phase ?? "middlegame"
            ),
          })}
        />
      </div>

      <Section
        title={t("ins.stPhaseTitle")}
        summary={t("ins.stPhaseSummary", {
          phase: phaseLabel(
            [...live.phaseAccuracy]
              .filter((p) => p.accuracy != null)
              .sort((a, b) => a.accuracy! - b.accuracy!)[0]?.phase ?? "middlegame"
          ),
        })}
        defaultOpen
      >
        <div className="grid grid-cols-3 gap-3">
          {live.phaseAccuracy.map((phase) => (
            <div key={phase.phase} className="rounded-lg border border-line bg-panel2 p-4 text-center">
              <div className="text-[11.5px] text-ink3">{phaseLabel(phase.phase)}</div>
              <div className="mt-1 text-2xl font-semibold">
                {phase.accuracy == null ? "—" : `${de(phase.accuracy)} %`}
              </div>
              <div className="mt-1 text-[10.5px] text-ink3">
                {t("ins.phaseAccuracyGames", { n: phase.games })}
              </div>
            </div>
          ))}
        </div>
        {hasErrors && (
          <ResponsiveContainer width="100%" height={230}>
            <BarChart {...chartSurface} data={errorData} margin={{ top: 18, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="phase" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
              <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={barCursor} />
              <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inaccuracy" name={t("ins.legInaccuracies")} stackId="e" fill={chart.inaccuracy} />
              <Bar dataKey="mistake" name={t("ins.legMistakes")} stackId="e" fill={chart.mistake} />
              <Bar dataKey="blunder" name={t("ins.legBlunders")} stackId="e" fill={chart.blunder} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>

      <Section
        title={t("ins.stBenchTitle")}
        summary={
          benchmark.me && benchmark.field
            ? t("ins.stBenchSummary", {
                m: de(benchmark.me.blunders_per_100),
                f: de(benchmark.field.blunders_per_100),
                elo: deInt(benchmark.avg_opp_elo),
              })
            : undefined
        }
        disabled={benchmark.me == null || benchmark.field == null || benchmark.games < 10}
        disabledNote={t("ins.stBenchNeed")}
        defaultOpen
      >
        {benchmark.me && benchmark.field && (
          <div className="space-y-4">
            <Versus
              leftLabel={t("ins.stMe")}
              leftValue={benchmark.me.blunders_per_100}
              rightLabel={t("ins.stField")}
              rightValue={benchmark.field.blunders_per_100}
              lowerIsBetter
            />
            <ResponsiveContainer width="100%" height={230}>
              <BarChart {...chartSurface} data={benchData} margin={{ top: 18, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="phase" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} />
                <YAxis tick={chart.tick} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={barCursor} />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="me" name={t("ins.stMe")} fill={chart.accent} radius={[4, 4, 0, 0]} />
                <Bar dataKey="field" name={t("ins.stField")} fill={chart.axis} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
              <Stat
                label={t("ins.stAccuracyMe")}
                value={benchmark.me.accuracy == null ? "—" : `${de(benchmark.me.accuracy)} %`}
                hint={
                  benchmark.field.accuracy == null
                    ? undefined
                    : t("ins.stFieldValue", { v: de(benchmark.field.accuracy) })
                }
              />
              <Stat
                label={t("ins.stLossMe")}
                value={de(benchmark.me.avg_loss)}
                hint={t("ins.stFieldValue", { v: de(benchmark.field.avg_loss) })}
              />
              <Stat
                label={t("ins.stTroubleMe")}
                value={benchmark.me.trouble_pct == null ? "—" : `${de(benchmark.me.trouble_pct)} %`}
                hint={
                  benchmark.field.trouble_pct == null
                    ? undefined
                    : t("ins.stFieldValue", { v: de(benchmark.field.trouble_pct) })
                }
              />
              <Stat label={t("ins.games")} value={deInt(benchmark.games)} hint={t("ins.stBenchWindow")} />
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.stBenchNote")}</p>
          </div>
        )}
      </Section>

      <Section
        title={t("ins.stResultTitle")}
        summary={t("ins.stResultSummary", {
          c: de(content.conversion.score_pct),
          d: de(content.defense.save_pct),
        })}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 min-[700px]:grid-cols-4">
            <Stat
              label={t("ins.stWonPositions")}
              value={deInt(content.conversion.games)}
              hint={t("ins.stWonPositionsHint", {
                w: deInt(content.conversion.won),
                d: deInt(content.conversion.drawn),
                l: deInt(content.conversion.lost),
              })}
            />
            <Stat
              label={t("ins.stLostAt")}
              value={
                content.conversion.lost_at_move === 0
                  ? "—"
                  : t("ins.tmMoveNo", { n: de(content.conversion.lost_at_move) })
              }
              hint={t("ins.stLostAtHint", { phase: phaseLabel(content.conversion.phase) })}
            />
            <Stat
              label={t("ins.stSaved")}
              value={`${de(content.defense.save_pct)} %`}
              hint={t("ins.stSavedHint", { n: deInt(content.defense.games) })}
            />
            <Stat
              label={t("ins.stPunish")}
              value={`${de(content.punishment.missed_pct)} %`}
              hint={t("ins.stPunishHint", { n: deInt(content.punishment.chances) })}
            />
          </div>
          <div className="space-y-3">
            {content.decisive.by_phase.map((phase) => (
              <MetricBar
                key={phase.phase}
                label={phaseLabel(phase.phase)}
                note={t("ins.stDecidedIn", { n: deInt(phase.games) })}
                value={phase.share_pct}
                good={101}
                bad={101}
              />
            ))}
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.stResultNote")}</p>
        </div>
      </Section>

      <Section
        title={t("ins.stAnatomyTitle")}
        summary={t("ins.stAnatomySummary", {
          p: de(content.anatomy.forcing_pct),
          b: de(content.anatomy.forcing_base_pct),
        })}
        disabled={content.anatomy.errors < 15}
      >
        <div className="space-y-4">
          <Versus
            leftLabel={t("ins.stForcingMissed")}
            leftValue={content.anatomy.forcing_pct}
            rightLabel={t("ins.stForcingBase")}
            rightValue={content.anatomy.forcing_base_pct}
            unit=" %"
            lowerIsBetter
          />
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.stByPiece")}</div>
            <div className="space-y-3">
              {content.anatomy.by_piece
                .filter((piece) => piece.moves >= 40)
                .map((piece) => (
                  <MetricBar
                    key={piece.piece}
                    label={t(`ins.piece.${piece.piece}` as Key)}
                    note={t("ins.stPieceNote", { e: deInt(piece.errors), n: deInt(piece.moves) })}
                    value={piece.errors_per_100}
                    good={-1}
                    bad={-1}
                    max={Math.max(
                      2,
                      ...content.anatomy.by_piece.map((p) => (p.moves >= 40 ? p.errors_per_100 : 0))
                    )}
                  />
                ))}
            </div>
          </div>
          <Versus
            leftLabel={t("ins.stQuietLoss")}
            leftValue={content.anatomy.quiet_loss}
            rightLabel={t("ins.stForcingLoss")}
            rightValue={content.anatomy.forcing_loss}
            lowerIsBetter
          />
          <p className="text-[11.5px] leading-relaxed text-ink3">{t("ins.stAnatomyNote")}</p>
        </div>
      </Section>

      <Section
        title={t("ins.stEndgameTitle")}
        summary={t("ins.stEndgameSummary", { n: content.endgames.length })}
        disabled={content.endgames.length === 0}
      >
        <div className="space-y-3">
          {content.endgames
            .filter((type) => type.games >= 3)
            .map((type) => (
              <MetricBar
                key={type.key}
                label={t(`ins.endgame.${type.key}` as Key)}
                note={t("ins.stEndgameNote", {
                  n: deInt(type.games),
                  a: type.accuracy == null ? "—" : de(type.accuracy),
                })}
                value={type.score_pct}
              />
            ))}
        </div>
        <CoverageNote shown={content.games} total={coverage.games} unitKey="ins.unitGames" />
      </Section>

      <Section title={t("ins.stContextTitle")} summary={t("ins.stContextSummary")}>
        <div className="grid gap-5 min-[850px]:grid-cols-3">
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.oppStrengthTitle")}</div>
            <div className="space-y-3">
              {live.byOppStrength.map((bucket) => (
                <MetricBar
                  key={bucket.bucket}
                  label={bucket.bucket}
                  note={t("ins.gamesCount", { n: bucket.games })}
                  value={bucket.winRate}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.timeControlTitle")}</div>
            <div className="space-y-3">
              {live.byTimeControl.map((bucket) => (
                <MetricBar
                  key={bucket.tc}
                  label={bucket.tc}
                  note={t("ins.gamesCount", { n: bucket.games })}
                  value={bucket.winRate}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[12px] text-ink3">{t("ins.lengthTitle")}</div>
            <div className="space-y-3">
              {live.byLength.map((bucket) => (
                <MetricBar
                  key={bucket.bucket}
                  label={bucket.bucket}
                  note={t("ins.gamesCount", { n: bucket.games })}
                  value={bucket.scorePct}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
