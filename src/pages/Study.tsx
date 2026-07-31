import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CalendarPlus,
  CheckCircle2,
  Cpu,
  Crown,
  Flame,
  Gauge,
  Lightbulb,
  Puzzle as PuzzleIcon,
  Timer,
} from "lucide-react";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { listGames, type GameRecord } from "../lib/db";
import { puzzleInsights, type PuzzleInsights } from "../lib/puzzles";
import {
  closeStudyFocus,
  getStudyCalendar,
  scheduleStudyUnit,
  setStudyFocus,
  studyData,
  trainingProgram,
  type Area,
  type StudyData,
  type StudyFocus,
  type StudyTemplate,
  type TrainingProgram,
} from "../lib/study";
import { getSettings, trainingDayList } from "../lib/settings";
import { buildInsights } from "../lib/stats";
import { deepInsights, studyMetrics, type DeepInsights, type MetricWindow } from "../lib/insights";
import { buildFindings, type Finding } from "../lib/findings";
import { buildPlan, buildWeekPlan, type PlannedUnit, type TrainingPlan } from "../lib/plan";
import {
  cycleWindows,
  measureEffect,
  measureRating,
  ratingNoise,
  type EffectResult,
  type RatingEffect,
} from "../lib/effect";
import { Button, Card } from "../components/ui";
import StudyPlanner from "../components/StudyPlanner";
import StudyFocusCard from "../components/StudyFocusCard";
import AllocationBars from "../components/AllocationBars";
import { useMobileShell } from "../components/MobileShell";
import { onDataChange } from "../lib/changes";
import { de, deInt } from "../lib/util";
import { isStoreCapture } from "../lib/storeCapture";
import { DEMO_PLAN_STATE } from "./studyDemo";
import { ENDGAME_TYPE_CATEGORY, type EndgameCategory } from "../data/endgames";
import type { PageId } from "../App";

const DAY = 86_400;

export interface StudyState {
  data: StudyData | null;
  program: TrainingProgram | null;
  plan: TrainingPlan | null;
  findings: Finding[];
  windows: Map<number, { before: MetricWindow; after: MetricWindow }>;
  templates: StudyTemplate[];
  rating: RatingEffect | null;
  /** Trainingstage aus den Einstellungen, Index 0 = Montag. */
  trainingDays: boolean[];
}

