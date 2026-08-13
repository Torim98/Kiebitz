import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CalendarPlus,
  Cpu,
  Crown,
  Flame,
  Gauge,
  Lightbulb,
  Puzzle as PuzzleIcon,
  Timer,
} from "lucide-react";
import { useBackendInfo } from "../lib/backend";
import { isoDay } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { listGameSummaries, type GameSummary } from "../lib/db";
import { puzzleInsights, type PuzzleInsights } from "../lib/puzzles";
import {
  closeStudyFocus,
  getStudyCalendar,
  scheduleStudyUnit,
  setStudyFocus,
  studyData,
  templateText,
  trainingProgram,
  type Area,
  type StudyData,
  type StudyEvent,
  type StudyFocus,
  type StudyTemplate,
  type TrainingProgram,
} from "../lib/study";
import { getSettings, trainingDayList } from "../lib/settings";
import { buildInsights } from "../lib/stats";
import { deepInsights, studyMetrics, type MetricWindow } from "../lib/insights";
import { buildFindings, localizeFindingParams, type Finding } from "../lib/findings";
import {
  buildPlan,
  buildWeekPlan,
  templateArea,
  type PlannedUnit,
  type TrainingPlan,
} from "../lib/plan";
import {
  cycleWindows,
  measureEffect,
  measureRating,
  ratingNoise,
  type EffectResult,
  type RatingEffect,
} from "../lib/effect";
import { buildWeekBudget, lastWeekDeficit, weekStartOf, type WeekBudget } from "../lib/week";
import { Button, Card } from "../components/ui";
import StudyPlanner from "../components/StudyPlanner";
import StudyFocusCard from "../components/StudyFocusCard";
import AllocationBars from "../components/AllocationBars";
import WeekBudgetBar from "../components/WeekBudgetBar";
import TodaySession, { type SessionItem } from "../components/TodaySession";
import { useMobileShell } from "../components/MobileShell";
import { batchDataChanges, onDataChange } from "../lib/changes";
import { deInt } from "../lib/format";
import { isStoreCapture } from "../lib/storeCapture";
import { maybeRequestPlayReview } from "../lib/reviewPrompt";
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
  /** Geplante Einheiten der laufenden Woche · Montag bis Sonntag. */
  events: StudyEvent[];
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

  const loadRef = useRef<Promise<void> | null>(null);
  const loadFresh = useCallback(async () => {
    // Bewusst hier und nicht aus dem Render-Scope: `load` hängt an einem
    // Änderungs-Abo und läuft womöglich Stunden später erneut. Mit einem
    // eingefrorenen Zeitpunkt endete das Nachher-Fenster beim Öffnen der Seite,
    // und genau die Partien, die seither dazukamen, fehlten in der Messung.
    const now = Math.floor(Date.now() / 1000);
    const [data, program, records, deep, puzzles, settings] = await Promise.all([
      studyData().catch(() => null),
      trainingProgram().catch(() => null),
      listGameSummaries().catch(() => [] as GameSummary[]),
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

    // Die ganze Woche, nicht nur heute: der Tagesplan ist ein Ausschnitt
    // davon, und der Wochenvorschlag muss wissen, was schon geplant ist.
    const weekStart = weekStartOf(new Date());
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY * 1_000);
    const calendar = await getStudyCalendar(isoDay(weekStart), isoDay(weekEnd)).catch(() => ({
      templates: [] as StudyTemplate[],
      events: [] as StudyEvent[],
      days: [],
    }));

    setState({
      data,
      program,
      plan,
      findings,
      windows,
      templates: calendar.templates,
      events: calendar.events,
      rating: measureRating(measured),
      trainingDays,
    });
  }, [locale]);

  const load = useCallback(() => {
    if (loadRef.current) return loadRef.current;
    const request = loadFresh().finally(() => {
      if (loadRef.current === request) loadRef.current = null;
    });
    loadRef.current = request;
    return request;
  }, [loadFresh]);

  useEffect(() => {
    if (!desktop) {
      setState(DEMO_PLAN_STATE(locale));
      return;
    }
    load().catch(() => setState(null));
    return onDataChange(() => {
      load().catch(() => {});
    }, ["games", "analysis", "puzzles", "endgame", "repertoire", "study", "database"]);
  }, [desktop, load, locale]);

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

  const completeFocus = async (focus: StudyFocus) => {
    if (!desktop) return;
    setBusy(true);
    try {
      await closeStudyFocus(focus.id, "done");
      void maybeRequestPlayReview(backend.info, { kind: "focus-cycle-complete" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ── Woche ──────────────────────────────────────────────────────────────────

  const weekStart = useMemo(() => weekStartOf(new Date()), []);
  const week: WeekBudget | null = useMemo(
    () =>
      state?.program && plan
        ? buildWeekBudget(state.program.days, plan.allocation, weekStart, new Date())
        : null,
    [state, plan, weekStart]
  );

  /** Bereits verplante Minuten dieser Woche je Bereich. */
  const plannedMinutes = useMemo(() => {
    const out: Partial<Record<Area, number>> = {};
    for (const event of state?.events ?? []) {
      const area = templateArea(event.template);
      if (!area) continue;
      out[area] = (out[area] ?? 0) + event.template.duration_min;
    }
    return out;
  }, [state]);

  const proposePlan = () => {
    if (!plan || !state?.program) return;
    // `due_week[0]` bedeutet heute. Die alte Verankerung am Montag verschob
    // diese Fälligkeiten mitten in der Woche rückwärts auf vergangene Tage.
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    setPlanning(
      buildWeekPlan(
        plan.allocation,
        state.templates,
        data?.due_week ?? [],
        state.trainingDays,
        firstDay,
        {
          // Was die Vorwoche schuldig blieb, kommt oben drauf; was diese Woche
          // schon im Kalender steht, wird abgezogen. Damit verdoppelt ein
          // zweiter Vorschlag nichts mehr, sondern füllt auf.
          carryOver: lastWeekDeficit(state.program.days, plan.allocation, weekStart, today),
          planned: plannedMinutes,
        }
      )
    );
  };

  const applyPlan = async () => {
    if (!planning || !desktop) return;
    setBusy(true);
    try {
      // Nacheinander, nicht parallel: die Positionen innerhalb eines Tages
      // werden beim Anlegen fortlaufend vergeben.
      await batchDataChanges(async () => {
        for (const unit of planning) {
          await scheduleStudyUnit(unit.templateId, unit.day);
        }
      });
      setPlanning(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // ── Tagesplan ──────────────────────────────────────────────────────────────

  const dose = plan?.dose ?? null;

  /** Icon und Sprungziel je Bereich · dasselbe wie in den Fokuskarten. */
  const areaAction = useCallback(
    (area: Area): { icon: typeof BookOpen; label: string; run: () => void } => {
      switch (area) {
        case "tactics":
          return {
            icon: PuzzleIcon,
            label: t("dash.solve"),
            run: () =>
              openPuzzles(
                dose?.theme,
                dose ? { minRating: dose.minRating, maxRating: dose.maxRating } : undefined
              ),
          };
        case "openings":
          return { icon: BookOpen, label: t("dash.train"), run: () => go("repertoire") };
        case "endgames":
          return {
            icon: Crown,
            label: t("dash.train"),
            run: () => (openEndgame ? openEndgame() : go("endgame")),
          };
        case "analysis":
          return { icon: Cpu, label: t("dash.start"), run: () => go("analysis") };
        default:
          // Gespielt wird außerhalb von Kiebitz · das Dashboard hält die
          // Absprünge zu chess.com und Lichess bereit.
          return { icon: Timer, label: t("st.sessionPlay"), run: () => go("dashboard") };
      }
    },
    [t, go, openPuzzles, openEndgame, dose]
  );

  /**
   * Die Sitzung für heute: erst die geplanten Einheiten in ihrer Reihenfolge,
   * darunter das, was ohne Plan täglich anfällt und noch offen ist.
   */
  const todayIso = isoDay(new Date());
  const sessionItems = useMemo<SessionItem[]>(() => {
    const items: SessionItem[] = [];
    for (const event of (state?.events ?? []).filter((entry) => entry.day === todayIso)) {
      const area = templateArea(event.template);
      const done = event.completed || event.auto_done;
      const action = area ? areaAction(area) : null;
      // Für Taktik trägt die Dosis das Band und das Motiv · sonst steht dort
      // die Beschreibung der Einheit.
      const detail =
        area === "tactics" && dose
          ? t(dose.theme ? "plan.dosePuzzlesTheme" : "plan.dosePuzzles", {
              n: deInt(dose.perDay),
              lo: deInt(dose.minRating),
              hi: deInt(dose.maxRating),
              theme: dose.theme
                ? localizeFindingParams({ theme: dose.theme }, t, locale).theme
                : "",
            })
          : templateText(event.template, "desc", t) || templateText(event.template, "tool", t);
      items.push({
        id: `event-${event.id}`,
        area,
        icon: action?.icon ?? Lightbulb,
        label: templateText(event.template, "title", t),
        detail: String(detail),
        minutes: event.template.duration_min,
        done,
        auto: !event.completed && event.auto_done,
        action: action ? { label: action.label, run: action.run } : undefined,
      });
    }

    if (data) {
      // Fällige Wiederholungen, Tagesdosis und offene Analysen sind Mengen,
      // keine Zeitbudgets · sie hängen deshalb nicht am Wochenplan, sondern
      // stehen jeden Tag hier. Auch erledigt: der erreichte Zustand ist die
      // halbe Rückmeldung.
      const puzzleTarget = dose ? dose.perDay : data.puzzle_goal;
      items.push(
        {
          id: "reviews",
          area: "openings",
          icon: BookOpen,
          label: t("st.taskReviews"),
          detail: t("st.due", { n: deInt(data.due_now) }),
          minutes: null,
          done: data.due_now === 0,
          auto: false,
          action: { label: t("dash.train"), run: () => go("repertoire") },
        },
        {
          id: "puzzles",
          area: "tactics",
          icon: PuzzleIcon,
          label: t("st.taskPuzzles"),
          detail: `${deInt(data.today_puzzle_attempts)} / ${deInt(puzzleTarget)}`,
          minutes: null,
          done: data.today_puzzle_attempts >= puzzleTarget,
          auto: false,
          action: {
            label: t("dash.solve"),
            run: () =>
              openPuzzles(
                dose?.theme,
                dose ? { minRating: dose.minRating, maxRating: dose.maxRating } : undefined
              ),
          },
        },
        {
          id: "analysis",
          area: "analysis",
          icon: Cpu,
          label: t("st.taskAnalysis"),
          detail: t("st.gamesPending", { n: deInt(data.unanalyzed) }),
          minutes: null,
          done: data.unanalyzed === 0,
          auto: false,
          action: { label: t("dash.start"), run: () => go("analysis") },
        }
      );
    }
    return items;
  }, [state, data, todayIso, areaAction, dose, t, locale, go, openPuzzles]);

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

      {/* Die Woche als eine Zahl · sie steht über allem anderen, weil sie die
          Frage beantwortet, mit der man diese Seite öffnet. */}
      {week && (
        <Card
          className="mb-4"
          title={
            <span className="flex items-center gap-2">
              <Gauge size={14} className="text-accent" /> {t("st.weekBudget")}
            </span>
          }
        >
          <WeekBudgetBar budget={week} />
        </Card>
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
                    onComplete={() => focus && !busy && completeFocus(focus)}
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
          <TodaySession items={sessionItems} emptyKey="st.sessionEmpty" />
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
                    {/* Der Formattipp trägt Zeitformate als Rohwerte · dieselbe
                        Übersetzung wie in den Befunden. */}
                    {t(tip.key, localizeFindingParams(tip.params, t, locale))}
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
              {/* Steht schon etwas in der Woche, füllt der Vorschlag nur die
                  fehlenden Bereiche auf · das sagt auch die Beschriftung. */}
              <CalendarPlus size={15} />{" "}
              {(state?.events.length ?? 0) > 0 ? t("st.proposeTopUp") : t("plan.proposeWeek")}
            </button>
          ) : (
            <Card title={t("plan.proposalTitle")}>
              {planning.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed text-ink3">{t("plan.proposalEmpty")}</p>
              ) : (
                <>
                  <p className="mb-3 text-[12.5px] leading-relaxed text-ink3">
                    {t("plan.proposalNote", { n: planning.length, m: plan.weeklyMinutes })}
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

      {/* Wochenkalender: Ist-Minuten, Fälligkeiten und geplante Einheiten. */}
      <StudyPlanner desktop={desktop} />
    </div>
  );
}

export { DAY };
