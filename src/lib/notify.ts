/**
 * Trainings-Erinnerungen im Frontend.
 *
 * Drei Wege, je nach Plattform:
 *   * Läuft die App, prüft ein Timer im Minutenraster und schickt den fertigen
 *     Text ans Backend (`notify_now`) · dort meldet Windows auch Fehler zurück.
 *   * Windows plant zusätzlich eine Aufgabe, die Kiebitz zur eingestellten Zeit
 *     mit `--reminder` startet; dafür genügt ein Aufruf von
 *     `sync_reminder_schedule` nach jeder Änderung.
 *   * Android hinterlegt eine ungefähre tägliche Erinnerung im AlarmManager
 *     (Schedule.interval), damit sie auch ohne laufende App kommt. Kiebitz
 *     fordert bewusst keine eingeschränkte Exact-Alarm-Berechtigung an.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  cancel,
  Schedule,
} from "@tauri-apps/plugin-notification";
import { loadTranslator, type TFunc } from "./i18n";
import { getSettings, type Settings } from "./settings";
import { getStudyCalendar, studyData } from "./study";
import type { BackendInfo } from "./backend";

const LAST_SENT_KEY = "kiebitz.notify.lastDay";
const CHECK_INTERVAL_MS = 60_000;
/**
 * Feste IDs der geplanten Android-Alarme, damit sie ersetzbar bleiben.
 *
 * Sieben statt einem: Ein `Schedule.interval` ohne Wochentag wiederholt sich
 * täglich mit *demselben* Text — der Wochenrückblick würde damit auch am
 * Montag und Dienstag erscheinen. Mit einem Wochentag je Alarm trägt jeder
 * Abend den Text, der zu ihm gehört, und der Sonntag den Rückblick.
 *
 * `weekday` zählt im Plugin ab Sonntag = 1.
 */
const SCHEDULED_IDS = [4711, 4712, 4713, 4714, 4715, 4716, 4717] as const;

/**
 * Eigener Kanal statt des Plugin-Vorgabekanals „Default".
 *
 * Der Kanal ist das, was Android dem Nutzer zeigt: in den Systemeinstellungen
 * unter der App, als Untertitel der aufgeklappten Meldung und in der Auswahl,
 * was leise sein soll. „Default" sagt dort nichts · „Trainings-Erinnerungen"
 * sagt, worum es geht, und macht die Meldung abschaltbar, ohne dass Kiebitz
 * ganz verstummt.
 */
const CHANNEL_ID = "training";
/** Akzentfarbe der App (--color-accent) · Symbol und Kanallicht tragen sie. */
const ACCENT = "#22C08A";

/** Steht der Kanal? Sonst bleibt es beim Vorgabekanal (siehe `ensureNotificationChannel`). */
let channelReady = false;

type NativeNotificationOptions = {
  id?: number;
  title: string;
  body: string;
  /** Aufgeklappte Fassung (BigTextStyle) · zusammengeklappt bleibt eine Zeile. */
  largeBody?: string;
  /** Name eines Drawables in `gen/android/app/src/main/res/drawable`. */
  icon?: string;
  /** Färbt Symbol und Absenderzeile in der Benachrichtigungsleiste. */
  iconColor?: string;
  channelId?: string;
  /** Antippen räumt die Meldung weg. */
  autoCancel?: boolean;
  /** 1 = auch auf dem Sperrbildschirm lesbar · eine Erinnerung ist nicht privat. */
  visibility?: number;
  schedule?: ReturnType<typeof Schedule.interval>;
  /**
   * Android's batch command persists this verbatim for pending alarms and
   * reboot restoration. The regular `notify` command does not need it.
   */
  sourceJson?: string;
};

/**
 * Aussehen jeder Android-Meldung an einer Stelle.
 *
 * Zusammengeklappt zeigt Android genau eine Zeile · steht dort der ganze Text,
 * bricht er mitten im Satz ab („2 Tage in Folge — heute noch …"). Deshalb
 * trägt `body` nur den Aufmacher, und die Aufzählung kommt beim Aufklappen.
 *
 * Symbol und Farbe stehen zusätzlich in tauri.conf.json (`plugins.notification`)
 * als Vorgabe für alles, was das Plugin selbst baut · hier stehen sie an der
 * Meldung, weil sie so auch den Weg über den AlarmManager und einen Neustart
 * überstehen: der Alarm wird aus genau diesem Objekt wiederhergestellt.
 */