export default function Study({
  go,
  openPuzzles,
  openEndgame,
}: {
  go: (p: PageId) => void;
  openPuzzles: (theme?: string, band?: { minRating?: number; maxRating?: number }) => void;
  openEndgame?: (category?: EndgameCategory) => void;
}) {
  const backend = useBackendInfo();
  // Mobil ist diese Seite auch der Einstieg zu Repertoire, Puzzles und
  // Endspielen · am Desktop stehen die in der Sidebar.
  const mobile = useMobileShell();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";
  const storeCapture = isStoreCapture();
  const now = Math.floor(Date.now() / 1000);

  const [state, setState] = useState<StudyState | null>(null);
  const [planning, setPlanning] = useState<PlannedUnit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Bewusst hier und nicht aus dem Render-Scope: `load` hängt an einem
    // Änderungs-Abo und läuft womöglich Stunden später erneut. Mit einem
    // eingefrorenen Zeitpunkt endete das Nachher-Fenster beim Öffnen der Seite,
    // und genau die Partien, die seither dazukamen, fehlten in der Messung.
    const now = Math.floor(Date.now() / 1000);
    const [data, program, records, deep, puzzles, settings] = await Promise.all([
      studyData().catch(() => null),
      trainingProgram().catch(() => null),
      listGames().catch(() => [] as GameRecord[]),
      deepInsights().catch(() => null),
      puzzleInsights().catch(() => null as PuzzleInsights | null),
      getSettings().catch(() => null),
    ]);
    const live = buildInsights(records, locale);
    const findings = deep ? buildFindings(deep, live) : [];
    const trainingDays = trainingDayList(settings?.training_days ?? 0);
    const plan =
      deep && settings
        ? buildPlan({
            deep,
            live,
            findings,
            puzzles,
            program,
            weeklyMinutes: settings.weekly_minutes,
            trainingDays,
          })
        : null;

    // Für jeden laufenden Zyklus zwei gleich lange Fenster · davor und seither.
    // Die Reihenfolge der Fenster bleibt an die Fokusse gekoppelt, damit die
    // Zuordnung nicht über Indizes rät.
    const focuses = program?.focuses ?? [];
    const specs = focuses.flatMap((focus) => {
      const { before, after } = cycleWindows(focus.start_ts, focus.cycle_days, now);
      return [before, after];
    });
    const measured = specs.length > 0 ? await studyMetrics(specs).catch(() => []) : [];
    const windows = new Map<number, { before: MetricWindow; after: MetricWindow }>();
    focuses.forEach((focus, index) => {
      const before = measured[index * 2];
      const after = measured[index * 2 + 1];
      if (before && after) windows.set(focus.id, { before, after });
    });

    const templates = await getStudyCalendar(isoDay(new Date()), isoDay(new Date()))
      .then((calendar) => calendar.templates)
      .catch(() => [] as StudyTemplate[]);

    setState({
      data,
      program,
      plan,
      findings,
      windows,
      templates,
      rating: measureRating(measured),
      trainingDays,
    });
  }, [locale]);

  useEffect(() => {
    if (!desktop) {
      setState(DEMO_PLAN_STATE(locale));
      return;
    }
    load().catch(() => setState(null));
    return onDataChange(() => {
      load().catch(() => {});
    });
    // `now` ändert sich bei jedem Render · als Abhängigkeit würde es eine
    // Endlosschleife bauen. Neu geladen wird über `onDataChange`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, locale]);

  const plan = state?.plan ?? null;
  const data = state?.data ?? null;
  const focusByArea = useMemo(() => {
    const map = new Map<Area, StudyFocus>();
    for (const focus of state?.program?.focuses ?? []) map.set(focus.area, focus);
    return map;
  }, [state]);

  const effectFor = useCallback(
    (focus: StudyFocus | null, metricKey?: string): EffectResult | null => {
      if (!focus || !metricKey) return null;
      const pair = state?.windows.get(focus.id);
      if (!pair) return null;
      return measureEffect(metricKey, pair.before, pair.after);
    },
    [state]
  );

  // ── Aktionen ───────────────────────────────────────────────────────────────

  const startFocus = async (area: Area, metricKey: string | undefined, label: string) => {
    if (!desktop || !metricKey) return;
    setBusy(true);
    try {
      const settings = await getSettings().catch(() => null);
      await setStudyFocus({
        area,
        metric_key: metricKey,
        label_params: JSON.stringify({ name: label }),
        cycle_days: settings?.focus_cycle_days ?? 14,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const stopFocus = async (focus: StudyFocus) => {
    if (!desktop) return;
    setBusy(true);
    try {
      await closeStudyFocus(focus.id, "dropped");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const proposePlan = () => {
    if (!plan || !state) return;
    const monday = mondayOf(new Date());
    setPlanning(
      buildWeekPlan(
        plan.allocation,
        state.templates,
        data?.due_week ?? [],
        state.trainingDays,
        monday
      )
    );
  };

  const applyPlan = async () => {
    if (!planning || !desktop) return;
    setBusy(true);
    try {
      // Nacheinander, nicht parallel: die Positionen innerhalb eines Tages
      // werden beim Anlegen fortlaufend vergeben.
      for (const unit of planning) {
        await scheduleStudyUnit(unit.templateId, unit.day);
      }
      setPlanning(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ── Tagesplan ──────────────────────────────────────────────────────────────

  const dose = plan?.dose ?? null;
  const tasks = useMemo(() => {
    if (!data) return [];
    const puzzleTarget = dose ? dose.perDay : data.puzzle_goal;
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
        progress: `${deInt(data.today_puzzle_attempts)} / ${deInt(puzzleTarget)}`,
        done: data.today_puzzle_attempts >= puzzleTarget,
        btn: t("dash.solve"),
        onClick: () =>
          openPuzzles(dose?.theme, dose ? { minRating: dose.minRating, maxRating: dose.maxRating } : undefined),
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
  }, [data, dose, t, go, openPuzzles]);
  const allDone = tasks.length > 0 && tasks.every((task) => task.done);

  const areas = useMemo(
    () => [
      {
        id: "repertoire" as const,
        icon: BookOpen,
        label: t("nav.repertoire"),
        status: data ? t("st.due", { n: deInt(data.due_now) }) : "",
        onClick: () => go("repertoire"),
      },
      {
        id: "puzzles" as const,
        icon: PuzzleIcon,
        label: t("nav.puzzles"),
        status: data
          ? `${deInt(data.today_puzzle_attempts)} / ${deInt(dose?.perDay ?? data.puzzle_goal)}`
          : "",
        onClick: () => openPuzzles(),
      },
      {
        id: "endgame" as const,
        icon: Crown,
        label: t("nav.endgame"),
        status: t("st.areaEndgame"),
        onClick: () => go("endgame"),
      },
    ],
    [data, dose, t, go, openPuzzles]
  );

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("st.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("st.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state?.rating && (
            <div
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]"
              title={t(
                state.rating.confidence === "measured" ? "plan.ratingExact" : "plan.ratingApprox"
              )}
            >
              <Gauge size={15} className="text-violet" />
              <span className="font-medium tabular-nums">
                {t("plan.ratingDelta", {
                  d: `${state.rating.delta > 0 ? "+" : ""}${deInt(state.rating.delta)}`,
                })}
              </span>
              <span className="text-ink3">
                {Math.abs(state.rating.delta) <= ratingNoise(state.rating.games)
                  ? t("plan.ratingNoise")
                  : t("plan.ratingPools", { n: state.rating.pools })}
              </span>
            </div>
          )}
          {data && data.streak_days > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
              <Flame size={15} className="text-gold" />
              <span className="font-medium">{t("st.streak", { n: deInt(data.streak_days) })}</span>
            </div>
          )}
        </div>
      </header>

      {!desktop && !storeCapture && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("st.webNote")}
        </div>
      )}

      {mobile && (
        <nav aria-label={t("st.areas")} className="mb-4 grid grid-cols-3 gap-2">
          {areas.map((area) => (
            <button
              key={area.id}
              onClick={area.onClick}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-panel px-2 py-3 text-center transition-colors hover:bg-panel2"
            >
              <area.icon size={19} className="text-accent" />
              <span className="max-w-full truncate text-[12.5px] font-medium text-ink">
                {area.label}
              </span>
              <span className="text-[11px] leading-tight text-ink3">{area.status}</span>
            </button>
          ))}
        </nav>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        {/* Fokusse */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Lightbulb size={14} className="text-gold" /> {t("st.coach")}
            </span>
          }
          className="min-[1100px]:col-span-2"
        >
          {plan && plan.prescriptions.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {plan.prescriptions.map((prescription) => {
                const focus = focusByArea.get(prescription.area) ?? null;
                return (
                  <StudyFocusCard
                    key={prescription.id}
                    prescription={prescription}
                    focus={focus}
                    effect={effectFor(focus, prescription.metricKey ?? focus?.metric_key)}
                    now={now}
                    mobile={mobile}
                    onStart={() =>
                      !busy &&
                      startFocus(
                        prescription.area,
                        prescription.metricKey,
                        String(prescription.finding.params.name ?? "")
                      )
                    }
                    onStop={() => focus && !busy && stopFocus(focus)}
                    onAction={() => {
                      const action = prescription.action;
                      if (!action) return;
                      if (action.kind === "puzzles") {
                        openPuzzles(action.theme, {
                          minRating: action.minRating,
                          maxRating: action.maxRating,
                        });
                      } else if (action.kind === "repertoire") go("repertoire");
                      else if (action.kind === "endgame") {
                        // Der Befund nennt den Endspieltyp aus der
                        // Materialsignatur · daraus wird die Drill-Kategorie.
                        const type = prescription.finding.params.type;
                        const category =
                          typeof type === "string" ? ENDGAME_TYPE_CATEGORY[type] : undefined;
                        if (openEndgame) openEndgame(category);
                        else go("endgame");
                      } else if (action.kind === "analysis") go("analysis");
                      else go("games");
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <p className="py-2 text-[13px] leading-relaxed text-ink3">{t("st.coachEmpty")}</p>
          )}
          {state && state.findings.length > (plan?.prescriptions.length ?? 0) && (
            <button
              type="button"
              onClick={() => go("insights")}
              className="mt-3 w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] text-ink3 transition-colors hover:border-line2 hover:text-ink"
            >
              {t("st.allFindings", { n: state.findings.length })}
            </button>
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

      {/* Budget und Spielhygiene */}
      {plan && (
        <div className="mt-4 grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
          <Card
            title={
              <span className="flex items-center gap-2">
                <Gauge size={14} className="text-accent" /> {t("plan.allocTitle")}
              </span>
            }
            className="min-[1100px]:col-span-2"
          >
            <AllocationBars allocation={plan.allocation} weeklyMinutes={plan.weeklyMinutes} />
            {!plan.budgetFromSettings && (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">
                {t("plan.budgetObserved")}
              </p>
            )}
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                <Timer size={14} className="text-gold" /> {t("plan.hygieneTitle")}
              </span>
            }
          >
            {plan.hygiene.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {plan.hygiene.map((tip) => (
                  <li
                    key={tip.id}
                    className="rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] leading-relaxed text-ink2"
                  >
                    {t(tip.key, tip.params)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-[12.5px] leading-relaxed text-ink3">
                {t("plan.hygieneEmpty")}
              </p>
            )}
          </Card>
        </div>
      )}

      {/* Wochenplan-Vorschlag */}
      {desktop && plan && (
        <div className="mt-4">
          {planning == null ? (
            <button
              type="button"
              onClick={proposePlan}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line2 px-4 py-3 text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
            >
              <CalendarPlus size={15} /> {t("plan.proposeWeek")}
            </button>
          ) : (
            <Card title={t("plan.proposalTitle")}>
              {planning.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-ink3">{t("plan.proposalEmpty")}</p>
              ) : (
                <>
                  <p className="mb-3 text-[12.5px] leading-relaxed text-ink3">
                    {t("plan.proposalNote", { n: planning.length })}
                  </p>
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {planning.map((unit, index) => (
                      <li
                        key={`${unit.day}-${unit.templateId}-${index}`}
                        className="flex items-baseline justify-between gap-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px]"
                      >
                        <span className="tabular-nums text-ink3">{unit.day}</span>
                        <span className="min-w-0 flex-1 truncate text-ink2">
                          {unit.templateTitle}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink3">
                          {t("plan.minutes", { m: unit.minutes })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {planning.length > 0 && (
                  <Button onClick={applyPlan} disabled={busy}>
                    {t("plan.proposalApply")}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setPlanning(null)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink3 transition-colors hover:text-ink"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Wochenkalender: erledigte Einheiten, Fälligkeiten und geplante Units. */}
      <StudyPlanner desktop={desktop} />
    </div>
  );
}

// ── Kleine Helfer ────────────────────────────────────────────────────────────

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
}

export { DAY };
