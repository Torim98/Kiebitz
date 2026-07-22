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

export default function StudyPlanner({ desktop }: { desktop: boolean }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [calendar, setCalendar] = useState<StudyCalendar>({ templates: [], events: [] });
  const [planningDay, setPlanningDay] = useState(() => isoDay(new Date()));
  const [editing, setEditing] = useState<StudyTemplateInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const days = useMemo(
    () => [...Array(7)].map((_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart]
  );
  const previewCalendar = useMemo<StudyCalendar>(() => {
    const templates: StudyTemplate[] = locale === "de" ? [
      { id: 1, title: "Eröffnungs-Training", duration_min: 20, tool: "Kiebitz Repertoire", description: "Die ersten 8–10 Züge und die Ideen dahinter festigen." },
      { id: 2, title: "Endspiel-Training", duration_min: 20, tool: "Kiebitz Endgames", description: "Dame, Turm und grundlegende Bauernendspiele trainieren." },
      { id: 3, title: "Taktik", duration_min: 20, tool: "Kiebitz Puzzles", description: "15–20 Aufgaben: Gabel, Fesselung, Spieß und Abzug." },
      { id: 4, title: "Partie + Analyse", duration_min: 40, tool: "Lichess + Kiebitz Analysis", description: "Rapid spielen, selbst prüfen und die drei größten Fehler verstehen." },
    ] : [
      { id: 1, title: "Opening training", duration_min: 20, tool: "Kiebitz Repertoire", description: "Reinforce the first 8–10 moves and the ideas behind them." },
      { id: 2, title: "Endgame training", duration_min: 20, tool: "Kiebitz Endgames", description: "Train queen, rook, and fundamental pawn endings." },
      { id: 3, title: "Tactics", duration_min: 20, tool: "Kiebitz Puzzles", description: "15–20 puzzles: forks, pins, skewers, and discovered attacks." },
      { id: 4, title: "Game + analysis", duration_min: 40, tool: "Lichess + Kiebitz Analysis", description: "Play rapid, review yourself, then understand the three biggest errors." },
    ];
    return {
      templates,
      events: [
        { id: 1, template_id: 3, day: isoDay(days[2]), position: 0, completed: true, completed_ts: 1, template: templates[2] },
        { id: 2, template_id: 4, day: isoDay(days[5]), position: 0, completed: false, completed_ts: 0, template: templates[3] },
      ],
    };
  }, [days, locale]);
  const visibleCalendar = desktop ? calendar : previewCalendar;

  const refresh = async () => {
    if (!desktop) return;
    const data = await getStudyCalendar(isoDay(days[0]), isoDay(days[6]));
    setCalendar(data);
  };

  useEffect(() => {
    if (!open || !desktop) return;
    refresh().catch((reason) => setError(String(reason)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, desktop, weekStart]);

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

  const dropOnDay = (day: string, payload: string) => {
    if (!desktop) return;
    const [kind, rawId] = payload.split(":");
    const id = Number(rawId);
    if (!Number.isFinite(id)) return;
    if (kind === "template") void mutate(() => scheduleStudyUnit(id, day));
    if (kind === "event") {
      const position = visibleCalendar.events.filter((event) => event.day === day).length;
      void mutate(() => moveStudyUnit(id, day, position));
    }
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
          <CalendarDays size={15} className="text-accent" /> {t("st.plannerTitle")}
        </span>
      }
      action={
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-ink3 hover:bg-panel2 hover:text-ink"
          aria-expanded={open}
        >
          {open ? t("st.collapse") : t("st.expand")}
          <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {!open ? (
        <p className="text-[12.5px] text-ink3">{t("st.plannerCollapsed")}</p>
      ) : (
        <div className="space-y-4">
          {!desktop && (
            <div className="rounded-lg border border-dashed border-line2 px-3 py-2 text-[12px] text-ink3">
              {t("st.plannerDesktop")}
            </div>
          )}

          <div className="grid gap-4 min-[1000px]:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-line bg-panel2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium text-ink">{t("st.unitsLibrary")}</div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">{t("st.dragHint")}</div>
                </div>
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

              <label className="mt-3 block text-[11px] text-ink3">
                {t("st.planFor")}
                <input
                  type="date"
                  value={planningDay}
                  onChange={(event) => setPlanningDay(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-[12px] text-ink focus:border-accent-dim focus:outline-none"
                />
              </label>

              <div className="mt-3 flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1">
                {visibleCalendar.templates.map((template) => (
                  <div
                    key={template.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", `template:${template.id}`)}
                    className="group rounded-lg border border-line bg-panel p-3 hover:border-line2"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical size={15} className="mt-0.5 shrink-0 cursor-grab text-ink3" />
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
            </aside>

            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-medium text-ink">
                    {days[0].toLocaleDateString(locale, { day: "2-digit", month: "long", timeZone: "UTC" })}
                    {" – "}
                    {days[6].toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">{t("st.calendarHint")}</div>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))} className="rounded-lg border border-line p-2 text-ink3 hover:text-ink"><ChevronLeft size={15} /></button>
                  <Button onClick={() => setWeekStart(mondayOf(new Date()))} className="!px-2.5 !py-1.5">{t("st.currentWeek")}</Button>
                  <button type="button" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))} className="rounded-lg border border-line p-2 text-ink3 hover:text-ink"><ChevronRight size={15} /></button>
                </div>
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="grid min-w-[760px] grid-cols-7 gap-2">
                  {days.map((date) => {
                    const day = isoDay(date);
                    const events = visibleCalendar.events.filter((event) => event.day === day);
                    const today = day === isoDay(new Date());
                    const completedMinutes = events
                      .filter((event) => event.completed)
                      .reduce((sum, event) => sum + event.template.duration_min, 0);
                    return (
                      <div
                        key={day}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => dropOnDay(day, event.dataTransfer.getData("text/plain"))}
                        className={`min-h-[300px] rounded-xl border p-2 ${today ? "border-accent-dim bg-accent-soft/30" : "border-line bg-panel2"}`}
                      >
                        <div className="border-b border-line pb-2 text-center">
                          <div className="text-[10.5px] uppercase tracking-wide text-ink3">{date.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}</div>
                          <div className={`mt-0.5 text-[18px] font-semibold ${today ? "text-accent" : "text-ink"}`}>{date.getUTCDate()}</div>
                          <div className="mt-0.5 text-[10px] text-ink3">{completedMinutes > 0 ? `${completedMinutes} min ${t("st.completedShort")}` : " "}</div>
                        </div>
                        <div className="mt-2 flex flex-col gap-2">
                          {events.map((event) => (
                            <div
                              key={event.id}
                              draggable
                              onDragStart={(dragEvent) => dragEvent.dataTransfer.setData("text/plain", `event:${event.id}`)}
                              className={`rounded-lg border p-2 ${event.completed ? "border-accent-dim bg-accent-soft/50" : "border-line2 bg-panel"}`}
                            >
                              <div className="flex items-start gap-1.5">
                                <GripVertical size={12} className="mt-0.5 shrink-0 cursor-grab text-ink3" />
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[11.5px] font-medium leading-tight ${event.completed ? "text-ink3 line-through" : "text-ink"}`}>{event.template.title}</div>
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
                            <div className="rounded-lg border border-dashed border-line px-2 py-5 text-center text-[10.5px] text-ink3">{t("st.dropHere")}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
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
      )}
    </Card>
  );
}
