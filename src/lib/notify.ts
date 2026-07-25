/**
 * Tägliche Trainings-Erinnerung. Der Zeitplan lebt bewusst im Frontend: die
 * App prüft im Minutenraster, ob die eingestellte Uhrzeit erreicht ist, und
 * schickt dann höchstens eine lokale Benachrichtigung pro Tag — auf dem Desktop
 * und auf Android über dasselbe Tauri-Plugin.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { translator, type TFunc } from "./i18n";
import { getSettings, type Settings } from "./settings";
import { getStudyCalendar, studyData } from "./study";

const LAST_SENT_KEY = "kiebitz.notify.lastDay";
const CHECK_INTERVAL_MS = 60_000;

/** Was heute noch offen ist — Datenbasis des Erinnerungstexts. */
export interface ReminderInput {
  /** Offene geplante Lerneinheiten des Tages. */
  study: number;
  /** Fällige Repertoire-Wiederholungen. */
  repertoire: number;
  /** Bis zum Puzzle-Tagesziel fehlende Versuche. */
  puzzlesLeft: number;
  /** Wurde heute schon ein Endspiel trainiert? */
  endgameDone: boolean;
  /** Partien ohne Auto-Analyse. */
  unanalyzed: number;
}

/** Lokaler Tagesschlüssel (nicht UTC — die Uhrzeit ist eine lokale Angabe). */
export function localDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Minuten seit Mitternacht aus "HH:MM"; ungültige Angaben ergeben 18:00. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return 18 * 60;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return 18 * 60;
  return hours * 60 + minutes;
}

/** Erinnerungstext aus den aktivierten Kategorien; null = nichts zu tun. */
export function reminderBody(t: TFunc, settings: Settings, input: ReminderInput): string | null {
  const parts: string[] = [];
  if (settings.notify_study && input.study > 0) {
    parts.push(t("notify.study", { n: input.study }));
  }
  if (settings.notify_repertoire && input.repertoire > 0) {
    parts.push(t("notify.repertoire", { n: input.repertoire }));
  }
  if (settings.notify_puzzles && input.puzzlesLeft > 0) {
    parts.push(t("notify.puzzles", { n: input.puzzlesLeft }));
  }
  if (settings.notify_endgame && !input.endgameDone) {
    parts.push(t("notify.endgame"));
  }
  if (settings.notify_analysis && input.unanalyzed > 0) {
    parts.push(t("notify.analysis", { n: input.unanalyzed }));
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Fälligkeiten für heute einsammeln. */
export async function collectDue(): Promise<ReminderInput> {
  const today = localDay(new Date());
  const [data, calendar] = await Promise.all([
    studyData(),
    getStudyCalendar(today, today).catch(() => null),
  ]);
  const openUnits = (calendar?.events ?? []).filter(
    (event) => event.day === today && !event.completed
  ).length;
  return {
    study: openUnits,
    repertoire: data.due_now,
    puzzlesLeft: Math.max(0, data.puzzle_goal - data.today_puzzle_attempts),
    endgameDone: (data.activity[data.activity.length - 1]?.endgame_attempts ?? 0) > 0,
    unanalyzed: data.unanalyzed,
  };
}

/** Benachrichtigung senden; fragt bei Bedarf die Systemberechtigung ab. */
export async function notify(title: string, body: string): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === "granted";
  if (!granted) return false;
  sendNotification({ title, body });
  return true;
}

/** Sofort-Erinnerung für den Testknopf in den Einstellungen. */
export async function sendTestReminder(): Promise<boolean> {
  const settings = await getSettings();
  const t = translator(settings.locale);
  const body = reminderBody(t, settings, await collectDue()) ?? t("notify.allDone");
  return notify(t("notify.title"), body);
}

async function runCheck(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notify_enabled) return;
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < minutesOfDay(settings.notify_time)) return;
  const today = localDay(now);
  if (localStorage.getItem(LAST_SENT_KEY) === today) return;
  const body = reminderBody(translator(settings.locale), settings, await collectDue());
  // Auch ein stiller Tag gilt als erledigt — höchstens eine Erinnerung pro Tag.
  localStorage.setItem(LAST_SENT_KEY, today);
  if (body) await notify(translator(settings.locale)("notify.title"), body);
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Startet die Minutenprüfung (idempotent). */
export function startReminders(): void {
  if (timer != null) return;
  const tick = () => void runCheck().catch(() => {});
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  tick();
}

export function stopReminders(): void {
  if (timer == null) return;
  clearInterval(timer);
  timer = null;
}