function androidNotification(title: string, body: string): NativeNotificationOptions {
  const [lead] = body.split("\n");
  return {
    title,
    body: lead,
    largeBody: body.includes("\n") ? body : undefined,
    icon: "ic_notification",
    iconColor: ACCENT,
    autoCancel: true,
    visibility: 1,
    ...(channelReady ? { channelId: CHANNEL_ID } : {}),
  };
}

/**
 * Den Kanal anlegen (idempotent) · Name und Beschreibung in der Sprache der
 * App, damit die Systemeinstellungen nicht englisch dazwischenfunken.
 *
 * Schlägt es fehl, bleibt `channelReady` false und die Meldungen laufen über
 * den Vorgabekanal weiter: Android verwirft eine Benachrichtigung stillschweigend,
 * wenn sie auf einen Kanal zeigt, den es nicht gibt.
 */
export async function ensureNotificationChannel(t: TFunc): Promise<void> {
  try {
    await invoke("plugin:notification|create_channel", {
      id: CHANNEL_ID,
      name: t("notify.channel"),
      description: t("notify.channelHint"),
      importance: 3,
      visibility: 1,
      lights: true,
      // Das Plugin liest hier `lightsColor` · der JS-Wrapper schickt fälschlich
      // `lightColor`, deshalb geht der Aufruf hier direkt an das Plugin.
      lightsColor: ACCENT,
      vibration: true,
    });
    channelReady = true;
  } catch {
    channelReady = false;
  }
}

/** Was heute noch offen ist · Datenbasis des Erinnerungstexts. */
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
  /** Tage in Folge mit Training · dieselbe Zahl wie im Kopf der App. */
  streakDays: number;
  /** Heute bereits gemessene Minuten. */
  todayMinutes: number;
  /** Diese Woche bereits gemessene Minuten. */
  weekMinutes: number;
}

/** Eine fertige Benachrichtigung · Titel, Aufmacher und Aufzählung. */
export interface ReminderMessage {
  title: string;
  /**
   * Die erste Zeile · sie sagt, warum diese Meldung *heute* kommt. Vorher
   * begann die Erinnerung mit „2 geplante Einheiten · 14 Wiederholungen
   * fällig · …" — eine Aufzählung ohne Anlass, die auf dem Sperrbildschirm
   * nach einer Systemmeldung aussieht und nicht nach Kiebitz.
   */
  lead: string;
  /** Die Aufzählung darunter; leer, wenn nichts mehr offen ist. */
  detail: string;
  /** Titel und Text zusammengesetzt · für Kanäle mit nur einem Textfeld. */
  body: string;
}

/** Lokaler Tagesschlüssel (nicht UTC · die Uhrzeit ist eine lokale Angabe). */
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

/**
 * Ist heute der letzte Tag der Woche?
 *
 * Sonntag · dann tritt an die Stelle der Erinnerung der Rückblick. Bewusst
 * *statt* und nicht *zusätzlich*: Zwei Meldungen an einem Abend sind eine zu
 * viel, und wer am Sonntagabend noch trainiert, weiß auch ohne Aufzählung, was
 * offen ist.
 */
export function isWeekEnd(now: Date): boolean {
  return now.getDay() === 0;
}

/**
 * Der Aufmacher · eine Zeile, die sagt, warum die Meldung heute kommt.
 *
 * Die Reihenfolge ist die Rangfolge: Der Wochenrückblick schlägt alles, dann
 * die Serie, die heute reißen würde, dann das offene Wochenziel. Bleibt
 * nichts davon, steht dort der schlichte Anlass · besser als eine erfundene
 * Dringlichkeit.
 */
export function reminderLead(
  t: TFunc,
  settings: Settings,
  input: ReminderInput,
  now: Date
): string {
  if (isWeekEnd(now)) {
    return settings.weekly_minutes > 0
      ? t("notify.leadWeekReview", { a: input.weekMinutes, m: settings.weekly_minutes })
      : t("notify.leadWeekReviewOpen", { a: input.weekMinutes });
  }
  // Eine Serie ist das Einzige, was ein verpasster Abend endgültig kostet ·
  // deshalb steht sie vorn, sobald sie wirklich auf dem Spiel steht.
  if (input.streakDays >= 2 && input.todayMinutes === 0) {
    return t("notify.leadStreak", { n: input.streakDays });
  }
  const open = settings.weekly_minutes - input.weekMinutes;
  if (settings.weekly_minutes > 0 && open > 0) {
    return t("notify.leadWeekOpen", { m: open });
  }
  return t("notify.leadPlain");
}

