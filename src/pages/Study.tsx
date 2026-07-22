import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Cpu,
  Flame,
  Lightbulb,
  Puzzle as PuzzleIcon,
  TrendingDown,
} from "lucide-react";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
import { errorStats, type PhaseErrors } from "../lib/analysis";
import { puzzleStats, themeLabel, type ThemeStat } from "../lib/puzzles";
import { studyData, dayUnits, type StudyData } from "../lib/study";
import { buildCoach } from "../lib/coach";
import { Button, Card } from "../components/ui";
import StudyPlanner from "../components/StudyPlanner";
import { dateLocale, de, deInt } from "../lib/util";
import type { PageId } from "../App";

const DAY = 86_400;

const PHASE_KEY: Record<"opening" | "middlegame" | "endgame", Key> = {
  opening: "st.recPhaseOpening",
  middlegame: "st.recPhaseMiddlegame",
  endgame: "st.recPhaseEndgame",
};

interface RecCard {
  id: string;
  icon: typeof BookOpen;
  title: string;
  body: string;
  action: { label: string; onClick: () => void } | null;
}

export default function Study({
  go,
  openPuzzles,
}: {
  go: (p: PageId) => void;
  openPuzzles: (theme?: string) => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";

  const [live, setLive] = useState<StudyData | null>(null);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [themes, setThemes] = useState<ThemeStat[]>([]);
  const [phaseErrors, setPhaseErrors] = useState<PhaseErrors[]>([]);

  useEffect(() => {
    if (!desktop) return;
    studyData().then(setLive).catch(() => {});
    listGames().then(setRecords).catch(() => {});
    puzzleStats().then((s) => setThemes(s.themes)).catch(() => {});
    errorStats().then(setPhaseErrors).catch(() => {});
  }, [desktop]);

  // Web-Preview: statische Demo-Daten, damit das Layout erlebbar bleibt.
  const demo: StudyData = useMemo(() => {
    const today = Math.floor(Date.now() / 1000 / DAY);
    const pz = [12, 0, 8, 15, 5, 9, 6];
    const eg = [0, 0, 2, 1, 0, 3, 0];
    const rep = [10, 0, 6, 12, 0, 8, 14];
    return {
      due_now: 14,
      due_week: [14, 6, 9, 4, 11, 3, 7],
      unanalyzed: 4,
      today_puzzle_attempts: 6,
      puzzle_goal: 20,
      activity: pz.map((p, i) => ({
        day_ts: (today - 6 + i) * DAY,
        puzzle_attempts: p,
        endgame_attempts: eg[i],
        rep_reviews: rep[i],
      })),
      streak_days: 3,
    };
  }, []);
  const data = desktop ? live : demo;

  // ── Coach-Empfehlungen ─────────────────────────────────────────────────────
  const coach = useMemo(
    () => buildCoach(records, themes, phaseErrors),
    [records, themes, phaseErrors]
  );

  const recs: RecCard[] = useMemo(() => {
    if (!desktop) {
      return [
        {
          id: "demo-opening",
          icon: BookOpen,
          title: t("st.recOpening", { name: "Sicilian Defense Bowdler Attack" }),
          body: t("st.recOpeningBody", { p: de(38.5), n: 24 }),
          action: { label: t("st.toRepertoire"), onClick: () => go("repertoire") },
        },
        {
          id: "demo-tilt",
          icon: Clock,
          title: t("st.recTilt", { slot: "20–24" }),
          body: t("st.recTiltBody", { p: 31, n: 41, o: 44 }),
          action: null,
        },
      ];
    }
    const out: RecCard[] = [];
    for (const o of coach.openings) {
      out.push({
        id: `opening-${o.name}`,
        icon: BookOpen,
        title: t("st.recOpening", { name: o.name }),
        body: t("st.recOpeningBody", { p: de(o.scorePct), n: deInt(o.games) }),
        action: { label: t("st.toRepertoire"), onClick: () => go("repertoire") },
      });
    }
    if (coach.motif) {
      const m = coach.motif;
      out.push({
        id: `motif-${m.theme}`,
        icon: PuzzleIcon,
        title: t("st.recMotif", { theme: themeLabel(m.theme, locale) }),
        body: t("st.recMotifBody", { p: m.solvedPct, n: deInt(m.attempts) }),
        action: { label: t("st.toPuzzles"), onClick: () => openPuzzles(m.theme) },
      });
    }
    if (coach.phase) {
      const p = coach.phase;
      const action =
        p.phase === "endgame"
          ? { label: t("st.toEndgame"), onClick: () => go("endgame") }
          : p.phase === "opening"
            ? { label: t("st.toRepertoire"), onClick: () => go("repertoire") }
            : { label: t("st.toPuzzles"), onClick: () => openPuzzles() };
      out.push({
        id: `phase-${p.phase}`,
        icon: TrendingDown,
        title: t(PHASE_KEY[p.phase]),
        body: t("st.recPhaseBody", {
          b: deInt(p.blunders),
          m: deInt(p.mistakes),
          p: p.sharePct,
        }),
        action,
      });
    }
    if (coach.tilt) {
      const ti = coach.tilt;
      out.push({
        id: "tilt",
        icon: Clock,
        title: t("st.recTilt", { slot: ti.slot }),
        body: t("st.recTiltBody", { p: ti.winPct, n: deInt(ti.games), o: ti.overallPct }),
        action: null,
      });
    }
    return out;
  }, [desktop, coach, locale, t, go, openPuzzles]);

  // ── Tagesplan ──────────────────────────────────────────────────────────────
  const tasks = useMemo(() => {
    if (!data) return [];
    return [
      {
        id: "reviews",
        icon: BookOpen,
        label: t("st.taskReviews"),
        progress: t("st.due", { n: deInt(data.due_now) }),
        done: data.due_now === 0,
        btn: t("dash.train"),
        onClick: () => go("repertoire"),
      },
      {
        id: "puzzles",
        icon: PuzzleIcon,
        label: t("st.taskPuzzles"),
        progress: `${deInt(data.today_puzzle_attempts)} / ${deInt(data.puzzle_goal)}`,
        done: data.today_puzzle_attempts >= data.puzzle_goal,
        btn: t("dash.solve"),
        onClick: () => openPuzzles(),
      },
      {
        id: "analysis",
        icon: Cpu,
        label: t("st.taskAnalysis"),
        progress: t("st.gamesPending", { n: deInt(data.unanalyzed) }),
        done: data.unanalyzed === 0,
        btn: t("dash.start"),
        onClick: () => go("analysis"),
      },
    ];
  }, [data, t, go, openPuzzles]);
  const allDone = tasks.length > 0 && tasks.every((task) => task.done);

  // ── Wochenkalender (Mo–So, UTC-Tage wie im Backend) ────────────────────────
  const week = useMemo(() => {
    if (!data) return [];
    const todayDay = Math.floor(Date.now() / 1000 / DAY);
    const monday = todayDay - ((todayDay + 3) % 7); // Tag 0 (1970-01-01) war ein Donnerstag
    return [...Array(7)].map((_, i) => {
      const day = monday + i;
      const date = new Date(day * DAY * 1000);
      const act = data.activity.find((a) => Math.floor(a.day_ts / DAY) === day);
      const units = act ? dayUnits(act) : 0;
      const dueOffset = day - todayDay;
      return {
        day,
        label: date.toLocaleDateString(dateLocale(), { weekday: "short" }),
        dayNum: date.getUTCDate(),
        isToday: day === todayDay,
        isFuture: day > todayDay,
        units,
        due: dueOffset >= 0 && dueOffset < 7 ? data.due_week[dueOffset] : 0,
      };
    });
  }, [data]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("st.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("st.subtitle")}</p>
        </div>
        {data && data.streak_days > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
            <Flame size={15} className="text-gold" />
            <span className="font-medium">{t("st.streak", { n: deInt(data.streak_days) })}</span>
          </div>
        )}
      </header>

      {!desktop && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("st.webNote")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        {/* Coach */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Lightbulb size={14} className="text-gold" /> {t("st.coach")}
            </span>
          }
          className="min-[1100px]:col-span-2"
        >
          {recs.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {recs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <r.icon size={17} className="mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-ink">{r.title}</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">{r.body}</div>
                    </div>
                  </div>
                  {r.action && (
                    <Button onClick={r.action.onClick} className="shrink-0">
                      {r.action.label}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-2 text-[13px] leading-relaxed text-ink3">{t("st.coachEmpty")}</p>
          )}
        </Card>

        {/* Heute */}
        <Card title={t("st.today")}>
          <div className="flex flex-col gap-2.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                  task.done ? "border-accent-dim bg-accent-soft/40" : "border-line bg-panel2"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {task.done ? (
                    <CheckCircle2 size={17} className="shrink-0 text-win" />
                  ) : (
                    <task.icon size={17} className="shrink-0 text-ink3" />
                  )}
                  <div className="min-w-0">
                    <div className={`text-[13px] ${task.done ? "text-ink3" : "text-ink"}`}>
                      {task.label}
                    </div>
                    <div className="text-[12px] text-ink3">{task.progress}</div>
                  </div>
                </div>
                {task.done ? (
                  <span className="shrink-0 text-[12px] font-medium text-win">
                    {t("st.doneLabel")}
                  </span>
                ) : (
                  <Button onClick={task.onClick} className="shrink-0">
                    {task.btn}
                  </Button>
                )}
              </div>
            ))}
            {allDone && (
              <div className="rounded-lg border border-accent-dim bg-accent-soft px-3 py-2.5 text-[12.5px] font-medium text-accent">
                {t("st.allDone")}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Woche */}
      <Card title={t("st.week")} className="mt-4">
        <div className="grid grid-cols-7 gap-2">
          {week.map((d) => (
            <div
              key={d.day}
              className={`rounded-lg border px-2 py-2.5 text-center ${
                d.isToday ? "border-accent-dim bg-accent-soft" : "border-line bg-panel2"
              }`}
            >
              <div className="text-[11px] uppercase tracking-wide text-ink3">
                {d.label} {d.dayNum}
              </div>
              {d.isFuture ? (
                <>
                  <div className={`mt-1.5 text-[20px] font-semibold leading-none ${d.due > 0 ? "text-gold" : "text-ink3"}`}>
                    {d.due > 0 ? deInt(d.due) : "—"}
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink3">
                    {d.due > 0 ? t("st.dueLabel") : " "}
                  </div>
                </>
              ) : (
                <>
                  <div className={`mt-1.5 text-[20px] font-semibold leading-none ${d.units > 0 ? "text-ink" : "text-ink3"}`}>
                    {d.units > 0 ? deInt(d.units) : "—"}
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink3">
                    {d.units > 0
                      ? t(d.units === 1 ? "st.units.one" : "st.units.many")
                      : " "}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("st.weekNote")}</p>
      </Card>

      <StudyPlanner desktop={desktop} />
    </div>
  );
}
