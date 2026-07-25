/**
 * Trainings-Erinnerungen im Frontend.
 *
 * Drei Wege, je nach Plattform:
 *   * Läuft die App, prüft ein Timer im Minutenraster und schickt den fertigen
 *     Text ans Backend (`notify_now`) — dort meldet Windows auch Fehler zurück.
 *   * Windows plant zusätzlich eine Aufgabe, die Kiebitz zur eingestellten Zeit
 *     mit `--reminder` startet; dafür genügt ein Aufruf von
 *     `sync_reminder_schedule` nach jeder Änderung.
 *   * Android hinterlegt die Erinnerung im AlarmManager (Schedule.interval),
 *     damit sie auch ohne laufende App kommt.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  cancel,
  isPermissionGranted,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { translator, type TFunc } from "./i18n";
import { getSettings, type Settings } from "./settings";
import { getStudyCalendar, studyData } from "./study";
import type { BackendInfo } from "./backend";

const LAST_SENT_KEY = "kiebitz.notify.lastDay";
const CHECK_INTERVAL_MS = 60_000;
/** Feste ID der geplanten Android-Erinnerung, damit sie ersetzbar bleibt. */
const SCHEDULED_ID = 4711;

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

async function isMobile(): Promise<boolean> {
  const info = await invoke<BackendInfo>("app_info").catch(() => null);
  return info?.platform === "android" || info?.platform === "ios";
}

/** Systemberechtigung sicherstellen (Android fragt beim ersten Mal nach). */
export async function ensurePermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    // Desktop-Backends ohne Berechtigungskonzept melden hier einen Fehler.
    return true;
  }
}

/**
 * Benachrichtigung sofort zeigen. Wirft mit Klartext, wenn das System sie
 * ablehnt — der Testknopf in den Einstellungen zeigt genau diese Meldung.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensurePermission())) throw new Error("permission-denied");
  if (await isMobile()) {
    sendNotification({ title, body });
    return;
  }
  await invoke("notify_now", { title, body });
}

/**
 * Betriebssystem-Planung angleichen: Windows-Aufgabe bzw. Android-Alarm.
 * Wird beim Start und nach jedem Speichern der Einstellungen aufgerufen.
 */
export async function applyReminderSchedule(): Promise<void> {
  const settings = await getSettings();
  if (await isMobile()) {
    await cancel([SCHEDULED_ID]).catch(() => {});
    if (!settings.notify_enabled) return;
    if (!(await ensurePermission())) return;
    const t = translator(settings.locale);
    const due = await collectDue().catch(() => null);
    const [hour, minute] = settings.notify_time.split(":").map(Number);
    sendNotification({
      id: SCHEDULED_ID,
      title: t("notify.title"),
      // Der Alarm trägt den Stand des letzten App-Starts; Details stehen in
      // der App, sobald sie geöffnet wird.
      body: (due && reminderBody(t, settings, due)) ?? t("notify.scheduled"),
      schedule: Schedule.interval({ hour, minute }, true),
    });
    return;
  }
  // Desktop: Aufgabenplanung anlegen und den aktuellen Text hinterlegen — der
  // Hintergrundlauf greift darauf zurück, wenn er die Datenbank nicht öffnen
  // kann (WAL-Zustand, Sperren).
  await invoke<string>("sync_reminder_schedule").catch(() => "");
  if (!settings.notify_enabled) return;
  const t = translator(settings.locale);
  const due = await collectDue().catch(() => null);
  const body = due && reminderBody(t, settings, due);
  if (body) {
    await invoke("save_reminder_snapshot", { title: t("notify.title"), body }).catch(() => {});
  }
}

/** Sofort-Erinnerung für den Testknopf in den Einstellungen. */
export async function sendTestReminder(): Promise<void> {
  const settings = await getSettings();
  const t = translator(settings.locale);
  const body = reminderBody(t, settings, await collectDue()) ?? t("notify.allDone");
  await notify(t("notify.title"), body);
}

async function runCheck(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notify_enabled) return;
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < minutesOfDay(settings.notify_time)) return;
  const today = localDay(now);
  if (localStorage.getItem(LAST_SENT_KEY) === today) return;
  // Android erledigt die Erinnerung über den geplanten Alarm — hier nur der
  // Fall „App läuft gerade“ auf dem Desktop.
  if (await isMobile()) return;
  const t = translator(settings.locale);
  const body = reminderBody(t, settings, await collectDue());
  // Auch ein stiller Tag gilt als erledigt — höchstens eine Erinnerung pro Tag.
  localStorage.setItem(LAST_SENT_KEY, today);
  if (body) await notify(t("notify.title"), body).catch(() => {});
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Startet die Minutenprüfung und gleicht die OS-Planung ab (idempotent). */
export function startReminders(): void {
  void applyReminderSchedule().catch(() => {});
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