/**
 * Die fertige Meldung.
 *
 * `null`, wenn es nichts zu sagen gibt · das ist am Wochenende anders als
 * unter der Woche: Der Rückblick lohnt sich auch dann, wenn nichts mehr offen
 * ist, denn er berichtet über die Woche und nicht über heute Abend.
 */
export function reminderMessage(
  t: TFunc,
  settings: Settings,
  input: ReminderInput,
  now: Date
): ReminderMessage | null {
  const detail = reminderBody(t, settings, input) ?? "";
  const review = isWeekEnd(now);
  if (!detail && !review) return null;
  const lead = reminderLead(t, settings, input, now);
  return {
    title: review ? t("notify.titleWeek") : t("notify.title"),
    lead,
    detail,
    // Ein Kanal mit nur einem Textfeld bekommt beides untereinander · der
    // Zeilenumbruch ist auf Windows wie auf Android das, was zwei Zeilen ergibt.
    body: detail ? `${lead}\n${detail}` : lead,
  };
}

/** Fälligkeiten für heute einsammeln. */
export async function collectDue(now = new Date()): Promise<ReminderInput> {
  const today = localDay(now);
  // Der Kalender kommt jetzt für die ganze Woche · aus denselben Tagen, aus
  // denen die App ihre Wochenbilanz rechnet. Ein zweiter Zeitraum für dieselbe
  // Zahl wäre die sicherste Art, beiden nicht mehr zu glauben.
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const [data, calendar] = await Promise.all([
    studyData(),
    getStudyCalendar(localDay(monday), localDay(sunday)).catch(() => null),
  ]);
  const openUnits = (calendar?.events ?? []).filter(
    (event) => event.day === today && !event.completed
  ).length;
  const days = calendar?.days ?? [];
  return {
    study: openUnits,
    repertoire: data.due_now,
    puzzlesLeft: Math.max(0, data.puzzle_goal - data.today_puzzle_attempts),
    endgameDone: (data.activity[data.activity.length - 1]?.endgame_attempts ?? 0) > 0,
    unanalyzed: data.unanalyzed,
    streakDays: Math.max(0, data.streak_days),
    todayMinutes: days.find((day) => day.day === today)?.actual_minutes ?? 0,
    weekMinutes: days.reduce((sum, day) => sum + day.actual_minutes, 0),
  };
}

async function isMobile(): Promise<boolean> {
  const info = await invoke<BackendInfo>("app_info").catch(() => null);
  return info?.platform === "android" || info?.platform === "ios";
}

/** Systemberechtigung sicherstellen (Android fragt beim ersten Mal nach). */
export async function ensurePermission(): Promise<boolean> {
  try {
    const granted = await invoke<boolean | null>(
      "plugin:notification|is_permission_granted"
    );
    if (granted === true) return true;
    if (granted === false) return false;
    return (
      (await invoke<string>("plugin:notification|request_permission")) ===
      "granted"
    );
  } catch {
    // Desktop-Backends ohne Berechtigungskonzept melden hier einen Fehler.
    return true;
  }
}

/** Native plugin call; avoids Android WebView's non-constructable Notification shim. */
function nativeNotification(options: NativeNotificationOptions): Promise<void> {
  return invoke<void>("plugin:notification|notify", { options });
}

/**
 * Geplante Android-Benachrichtigungen müssen über `batch` angelegt werden:
 * Nur dieser native Plugin-Pfad persistiert den Alarm für `get_pending` und
 * stellt ihn nach einem Geräte-Neustart wieder her.
 */
async function nativeScheduledNotifications(
  batch: NativeNotificationOptions[]
): Promise<void> {
  // The Android plugin does not populate `sourceJson` while deserializing the
  // batch argument. Without it, it stores the literal string "null"; the next
  // get_pending call then fails inside the plugin and reboot restoration has
  // no notification to deserialize.
  const persisted = batch.map((options) => ({
    ...options,
    sourceJson: JSON.stringify(options),
  }));
  // Alle sieben Wochentage in *einem* Aufruf · der AlarmManager nimmt sie
  // gemeinsam an oder gar nicht, und eine halb angelegte Woche wäre schlimmer
  // als keine.
  const scheduled = await invoke<number[]>("plugin:notification|batch", {
    notifications: persisted,
  });
  // `get_pending` cannot currently cross the Android bridge: the plugin
  // returns native PendingNotification objects for which Jackson has no bean
  // serializer. The batch result already contains the IDs accepted by the
  // AlarmManager and is the safe acknowledgement to validate here.
  const missing = batch
    .map((options) => options.id)
    .filter((id): id is number => id != null && !scheduled.includes(id));
  if (missing.length > 0) {
    throw new Error("Die geplante Android-Benachrichtigung wurde nicht registriert.");
  }
}

