import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { Button, Card } from "./ui";
import { useMobileShell } from "./MobileShell";
import { useI18n, type Key } from "../lib/i18n";
import {
  completeStudyUnit,
  deleteStudyTemplate,
  deleteStudyUnit,
  getStudyCalendar,
  moveStudyUnit,
  repeatStudyUnit,
  saveStudyTemplate,
  scheduleStudyUnit,
  templateText,
  AREAS,
  REPEAT_RULES,
  REPEAT_STEP_DAYS,
  type Area,
  type RepeatRule,
  type StudyCalendar,
  type StudyEvent,
  type StudyTemplate,
  type StudyTemplateInput,
} from "../lib/study";
import { onDataChange } from "../lib/changes";
import { isoDay } from "../lib/dates";
import { isStoreCapture } from "../lib/storeCapture";

const DAY_MS = 86_400_000;
const EMPTY_TEMPLATE: StudyTemplateInput = {
  title: "",
  duration_min: 20,
  tool: "",
  description: "",
  area: "",
};

const AREA_KEY: Record<Area, Key> = {
  play: "plan.areaPlay",
  tactics: "plan.areaTactics",
  openings: "plan.areaOpenings",
  endgames: "plan.areaEndgames",
  analysis: "plan.areaAnalysis",
};

function mondayOf(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
}

const REPEAT_LABEL: Record<Exclude<RepeatRule, "">, Key> = {
  daily: "st.repeatDaily",
  weekly: "st.repeatWeekly",
  biweekly: "st.repeatBiweekly",
};

/** Vorschlag fürs Enddatum: zwölf Termine im gewählten Raster. */
function defaultUntil(day: string, rule: Exclude<RepeatRule, "">): string {
  const start = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(start)) return day;
  return isoDay(new Date(start + 11 * REPEAT_STEP_DAYS[rule] * DAY_MS));
}

/**
 * Serie einstellen: Raster plus Enddatum. Eine Serie ist im Kalender eine Reihe
 * echter Termine · deshalb steht hier auch das Ende, statt eine Regel offen zu
 * lassen, die irgendwann Termine erfindet, die niemand geplant hat.
 */
