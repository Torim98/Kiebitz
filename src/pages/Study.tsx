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
  applyWeekPlan,
  eventMinutes,
  getStudyCalendar,
  studyData,
  templateAreas,
  templateText,
  trainingProgram,
  AREA_COLOR,
  type Area,
  type StudyData,
  type StudyEvent,
  type StudyTemplate,
  type TrainingProgram,
} from "../lib/study";
import { getSettings, trainingDayList } from "../lib/settings";
import { buildInsights } from "../lib/stats";
import { deepInsights, studyMetrics, type FindingWindow } from "../lib/insights";
import { buildFindings, localizeFindingParams, type Finding } from "../lib/findings";
import {
  buildPlan,
  buildWeekPlan,
  sessionMinutes,
  type PlannedUnit,
  type TrainingPlan,
} from "../lib/plan";
import { measureRating, ratingNoise, type RatingEffect } from "../lib/effect";
import { buildWeekBudget, lastWeekDeficit, weekStartOf, type WeekBudget } from "../lib/week";
import { Button, Card } from "../components/ui";
import { PlusBadge } from "../components/PlusLock";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import StudyPlanner from "../components/StudyPlanner";
import PrescriptionCard from "../components/PrescriptionCard";
import WeekBudgetBar from "../components/WeekBudgetBar";
import WindowNote from "../components/WindowNote";
import TodaySession, { type SessionItem } from "../components/TodaySession";
import { useMobileShell } from "../components/MobileShell";
import { onDataChange } from "../lib/changes";
import { deInt } from "../lib/format";
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
  /** Zeitraum, aus dem die Befunde stammen · steht unter dem Coach. */
  window: FindingWindow;
  templates: StudyTemplate[];
  /** Geplante Einheiten der nächsten sieben Tage, ab heute. */
  events: StudyEvent[];
  rating: RatingEffect | null;
  /** Trainingstage aus den Einstellungen, Index 0 = Montag. */
  trainingDays: boolean[];
  /** Beobachtetes Wochenmittel der letzten acht Wochen. */
  observedWeeklyMinutes: number;
  /** Steht ein Wochenbudget in den Einstellungen? */
  budgetSet: boolean;
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

  const [state, setState] = useState<StudyState | null>(null);
  const [planning, setPlanning] = useState<PlannedUnit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const planGate = usePlusGate("adaptive_plan");

  const loadRef = useRef<Promise<void> | null>(null);
  const loadFresh = useCallback(async () => {
    // Bewusst hier und nicht aus dem Render-Scope: `load` hängt an einem
    // Änderungs-Abo und läuft womöglich Stunden später erneut. Mit einem
    // eingefrorenen Zeitpunkt endete das Messfenster beim Öffnen der Seite, und
    // genau die Partien, die seither dazukamen, fehlten in der Messung.
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

    // Die Ratingveränderung im selben Zeitraum, aus dem auch die Befunde
    // kommen. Ohne Fenster (zu wenig Material) gibt es keine Zahl: „+140 Elo
    // seit 2021" beantwortet keine Frage, die auf dieser Seite gestellt wird.
    const findingWindow = deep?.window ?? { days: 0, from_ts: 0, games: 0, analyzed: 0 };
    const measured =
      findingWindow.days > 0
        ? await studyMetrics([{ from_ts: findingWindow.from_ts, to_ts: now + 1 }]).catch(() => [])
        : [];

    // Die nächsten sieben Tage, nicht nur heute: der Tagesplan ist ein
    // Ausschnitt davon, und der Wochenvorschlag muss wissen, was in diesem
    // Fenster schon geplant ist.
    const today = new Date();
    const windowEnd = new Date(today.getTime() + 6 * DAY * 1_000);
    const calendar = await getStudyCalendar(isoDay(today), isoDay(windowEnd)).catch(() => ({
      templates: [] as StudyTemplate[],
      events: [] as StudyEvent[],
      days: [],
    }));

    setState({
      data,
      program,
      plan,
      findings,
      window: findingWindow,
      templates: calendar.templates,
      events: calendar.events,
      rating: measureRating(measured),
      trainingDays,
      observedWeeklyMinutes: program?.observed_weekly_minutes ?? 0,
      budgetSet: (settings?.weekly_minutes ?? 0) > 0,
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

  // ── Woche ──────────────────────────────────────────────────────────────────

  const weekStart = useMemo(() => weekStartOf(new Date()), []);
  const week: WeekBudget | null = useMemo(
    () =>
      state?.program && plan
        ? buildWeekBudget(state.program.days, plan.allocation, weekStart, new Date())
        : null,
    [state, plan, weekStart]
  );

  /**
   * Was in den nächsten sieben Tagen von Hand geplant und noch offen ist.
   *
   * Nur eigene Einheiten: die Termine früherer Vorschläge räumt der nächste
   * Vorschlag selbst weg, sie dürfen den Bedarf deshalb nicht senken.
   * Mehrbereichs-Einheiten teilen ihre Minuten unter ihren Bereichen auf.
   */
  const plannedMinutes = useMemo(() => {
    const out: Partial<Record<Area, number>> = {};
    for (const event of state?.events ?? []) {
      if (event.source === "plan" || event.completed || event.auto_done) continue;
      const areas = templateAreas(event.template);
      if (areas.length === 0) continue;
      const share = eventMinutes(event) / areas.length;
      for (const area of areas) out[area] = (out[area] ?? 0) + share;
    }
    return out;
  }, [state]);

  const proposePlan = () => {
    if (!plan || !state?.program || !week) return;
    // `due_week[0]` bedeutet heute. Die alte Verankerung am Montag verschob
    // diese Fälligkeiten mitten in der Woche rückwärts auf vergangene Tage.
    const today = new Date();
    const firstDay = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    setPlanning(
      buildWeekPlan({
        // Ziel und gemessenes Ist derselben Woche, die oben auf der Seite
        // steht · der Vorschlag plant genau die Lücke dazwischen.
        week: week.byArea,
        templates: state.templates,
        dueWeek: data?.due_week ?? [],
        trainingDayMask: state.trainingDays,
        startDay: firstDay,
        // Was die Vorwoche schuldig blieb, kommt oben drauf; was von Hand
        // schon im Kalender steht, wird abgezogen.
        carryOver: lastWeekDeficit(state.program.days, plan.allocation, weekStart, today),
        planned: plannedMinutes,
      })
    );
  };

  const applyPlan = async () => {
    if (!planning || !desktop) return;
    setBusy(true);
    try {
      const first = isoDay(new Date());
      const last = isoDay(new Date(Date.now() + 6 * DAY * 1_000));
      await applyWeekPlan(
        first,
        last,
        planning.map((unit) => ({
          template_id: unit.templateId,
          day: unit.day,
          planned_min: unit.minutes,
        }))
      );
      setPlanning(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Vorgeschlagene Länge einer von Hand geplanten Einheit.
   *
   * Sie kommt aus derselben Rechnung wie der Vorschlag: die offene Lücke der
   * gewählten Bereiche, verteilt auf die verbleibenden Trainingstage. Damit
   * muss niemand mehr eine Dauer eintippen, die Kiebitz ohnehin misst.
   */
  const suggestMinutes = useCallback(
    (areas: Area[]) => {
      if (!week || areas.length === 0) return 0;
      const dayCount = Math.max(1, plan?.trainingDayCount ?? 7);
      const perDay = areas.reduce((sum, area) => {
        const entry = week.byArea.find((candidate) => candidate.area === area);
        if (!entry) return sum;
        return sum + (entry.gap > 0 ? entry.gap : entry.target) / dayCount;
      }, 0);
      return sessionMinutes(perDay);
    },
    [week, plan]
  );

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
      // Bei mehreren Bereichen führt der erste in den Trainer · er steht auch
      // als Erster im Editor und ist damit der, den der Nutzer gemeint hat.
      const area = templateAreas(event.template)[0] ?? null;
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
        minutes: eventMinutes(event) || null,
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
              title={`${t(
                state.rating.confidence === "measured" ? "plan.ratingExact" : "plan.ratingApprox"
              )} ${t("plan.ratingWindow", { d: deInt(state.window.days) })}`}
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
        <nav aria-label={t("st.areas")} className="mb-4 grid grid-cols-3 gap-2" data-tour="study-areas">
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
          <WeekBudgetBar
            budget={week}
            source={
              state?.budgetSet ? (
                // Steht ein Budget in den Einstellungen, ist es auf allen
                // Geräten dasselbe · das ist die halbe Aussage dieser Zeile.
                t("st.weekBudgetSource", { m: deInt(plan?.weeklyMinutes ?? 0) })
              ) : (
                t("st.weekBudgetObserved", {
                  m: deInt(state?.observedWeeklyMinutes ?? 0),
                })
              )
            }
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        {/* Woran arbeiten */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Lightbulb size={14} className="text-gold" /> {t("st.coach")}
            </span>
          }
          className="min-[1100px]:col-span-2"
          tour="study-plan"
        >
          {plan && plan.prescriptions.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {plan.prescriptions.map((prescription) => (
                <PrescriptionCard
                  key={prescription.id}
                  prescription={prescription}
                  mobile={mobile}
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
              ))}
            </div>
          ) : (
            <p className="py-2 text-[13px] leading-relaxed text-ink3">{t("st.coachEmpty")}</p>
          )}
          {state && <WindowNote window={state.window} className="mt-3" />}
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

      {/* Plan · die nächsten sieben Tage. Der Vorschlag steht in derselben
          Karte wie die Plantafel: er füllt genau die Lücken, die sie zeigt. */}
      <StudyPlanner
        desktop={desktop}
        suggestMinutes={suggestMinutes}
        proposal={
          desktop && plan ? (
            planning == null ? (
              // Der adaptive Wochenvorschlag gehört zu Kiebitz Plus. Von Hand
              // planen, verschieben und abhaken bleibt frei · gesperrt ist nur,
              // dass Kiebitz die Woche selbst zusammenstellt.
              <button
                type="button"
                onClick={() => {
                  if (!planGate.unlocked && !planGate.pending) {
                    openPlusDialog("adaptive_plan");
                    return;
                  }
                  proposePlan();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
              >
                <CalendarPlus size={15} /> {t("plan.proposeWeek")}
                {!planGate.unlocked && !planGate.pending && <PlusBadge />}
              </button>
            ) : (
              <div className="rounded-xl border border-accent-dim bg-panel2 p-3">
                <div className="mb-2 text-[13px] font-medium text-ink">
                  {t("plan.proposalTitle")}
                </div>
                {planning.length === 0 ? (
                  <p className="text-[12.5px] leading-relaxed text-ink3">
                    {t("plan.proposalEmpty")}
                  </p>
                ) : (
                  <>
                    <p className="mb-3 text-[12.5px] leading-relaxed text-ink3">
                      {t("plan.proposalNote", { n: planning.length, m: plan.weeklyMinutes })}
                    </p>
                    <ul className="mb-3 flex flex-col gap-1.5">
                      {planning.map((unit, index) => (
                        <li
                          key={`${unit.day}-${unit.templateId}-${index}`}
                          className="flex items-baseline justify-between gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px]"
                          style={{ borderLeftColor: AREA_COLOR[unit.area], borderLeftWidth: 3 }}
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
              </div>
            )
          ) : undefined
        }
      />

      {/* Spielhygiene · kein Trainingsinhalt, sondern *wie* gespielt wird. */}
      {plan && (
        <Card
          className="mt-4"
          title={
            <span className="flex items-center gap-2">
              <Timer size={14} className="text-gold" /> {t("plan.hygieneTitle")}
            </span>
          }
        >
          {plan.hygiene.length > 0 ? (
            <ul className="grid gap-2 min-[900px]:grid-cols-2">
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
            <p className="py-2 text-[12.5px] leading-relaxed text-ink3">{t("plan.hygieneEmpty")}</p>
          )}
        </Card>
      )}
    </div>
  );
}

export { DAY };