/**
 * Benachrichtigung sofort zeigen. Wirft mit Klartext, wenn das System sie
 * ablehnt · der Testknopf in den Einstellungen zeigt genau diese Meldung.
 */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensurePermission())) throw new Error("permission-denied");
  if (await isMobile()) {
    await nativeNotification(androidNotification(title, body));
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
    await cancel([...SCHEDULED_IDS]).catch(() => {});
    if (!settings.notify_enabled) return;
    if (!(await ensurePermission())) return;
    const t = await loadTranslator(settings.locale);
    // Vor dem Planen · die Alarme tragen den Kanal, den es dann geben muss.
    await ensureNotificationChannel(t);
    const due = await collectDue().catch(() => null);
    const [hour, minute] = settings.notify_time.split(":").map(Number);
    // Je Wochentag ein Alarm mit dem Text, der an diesem Abend gilt · der
    // Sonntag bekommt den Rückblick, die übrigen sechs die Erinnerung. Der
    // Datenstand ist für alle derselbe (der des letzten App-Starts); was sich
    // unterscheidet, ist die *Form* der Meldung, und die hängt am Wochentag.
    const batch = SCHEDULED_IDS.map((id, index) => {
      // index 0 = Sonntag, dann Montag bis Samstag · wie `weekday` im Plugin.
      const weekday = index + 1;
      const sample = new Date();
      sample.setDate(sample.getDate() + ((weekday - 1 - sample.getDay() + 7) % 7));
      const message = due && reminderMessage(t, settings, due, sample);
      return {
        id,
        // Der Alarm trägt den Stand des letzten App-Starts; Details stehen in
        // der App, sobald sie geöffnet wird.
        ...androidNotification(
          message?.title ?? t("notify.title"),
          message?.body ?? t("notify.scheduled")
        ),
        // Eine Trainingserinnerung ist nicht zeitkritisch. `allowWhileIdle=false`
        // hält die Planung batterie- und Play-richtlinienfreundlich; Android darf
        // sie im Doze-Modus auf ein geeignetes Wartungsfenster verschieben.
        schedule: Schedule.interval({ weekday, hour, minute }, false),
      };
    });
    await nativeScheduledNotifications(batch);
    return;
  }
  // Desktop: Aufgabenplanung anlegen und den aktuellen Text hinterlegen · der
  // Hintergrundlauf greift darauf zurück, wenn er die Datenbank nicht öffnen
  // kann (WAL-Zustand, Sperren).
  await invoke<string>("sync_reminder_schedule").catch(() => "");
  if (!settings.notify_enabled) return;
  const t = await loadTranslator(settings.locale);
  const due = await collectDue().catch(() => null);
  const message = due && reminderMessage(t, settings, due, new Date());
  if (message) {
    await invoke("save_reminder_snapshot", {
      title: message.title,
      body: message.body,
    }).catch(() => {});
  }
}

/** Sofort-Erinnerung für den Testknopf in den Einstellungen. */
export async function sendTestReminder(): Promise<void> {
  const settings = await getSettings();
  const t = await loadTranslator(settings.locale);
  // Der Testknopf ist auf Android oft die erste Meldung überhaupt · ohne
  // vorher angelegten Kanal käme sie im Vorgabekanal „Default" an.
  if (await isMobile()) await ensureNotificationChannel(t);
  const now = new Date();
  const message = reminderMessage(t, settings, await collectDue(now), now);
  // Der Testknopf zeigt immer etwas · sonst wäre „nichts passiert" nicht von
  // „Benachrichtigungen kommen nicht durch" zu unterscheiden.
  await notify(message?.title ?? t("notify.title"), message?.body ?? t("notify.allDone"));
}

async function runCheck(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notify_enabled) return;
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < minutesOfDay(settings.notify_time)) return;
  const today = localDay(now);
  if (localStorage.getItem(LAST_SENT_KEY) === today) return;
  // Android erledigt die Erinnerung über den geplanten Alarm · hier nur der
  // Fall „App läuft gerade“ auf dem Desktop.
  if (await isMobile()) return;
  const t = await loadTranslator(settings.locale);
  const message = reminderMessage(t, settings, await collectDue(now), now);
  // Auch ein stiller Tag gilt als erledigt · höchstens eine Erinnerung pro Tag.
  localStorage.setItem(LAST_SENT_KEY, today);
  if (message) await notify(message.title, message.body).catch(() => {});
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