function RepeatForm({
  day,
  current,
  busy,
  onApply,
  onCancel,
  onDeleteSeries,
}: {
  day: string;
  current: RepeatRule;
  busy: boolean;
  onApply: (rule: Exclude<RepeatRule, "">, until: string) => void;
  onCancel: () => void;
  /** Nur bei einem Termin, der schon zu einer Serie gehört. */
  onDeleteSeries?: () => void;
}) {
  const t = useI18n().t;
  const [rule, setRule] = useState<Exclude<RepeatRule, "">>(
    current === "" ? "weekly" : current
  );
  const [until, setUntil] = useState(() => defaultUntil(day, current === "" ? "weekly" : current));

  return (
    <div className="mt-2 rounded-lg border border-accent-dim bg-panel2 p-2">
      <div className="text-[10.5px] uppercase tracking-wide text-ink3">{t("st.repeatTitle")}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {REPEAT_RULES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setRule(value);
              setUntil(defaultUntil(day, value));
            }}
            className={`rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors ${
              rule === value
                ? "border-accent-dim bg-accent-soft text-accent"
                : "border-line text-ink3 hover:text-ink"
            }`}
          >
            {t(REPEAT_LABEL[value])}
          </button>
        ))}
      </div>
      <label className="mt-2 block text-[10.5px] text-ink3">
        {t("st.repeatUntil")}
        <input
          type="date"
          value={until}
          min={day}
          onChange={(event) => setUntil(event.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-panel px-1.5 py-1 text-[11px] text-ink focus:border-accent-dim focus:outline-none"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        {onDeleteSeries && (
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteSeries}
            className="mr-auto rounded-md px-1.5 py-1 text-[10.5px] text-ink3 hover:text-loss disabled:opacity-45"
          >
            {t("st.repeatEnd")}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-1.5 py-1 text-[10.5px] text-ink3 hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={busy || !until}
          onClick={() => onApply(rule, until)}
          className="rounded-md bg-accent px-2 py-1 text-[10.5px] font-medium text-[#06251a] disabled:opacity-45"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

/** Was gerade am Zeiger hängt: eine Vorlage oder eine bereits geplante Einheit. */
interface DragPayload {
  kind: "template" | "event";
  id: number;
  label: string;
}

interface DragState extends DragPayload {
  x: number;
  y: number;
  /** Tag unter dem Zeiger (ISO), sonst null. */
  over: string | null;
}

/** Tag-Zelle unter einem Bildschirmpunkt · die Zellen tragen `data-study-day`. */
function dayAtPoint(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest("[data-study-day]") as HTMLElement | null;
  return cell?.dataset.studyDay ?? null;
}

export default function StudyPlanner({ desktop }: { desktop: boolean }) {
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const mobile = useMobileShell();
  // Der Kalender ist der Hauptinhalt; die Vorlagen bleiben bis zum Aufklappen aus dem Weg.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [calendar, setCalendar] = useState<StudyCalendar>({ templates: [], events: [], days: [] });
  const [planningDay, setPlanningDay] = useState(() => isoDay(new Date()));
  const [editing, setEditing] = useState<StudyTemplateInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Termin, für den gerade das Wiederholungsraster eingestellt wird. */
  const [repeating, setRepeating] = useState<number | null>(null);
  /** Raster für die nächste Planung aus der Vorlagen-Bibliothek. */
  const [planRepeat, setPlanRepeat] = useState<RepeatRule>("");

  const days = useMemo(
    () => [...Array(7)].map((_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart]
  );
  const previewCalendar = useMemo<StudyCalendar>(() => {
    // Die Vorschau zeigt dieselben Startvorlagen wie eine frische Installation ·
    // über i18n_key stehen sie auch hier in der Sprache der Oberfläche.
    const templates: StudyTemplate[] = [
      { id: 1, title: "Opening training", duration_min: 20, tool: "Kiebitz Repertoire", description: "Reinforce the first 8–10 moves and the ideas behind them.", area: "openings", i18n_key: "st.seed.openings" },
      { id: 2, title: "Endgame training", duration_min: 20, tool: "Kiebitz Endgames", description: "Train queen, rook, and fundamental pawn endings.", area: "endgames", i18n_key: "st.seed.endgames" },
      { id: 3, title: "Tactics", duration_min: 20, tool: "Kiebitz Puzzles", description: "15–20 puzzles: forks, pins, skewers, and discovered attacks.", area: "tactics", i18n_key: "st.seed.tactics" },
      { id: 4, title: "Game + analysis", duration_min: 40, tool: "Lichess + Kiebitz Analysis", description: "Play rapid, review yourself, then understand the three biggest errors.", area: "play", i18n_key: "st.seed.play" },
    ];
    const today = isoDay(new Date());
    const demoMinutes = [24, 0, 16, 40, 10, 19, 0];
    return {
      templates,
      events: [
        { id: 1, template_id: 3, day: isoDay(days[2]), position: 0, completed: true, completed_ts: 1, auto_done: false, repeat_rule: "weekly", series_key: "preview-tactics", template: templates[2] },
        { id: 2, template_id: 4, day: isoDay(days[5]), position: 0, completed: false, completed_ts: 0, auto_done: false, repeat_rule: "", series_key: "", template: templates[3] },
      ],
      days: days.map((date, index) => {
        const day = isoDay(date);
        const past = day <= today;
        return {
          day,
          puzzle_attempts: past ? demoMinutes[index] / 2 : 0,
          puzzle_solved: past ? Math.round(demoMinutes[index] / 3) : 0,
          endgame_attempts: 0,
          rep_reviews: 0,
          game_reviews: past && index === 3 ? 1 : 0,
          actual_minutes: past ? demoMinutes[index] : 0,
          due_reviews: day >= today ? [14, 6, 9, 4, 11, 3, 7][index] : 0,
        };
      }),
    };
  }, [days]);
  const visibleCalendar = desktop ? calendar : previewCalendar;
  const today = isoDay(new Date());

  const refreshRef = useRef<{ key: string; request: Promise<void> } | null>(null);
  const refresh = useCallback(() => {
    if (!desktop) return Promise.resolve();
    const from = isoDay(days[0]);
    const to = isoDay(days[6]);
    const key = `${from}:${to}`;
    if (refreshRef.current?.key === key) return refreshRef.current.request;
    const request = getStudyCalendar(from, to)
      .then(setCalendar)
      .finally(() => {
        if (refreshRef.current?.request === request) refreshRef.current = null;
      });
    refreshRef.current = { key, request };
    return request;
  }, [days, desktop]);

  useEffect(() => {
    if (!desktop) return;
    refresh().catch((reason) => setError(String(reason)));
    const unsubscribe = onDataChange(() => {
      refresh().catch((reason) => setError(String(reason)));
    }, ["study", "database"]);
    return unsubscribe;
  }, [desktop, refresh]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Der Papierkorb löscht immer genau diesen Termin · eine ganze Serie geht nur
   * über das Wiederholungs-Menü verloren, damit ein Fehlklick nicht Wochen an
   * geplanten Einheiten mitnimmt.
   */
  const removeUnit = (event: StudyEvent) => mutate(() => deleteStudyUnit(event.id));

  const dropOnDay = (day: string, payload: DragPayload) => {
    if (!desktop) return;
    if (payload.kind === "template") void mutate(() => scheduleStudyUnit(payload.id, day));
    if (payload.kind === "event") {
      const position = visibleCalendar.events.filter((event) => event.day === day).length;
      void mutate(() => moveStudyUnit(payload.id, day, position));
    }
  };

  /**
   * Drag-and-drop über Pointer-Events statt der HTML5-API: die Windows-WebView
   * liefert für `dragstart`/`drop` keine brauchbaren Events (gleiche Ursache wie
   * beim Analyse-Brett), Pointer-Events funktionieren dort und auf Touch.
   */
  const startDrag = (event: React.PointerEvent, payload: DragPayload) => {
    if (!desktop || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    const move = (pointer: PointerEvent) => {
      if (!moved && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 5) return;
      moved = true;
      setDrag({
        ...payload,
        x: pointer.clientX,
        y: pointer.clientY,
        over: dayAtPoint(pointer.clientX, pointer.clientY),
      });
    };
    const stop = (pointer: PointerEvent | null) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!moved || !pointer) return;
      const day = dayAtPoint(pointer.clientX, pointer.clientY);
      if (day) dropOnDay(day, payload);
    };
    const finish = (pointer: PointerEvent) => stop(pointer);
    const cancel = () => stop(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const saveTemplate = async () => {
    if (!editing) return;
    if (await mutate(() => saveStudyTemplate(editing))) setEditing(null);
  };

  return (
    <Card
      className="mt-4"
      title={
        <span className="flex items-center gap-2">
          <CalendarDays size={15} className="text-accent" /> {t("st.weekTitle")}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}
            aria-label={t("st.prevWeek")}
            className="rounded-lg border border-line p-1.5 text-ink3 hover:text-ink"
          >
            <ChevronLeft size={15} />
          </button>
          <Button onClick={() => setWeekStart(mondayOf(new Date()))} className="!px-2.5 !py-1.5 !text-[12px]">
            {t("st.currentWeek")}
          </Button>
          <button
            type="button"
            onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}
            aria-label={t("st.nextWeek")}
            className="rounded-lg border border-line p-1.5 text-ink3 hover:text-ink"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {!desktop && !storeCapture && (
          <div className="rounded-lg border border-dashed border-line2 px-3 py-2 text-[12px] text-ink3">
            {t("st.plannerDesktop")}
          </div>
        )}

        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[13px] font-medium text-ink">
              {days[0].toLocaleDateString(locale, { day: "2-digit", month: "long", timeZone: "UTC" })}
              {" – "}
              {days[6].toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })}
            </div>
            <div className="text-[11.5px] text-ink3">{t("st.calendarHint")}</div>
          </div>

          {/* Mobil steht die Woche als Agenda untereinander · das Sieben-Spalten-
              Raster braucht 760 px und wäre nur quer scrollend lesbar. Die
              Tageszellen behalten data-study-day, damit Ziehen weiter geht. */}
          <div className={mobile ? "" : "overflow-x-auto pb-1"}>
            <div className={mobile ? "flex flex-col gap-2" : "grid min-w-[760px] grid-cols-7 gap-2"}>
              {days.map((date) => {
                const day = isoDay(date);
                const events = visibleCalendar.events.filter((event) => event.day === day);
                const metrics = (visibleCalendar.days ?? []).find((entry) => entry.day === day);
                const isToday = day === today;
                const future = day > today;
                const actualMinutes = metrics?.actual_minutes ?? 0;
                const due = (metrics?.due_reviews ?? 0) + events.filter((event) => !event.completed).length;
                // Leere vergangene Tage tragen mobil nichts bei und blähen die
                // Liste auf · sie schrumpfen auf eine Zeile.
                const collapsed = mobile && events.length === 0 && !isToday && due === 0;
                return (
                  <div
                    key={day}
                    data-study-day={day}
                    className={`rounded-xl border transition-colors ${
                      mobile ? "p-2.5" : "min-h-[300px] p-2"
                    } ${
                      drag?.over === day
                        ? "border-accent bg-accent-soft/60"
                        : isToday
                          ? "border-accent-dim bg-accent-soft/30"
                          : "border-line bg-panel2"
                    }`}
                  >
                    <div
                      className={
                        mobile
                          ? `flex items-baseline gap-2 ${collapsed ? "" : "border-b border-line pb-2"}`
                          : "border-b border-line pb-2 text-center"
                      }
                    >
                      <div
                        className={`uppercase tracking-wide text-ink3 ${mobile ? "text-[11px]" : "text-[10.5px]"}`}
                      >
                        {date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}
                      </div>
                      <div
                        className={`font-semibold ${mobile ? "text-[14px]" : "mt-0.5 text-[18px]"} ${isToday ? "text-accent" : "text-ink"}`}
                      >
                        {date.getUTCDate()}
                      </div>
                      <div
                        className={`flex flex-wrap items-center gap-x-1.5 text-[10px] ${
                          mobile ? "ml-auto justify-end" : "mt-0.5 justify-center"
                        }`}
                      >
                        {!future && (
                          <span className={actualMinutes > 0 ? "text-ink2" : "text-ink3"}>
                            {t("st.actualMinutes", { n: actualMinutes })}
                          </span>
                        )}
                        {(future || isToday) && due > 0 && (
                          <span className="text-gold">{t("st.due", { n: due })}</span>
                        )}
                      </div>
                    </div>
                    <div className={`flex flex-col gap-2 ${collapsed ? "hidden" : "mt-2"}`}>
                      {events.map((event) => (
                        <div
                          key={event.id}
                          className={`rounded-lg border p-2 ${
                            drag?.kind === "event" && drag.id === event.id ? "opacity-40" : ""
                          } ${event.completed ? "border-accent-dim bg-accent-soft/50" : "border-line2 bg-panel"}`}
                        >
                          <div className="flex items-start gap-1.5">
                            <span
                              onPointerDown={(pointerEvent) =>
                                startDrag(pointerEvent, {
                                  kind: "event",
                                  id: event.id,
                                  label: templateText(event.template, "title", t),
                                })
                              }
                              className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                              aria-label={t("st.dragUnit")}
                            >
                              <GripVertical size={12} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className={`text-[11.5px] font-medium leading-tight ${event.completed ? "text-ink3 line-through" : "text-ink"}`}>
                                {templateText(event.template, "title", t)}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-ink3">
                                <span>{event.template.duration_min} min</span>
                                {event.repeat_rule && (
                                  <span
                                    className="inline-flex items-center gap-0.5 rounded border border-line2 px-1 text-accent"
                                    title={t("st.repeatSeries")}
                                  >
                                    <Repeat size={9} /> {t(REPEAT_LABEL[event.repeat_rule])}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => void mutate(() => completeStudyUnit(event.id, !event.completed))}
                              disabled={!desktop}
                              className={`rounded-md p-1 ${event.completed ? "bg-accent-soft text-accent" : "text-ink3 hover:bg-panel2 hover:text-accent"}`}
                              aria-label={event.completed ? t("st.markOpen") : t("st.markDone")}
                            ><Check size={12} /></button>
                            <button
                              type="button"
                              onClick={() =>
                                setRepeating((current) => (current === event.id ? null : event.id))
                              }
                              disabled={!desktop}
                              aria-expanded={repeating === event.id}
                              className={`rounded-md p-1 ${
                                repeating === event.id || event.repeat_rule
                                  ? "bg-accent-soft text-accent"
                                  : "text-ink3 hover:bg-panel2 hover:text-accent"
                              }`}
                              aria-label={t("st.repeatSet")}
                              title={t("st.repeatSet")}
                            ><Repeat size={12} /></button>
                            <button
                              type="button"
                              onClick={() => void removeUnit(event)}
                              disabled={!desktop}
                              className="rounded-md p-1 text-ink3 hover:bg-panel2 hover:text-loss"
                              aria-label={t("common.delete")}
                            ><Trash2 size={12} /></button>
                          </div>
                          {repeating === event.id && (
                            <RepeatForm
                              day={event.day}
                              current={event.repeat_rule}
                              busy={busy}
                              onCancel={() => setRepeating(null)}
                              onApply={async (rule, until) => {
                                if (await mutate(() => repeatStudyUnit(event.id, rule, until))) {
                                  setRepeating(null);
                                }
                              }}
                              onDeleteSeries={
                                event.series_key
                                  ? async () => {
                                      if (
                                        await mutate(() =>
                                          deleteStudyUnit(event.id, "series")
                                        )
                                      ) {
                                        setRepeating(null);
                                      }
                                    }
                                  : undefined
                              }
                            />
                          )}
                        </div>
                      ))}
                      {events.length === 0 && (
                        <div
                          className={`rounded-lg border border-dashed border-line px-2 text-center text-[10.5px] text-ink3 ${
                            mobile ? "py-2" : "py-5"
                          }`}
                        >
                          {t("st.dropHere")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("st.weekNote")}</p>
        </div>

        <div className="rounded-xl border border-line bg-panel2 p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setLibraryOpen((value) => !value)}
              aria-expanded={libraryOpen}
              className="flex items-center gap-2 text-left"
            >
              <ChevronDown size={15} className={`text-ink3 transition-transform ${libraryOpen ? "" : "-rotate-90"}`} />
              <span>
                <span className="block text-[13px] font-medium text-ink">{t("st.unitsLibrary")}</span>
                <span className="block text-[11.5px] text-ink3">{t("st.dragHint")}</span>
              </span>
            </button>
            <div className="flex items-center gap-2">
              <label className="hidden text-[11px] text-ink3 min-[700px]:block">
                {t("st.planFor")}{" "}
                <input
                  type="date"
                  value={planningDay}
                  onChange={(event) => setPlanningDay(event.target.value)}
                  className="ml-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12px] text-ink focus:border-accent-dim focus:outline-none"
                />
              </label>
              {/* Raster für die Schaltfläche "Planen" · leer bleibt ein
                  Einzeltermin, sonst entsteht direkt eine Serie. */}
              <label className="text-[11px] text-ink3">
                <span className="hidden min-[700px]:inline">{t("st.repeatTitle")} </span>
                <select
                  value={planRepeat}
                  onChange={(event) => setPlanRepeat(event.target.value as RepeatRule)}
                  aria-label={t("st.repeatTitle")}
                  className="ml-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[12px] text-ink focus:border-accent-dim focus:outline-none"
                >
                  <option value="">{t("st.repeatOnce")}</option>
                  {REPEAT_RULES.map((value) => (
                    <option key={value} value={value}>
                      {t(REPEAT_LABEL[value])}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setEditing({ ...EMPTY_TEMPLATE })}
                disabled={!desktop}
                className="rounded-lg border border-line p-2 text-ink3 hover:border-line2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t("st.addUnit")}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          {libraryOpen && (
            <div className="mt-3 grid gap-2 min-[700px]:grid-cols-2 min-[1200px]:grid-cols-4">
              {visibleCalendar.templates.map((template) => (
                <div key={template.id} className="group rounded-lg border border-line bg-panel p-3 hover:border-line2">
                  <div className="flex items-start gap-2">
                    <span
                      onPointerDown={(pointerEvent) =>
                        startDrag(pointerEvent, {
                          kind: "template",
                          id: template.id,
                          label: templateText(template, "title", t),
                        })
                      }
                      className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                      aria-label={t("st.dragUnit")}
                    >
                      <GripVertical size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-ink">
                        {templateText(template, "title", t)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink3">
                        <span className="flex items-center gap-1"><Clock3 size={11} /> {template.duration_min} min</span>
                        {template.tool && <span>{templateText(template, "tool", t)}</span>}
                      </div>
                      {template.description && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
                          {templateText(template, "desc", t)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      // Bearbeitet wird der Text, der auf dem Bildschirm
                      // steht · bei einer Startvorlage ist das die Übersetzung.
                      onClick={() =>
                        setEditing({
                          id: template.id,
                          title: templateText(template, "title", t),
                          duration_min: template.duration_min,
                          tool: templateText(template, "tool", t),
                          description: templateText(template, "desc", t),
                          area: template.area,
                        })
                      }
                      disabled={!desktop}
                      className="rounded-md p-1.5 text-ink3 hover:bg-panel2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t("common.edit")}
                    ><Pencil size={13} /></button>
                    <button
                      type="button"
                      onClick={() => void mutate(() => deleteStudyTemplate(template.id))}
                      disabled={!desktop}
                      className="rounded-md p-1.5 text-ink3 hover:bg-panel2 hover:text-loss disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t("common.delete")}
                    ><Trash2 size={13} /></button>
                    <Button
                      disabled={busy || !desktop || !planningDay}
                      onClick={() =>
                        void mutate(() =>
                          scheduleStudyUnit(
                            template.id,
                            planningDay,
                            planRepeat,
                            planRepeat ? defaultUntil(planningDay, planRepeat) : undefined
                          )
                        )
                      }
                      className="ml-1 !px-2.5 !py-1.5 !text-[11.5px]"
                    >
                      {planRepeat ? <Repeat size={12} /> : <Plus size={12} />} {t("st.plan")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <div className="rounded-xl border border-accent-dim bg-panel2 p-4">
            <div className="mb-3 text-[13px] font-medium text-ink">{editing.id ? t("st.editUnit") : t("st.newUnit")}</div>
            <div className="grid gap-3 min-[700px]:grid-cols-[1fr_120px_1fr_1fr]">
              <label className="text-[11px] text-ink3">{t("st.unitTitle")}<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" /></label>
              <label className="text-[11px] text-ink3">{t("st.duration")}<input type="number" min={5} max={480} value={editing.duration_min} onChange={(event) => setEditing({ ...editing, duration_min: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" /></label>
              {/* Der Bereich entscheidet, auf welches Budget die Einheit
                  einzahlt und woher der Wochenplan sie nimmt · früher wurde er
                  aus dem Titel geraten, und zwar nur auf Deutsch und Englisch. */}
              <label className="text-[11px] text-ink3">{t("st.unitArea")}
                <select
                  value={editing.area}
                  onChange={(event) => setEditing({ ...editing, area: event.target.value as Area | "" })}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none"
                >
                  <option value="">{t("st.areaNone")}</option>
                  {AREAS.map((area) => (
                    <option key={area} value={area}>{t(AREA_KEY[area])}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-ink3">{t("st.tool")}<input value={editing.tool} onChange={(event) => setEditing({ ...editing, tool: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" /></label>
            </div>
            <label className="mt-3 block text-[11px] text-ink3">{t("st.description")}<textarea rows={3} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] leading-relaxed text-ink focus:border-accent-dim focus:outline-none" /></label>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
              <Button primary disabled={busy || !editing.title.trim()} onClick={() => void saveTemplate()}>{t("common.save")}</Button>
            </div>
          </div>
        )}

        {error && <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-[12px] text-loss">{error}</div>}
      </div>

      {/* Zieh-Vorschau am Zeiger; pointer-events aus, damit elementFromPoint die
          Tageszelle darunter findet. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-accent-dim bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-ink shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.label}
        </div>
      )}
    </Card>
  );
}
