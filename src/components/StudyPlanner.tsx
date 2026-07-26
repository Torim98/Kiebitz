import { useEffect, useMemo, useState } from "react";
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
  Trash2,
} from "lucide-react";
import { Button, Card } from "./ui";
import { useI18n } from "../lib/i18n";
import {
  completeStudyUnit,
  deleteStudyTemplate,
  deleteStudyUnit,
  getStudyCalendar,
  moveStudyUnit,
  saveStudyTemplate,
  scheduleStudyUnit,
  type StudyCalendar,
  type StudyTemplate,
  type StudyTemplateInput,
} from "../lib/study";
import { onDataChange } from "../lib/changes";

const DAY_MS = 86_400_000;
const EMPTY_TEMPLATE: StudyTemplateInput = {
  title: "",
  duration_min: 20,
  tool: "",
  description: "",
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
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

/** Tag-Zelle unter einem Bildschirmpunkt — die Zellen tragen `data-study-day`. */
function dayAtPoint(x: number, y: number): string | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest("[data-study-day]") as HTMLElement | null;
  return cell?.dataset.studyDay ?? null;
}

export default function StudyPlanner({ desktop }: { desktop: boolean }) {
  const { locale, t } = useI18n();
  // Der Kalender ist der Hauptinhalt; die Vorlagen bleiben bis zum Aufklappen aus dem Weg.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [calendar, setCalendar] = useState<StudyCalendar>({ templates: [], events: [], days: [] });
  const [planningDay, setPlanningDay] = useState(() => isoDay(new Date()));
  const [editing, setEditing] = useState<StudyTemplateInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);

  const days = useMemo(
    () => [...Array(7)].map((_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart]
  );
  const previewCalendar = useMemo<StudyCalendar>(() => {
    const templates: StudyTemplate[] = [
      { id: 1, title: "Opening training", duration_min: 20, tool: "Kiebitz Repertoire", description: "Reinforce the first 8–10 moves and the ideas behind them." },
      { id: 2, title: "Endgame training", duration_min: 20, tool: "Kiebitz Endgames", description: "Train queen, rook, and fundamental pawn endings." },
      { id: 3, title: "Tactics", duration_min: 20, tool: "Kiebitz Puzzles", description: "15–20 puzzles: forks, pins, skewers, and discovered attacks." },
      { id: 4, title: "Game + analysis", duration_min: 40, tool: "Lichess + Kiebitz Analysis", description: "Play rapid, review yourself, then understand the three biggest errors." },
    ];
    const today = isoDay(new Date());
    const demoUnits = [14, 0, 9, 24, 6, 11, 0];
    return {
      templates,
      events: [
        { id: 1, template_id: 3, day: isoDay(days[2]), position: 0, completed: true, completed_ts: 1, template: templates[2] },
        { id: 2, template_id: 4, day: isoDay(days[5]), position: 0, completed: false, completed_ts: 0, template: templates[3] },
      ],
      days: days.map((date, index) => {
        const day = isoDay(date);
        const past = day <= today;
        return {
          day,
          puzzle_solved: past ? demoUnits[index] : 0,
          endgame_attempts: 0,
          rep_reviews: 0,
          game_reviews: past && index === 3 ? 1 : 0,
          units: past ? demoUnits[index] : 0,
          due_reviews: day >= today ? [14, 6, 9, 4, 11, 3, 7][index] : 0,
        };
      }),
    };
  }, [days]);
  const visibleCalendar = desktop ? calendar : previewCalendar;
  const today = isoDay(new Date());

  const refresh = async () => {
    if (!desktop) return;
    const data = await getStudyCalendar(isoDay(days[0]), isoDay(days[6]));
    setCalendar(data);
  };

  useEffect(() => {
    if (!desktop) return;
    refresh().catch((reason) => setError(String(reason)));
    const unsubscribe = onDataChange(() => {
      refresh().catch((reason) => setError(String(reason)));
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, weekStart]);

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
        {!desktop && (
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

          <div className="overflow-x-auto pb-1">
            <div className="grid min-w-[760px] grid-cols-7 gap-2">
              {days.map((date) => {
                const day = isoDay(date);
                const events = visibleCalendar.events.filter((event) => event.day === day);
                const metrics = (visibleCalendar.days ?? []).find((entry) => entry.day === day);
                const isToday = day === today;
                const future = day > today;
                const units = metrics?.units ?? 0;
                const due = (metrics?.due_reviews ?? 0) + events.filter((event) => !event.completed).length;
                return (
                  <div
                    key={day}
                    data-study-day={day}
                    className={`min-h-[300px] rounded-xl border p-2 transition-colors ${
                      drag?.over === day
                        ? "border-accent bg-accent-soft/60"
                        : isToday
                          ? "border-accent-dim bg-accent-soft/30"
                          : "border-line bg-panel2"
                    }`}
                  >
                    <div className="border-b border-line pb-2 text-center">
                      <div className="text-[10.5px] uppercase tracking-wide text-ink3">
                        {date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}
                      </div>
                      <div className={`mt-0.5 text-[18px] font-semibold ${isToday ? "text-accent" : "text-ink"}`}>
                        {date.getUTCDate()}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5 text-[10px]">
                        {!future && (
                          <span className={units > 0 ? "text-ink2" : "text-ink3"}>
                            {units} {t(units === 1 ? "st.units.one" : "st.units.many")}
                          </span>
                        )}
                        {(future || isToday) && due > 0 && (
                          <span className="text-gold">{t("st.due", { n: due })}</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-col gap-2">
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
                                  label: event.template.title,
                                })
                              }
                              className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                              aria-label={t("st.dragUnit")}
                            >
                              <GripVertical size={12} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className={`text-[11.5px] font-medium leading-tight ${event.completed ? "text-ink3 line-through" : "text-ink"}`}>
                                {event.template.title}
                              </div>
                              <div className="mt-1 text-[10px] text-ink3">{event.template.duration_min} min</div>
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
                              onClick={() => void mutate(() => deleteStudyUnit(event.id))}
                              disabled={!desktop}
                              className="rounded-md p-1 text-ink3 hover:bg-panel2 hover:text-loss"
                              aria-label={t("common.delete")}
                            ><Trash2 size={12} /></button>
                          </div>
                        </div>
                      ))}
                      {events.length === 0 && (
                        <div className="rounded-lg border border-dashed border-line px-2 py-5 text-center text-[10.5px] text-ink3">
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
                        startDrag(pointerEvent, { kind: "template", id: template.id, label: template.title })
                      }
                      className="mt-0.5 shrink-0 cursor-grab touch-none text-ink3 active:cursor-grabbing"
                      aria-label={t("st.dragUnit")}
                    >
                      <GripVertical size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-ink">{template.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink3">
                        <span className="flex items-center gap-1"><Clock3 size={11} /> {template.duration_min} min</span>
                        {template.tool && <span>{template.tool}</span>}
                      </div>
                      {template.description && (
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">{template.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(template)}
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
                      onClick={() => void mutate(() => scheduleStudyUnit(template.id, planningDay))}
                      className="ml-1 !px-2.5 !py-1.5 !text-[11.5px]"
                    >
                      <Plus size={12} /> {t("st.plan")}
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
            <div className="grid gap-3 min-[700px]:grid-cols-[1fr_120px_1fr]">
              <label className="text-[11px] text-ink3">{t("st.unitTitle")}<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" /></label>
              <label className="text-[11px] text-ink3">{t("st.duration")}<input type="number" min={5} max={480} value={editing.duration_min} onChange={(event) => setEditing({ ...editing, duration_min: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px] text-ink focus:border-accent-dim focus:outline-none" /></label>
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
