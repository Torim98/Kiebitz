import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  type TooltipProps,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, BookOpen, Cpu, Puzzle } from "lucide-react";
import { games as demoGames, profile, ratings, ratingHistory, repertoireStats, puzzleStats } from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
import { getSettings } from "../lib/settings";
import { repStats, type RepStats } from "../lib/repertoire";
import { puzzleStats as fetchPuzzleStats, type PuzzleStats } from "../lib/puzzles";
import { buildDashboard, type HistoryPoint, type RatingHistorySeries } from "../lib/stats";
import type { GamesFilter, UiGame } from "../lib/gameUi";
import { Card, ExtLink, GameCard, ResultBadge, SourceBadge, Spark, Button } from "../components/ui";
import { useMobileShell } from "../components/MobileShell";
import { chart } from "../components/chartTheme";
import { dateLocale, de, deInt } from "../lib/util";
import type { PageId } from "../App";
import { isStoreCapture } from "../lib/storeCapture";

/**
 * Tooltip des Ratingverlaufs. Die Linie hat mehrere Stützpunkte je Monat,
 * abgelesen wird aber weiterhin genau ein Wert je Serie und Monat · alles
 * andere wäre eine Genauigkeit, die die Zahl nicht hergibt.
 */
function MonthTooltip({
  active,
  payload,
  series,
  colors,
}: TooltipProps<number, string> & {
  series: RatingHistorySeries[];
  colors: Record<string, string>;
}) {
  const point = payload?.[0]?.payload as HistoryPoint | undefined;
  if (!active || !point) return null;
  const rows = series.filter((s) => point.monthly?.[s.key] != null);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 shadow-xl">
      <div className="mb-1 text-[11.5px] text-ink3">{point.monthLabel}</div>
      {rows.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-[12.5px] text-ink">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: colors[s.id] ?? chart.draw }}
          />
          <span className="text-ink2">{s.label}:</span>
          <span className="font-medium">{deInt(point.monthly[s.key]!)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({
  go,
  openAnalysis,
  openGames,
}: {
  go: (p: PageId) => void;
  openAnalysis: (gameId: number) => void;
  openGames: (filter?: GamesFilter) => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const mobile = useMobileShell();
  const [records, setRecords] = useState<GameRecord[] | null>(null);
  const [rep, setRep] = useState<RepStats | null>(null);
  const [pz, setPz] = useState<PuzzleStats | null>(null);
  // Desktop startet ohne Demo-Konto; die echten Werte kommen aus den Settings.
  const [users, setUsers] = useState(
    backend.mode === "desktop"
      ? { cc: "", li: "", name: "" }
      : { cc: profile.ccUser, li: profile.liUser, name: "" }
  );
  const [goal, setGoal] = useState(puzzleStats.todayGoal);

  useEffect(() => {
    if (backend.mode === "desktop") {
      listGames().then(setRecords).catch(() => setRecords(null));
      repStats().then(setRep).catch(() => {});
      fetchPuzzleStats().then(setPz).catch(() => {});
      getSettings()
        .then((s) => {
          setUsers({ cc: s.cc_user, li: s.li_user, name: s.display_name });
          setGoal(s.puzzle_goal);
        })
        .catch(() => {});
    }
  }, [backend.mode]);

  const live = records !== null && records.length > 0;
  const dash = useMemo(
    () =>
      live ? buildDashboard(records!, { locale, ccUser: users.cc, liUser: users.li }) : null,
    [live, records, locale, users]
  );

  const cards = dash
    ? dash.cards
    : ratings.map((r) => ({ id: r.id, platform: r.platform, tc: r.tc, value: r.value, delta: r.delta, spark: r.spark, url: r.url }));

  const recent: UiGame[] = dash ? dash.recent : demoGames.slice(0, 5);
  const unanalyzed = dash ? dash.unanalyzed : demoGames.filter((g) => !g.analyzed).length;
  const history: HistoryPoint[] = dash ? dash.history : ratingHistory.map((point, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (ratingHistory.length - 1 - index));
    const monthLabel = date.toLocaleDateString(locale === "de" ? "de-DE" : "en-US", { month: "short" });
    return {
      ...point,
      month: monthLabel,
      monthLabel,
      monthly: { cc: point.cc, li: point.li },
    };
  });
  const historySeries: RatingHistorySeries[] = dash?.historySeries ?? [
    { key: "cc", id: "cc", platform: "chess.com" as const, timeClass: "rapid", label: "chess.com" },
    { key: "li", id: "li", platform: "lichess" as const, timeClass: "rapid", label: "lichess" },
  ];
  const historyColors: Record<string, string> = {
    "chess.com-rapid": chart.cc,
    "chess.com-blitz": chart.gold,
    "chess.com-bullet": chart.mistake,
    "chess.com-daily": chart.violet,
    "lichess-rapid": chart.li,
    "lichess-blitz": chart.accent,
    "lichess-bullet": chart.loss,
    "lichess-daily": "#b09bea",
    cc: chart.cc,
    li: chart.li,
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? t("dash.goodMorning") : h < 18 ? t("dash.goodDay") : t("dash.goodEvening");
  })();
  const name = storeCapture
    ? "Alex"
    : backend.mode === "desktop" ? users.name || users.cc || users.li : profile.name;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{greeting}, {name}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {live ? t("dash.gamesInDb", { n: deInt(records!.length) }) : storeCapture ? "" : t("dash.demoData")}
          </p>
        </div>
        {!storeCapture && <div className="flex gap-2">
          <ExtLink href={`https://www.chess.com/member/${users.cc}`} label="chess.com" />
          <span className="text-line2">·</span>
          <ExtLink href={`https://lichess.org/@/${users.li}`} label="lichess" />
        </div>}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        {cards.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-line bg-panel p-4"
          >
            <div className="mb-2 flex items-center justify-between">
              <SourceBadge source={r.platform} />
              <span className="text-[11.5px] text-ink3">{r.tc}</span>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[26px] font-semibold leading-none tracking-tight">{r.value}</div>
                <div
                  className="mt-1.5 flex items-center gap-1 text-[12px]"
                  style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                >
                  {r.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                  {r.delta >= 0 ? "+" : ""}
                  {r.delta} · {t("dash.days30")}
                </div>
              </div>
              <span className="hidden min-[440px]:block">
                <Spark data={r.spark} color={r.platform === "chess.com" ? chart.cc : chart.li} />
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        <Card
          title={live ? t("dash.ratingHistoryLive") : t("dash.ratingHistoryDemo")}
          className="min-[1100px]:col-span-2"
        >
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={history} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="month" tick={chart.tick} tickLine={false} axisLine={{ stroke: chart.axis }} interval={0} />
              <YAxis domain={live ? ["auto", "auto"] : [1340, 1560]} tick={chart.tick} tickLine={false} axisLine={false} />
              <Tooltip
                content={<MonthTooltip series={historySeries} colors={historyColors} />}
                cursor={{ stroke: chart.axis }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={28}
                iconType="plainline"
                formatter={(v) => <span className="text-[12px] text-ink2">{v}</span>}
              />
              {historySeries.map((series) => (
                // Bewusst „linear": der Verlauf soll springen wie die
                // Sparklines der Karten, statt eine Kurve zu behaupten, die
                // zwischen zwei Partien niemand gespielt hat.
                <Line
                  key={series.id}
                  type="linear"
                  dataKey={series.key}
                  name={series.label}
                  stroke={historyColors[series.id] ?? chart.draw}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <BookOpen size={15} className="text-accent" /> {t("dash.repTraining")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {rep ? rep.due_now : repertoireStats.dueToday}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.dueReviews")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">
                  {rep
                    ? t("dash.repSummary", { n: rep.my_positions, p: de(rep.coverage_pct) })
                    : t("dash.streak", { n: repertoireStats.streak })}
                </div>
              </div>
              <Button primary onClick={() => go("repertoire")}>{t("dash.train")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Cpu size={15} className="text-violet" /> {t("dash.analysisQueue")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {deInt(unanalyzed)}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.gamesWithoutAnalysis")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">{t("dash.stockfishNative")}</div>
              </div>
              <Button onClick={() => go("analysis")}>{t("dash.start")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Puzzle size={15} className="text-gold" /> {t("dash.puzzleGoal")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {pz ? pz.today_attempts : puzzleStats.todaySolved}
                  <span className="text-[15px] font-normal text-ink3"> / {pz ? goal : puzzleStats.todayGoal}</span>
                </div>
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-panel3">
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{
                      width: `${Math.min(100, ((pz ? pz.today_attempts : puzzleStats.todaySolved) / (pz ? goal : puzzleStats.todayGoal)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <Button onClick={() => go("puzzles")}>{t("dash.solve")}</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card title={t("dash.recentGames")} className="mt-4" pad={false}
        action={<button onClick={() => openGames()} className="text-[12.5px] text-ink3 hover:text-accent">{t("dash.showAll")}</button>}
      >
        {mobile ? (
          // Auf Handybreite wird aus jeder Zeile eine Karte · die achtspaltige
          // Tabelle liesse sich sonst nur quer scrollend lesen.
          <div>
            {recent.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onClick={g.dbId != null ? () => openAnalysis(g.dbId!) : undefined}
              />
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <tbody>
            {recent.map((g) => {
              const filterTo = (e: MouseEvent, f: GamesFilter) => {
                e.stopPropagation();
                openGames(f);
              };
              const openable = g.dbId != null;
              return (
                <tr
                  key={g.id}
                  onClick={() => openable && openAnalysis(g.dbId!)}
                  title={openable ? t("dash.openInAnalysis") : undefined}
                  className={`border-b border-line last:border-0 hover:bg-panel2 ${
                    openable ? "cursor-pointer" : ""
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <button
                      onClick={(e) => filterTo(e, { date: g.date })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.date}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { source: g.source })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <SourceBadge source={g.source} />
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { tc: g.tc })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.tc}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opponent: g.opponent })}
                      className="text-ink transition-colors hover:text-accent"
                    >
                      {g.opponent}
                    </button>
                    <span className="ml-1.5 text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opening: g.opening })}
                      className="text-left text-ink2 transition-colors hover:text-accent"
                    >
                      {g.opening}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { result: g.result })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <ResultBadge result={g.result} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <ExtLink
                      href={
                        g.url ??
                        (g.source === "chess.com"
                          ? `https://www.chess.com/games/archive/${users.cc}`
                          : `https://lichess.org/@/${users.li}/all`)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </Card>
    </div>
  );
}
