/**
 * Pseudonyme Nutzungsstatistik · ein Lebenszeichen pro Tag.
 *
 * Was gesendet wird, steht vollständig in `heartbeatPayload`: eine Kennung
 * dieser Installation, der Tag, Betriebssystem, Bezugsweg, App-Version und ob
 * Plus aktiv ist. Keine Partien, keine Analysen, keine Trainingsdaten, keine
 * Kontokennung und keine Adresse. Der Server sieht die Kennung nur als HMAC und
 * kann sie keinem Konto zuordnen.
 *
 * Die Statistik ist ab Werk an und in den Einstellungen abschaltbar. Wer sie
 * abschaltet, sendet nichts mehr: Das Backend löscht dabei die Kennung, und die
 * API weist eine Anfrage ohne den Kopf, den nur der eingeschaltete Zustand
 * setzt, mit 403 ab · drei Stellen, die dasselbe sagen.
 *
 * Fehler bleiben still. Ein Lebenszeichen ist nichts, wofür eine Oberfläche
 * einen Hinweis verdient; misslingt es, fehlt eine Zahl in einer Statistik.
 */
import { logEvent } from "./diag";
import { apiRequest } from "./plus/api";
import { getSettings, setSettings, type Settings } from "./settings";

/** Version des Nachrichtenformats · die API kennt derzeit nur die 1. */
const SCHEMA = 1;

const LAST_SENT_KEY = "kiebitz.analytics.lastDay";

/** Betriebssysteme, die die API annimmt. */
const PLATFORMS = ["windows", "macos", "linux", "android"] as const;

export type AnalyticsPlatform = (typeof PLATFORMS)[number];
export type AnalyticsDistribution = "desktop" | "play_store" | "sideload";

export interface Heartbeat {
  schema: number;
  installation_id: string;
  day: string;
  platform: AnalyticsPlatform;
  distribution: AnalyticsDistribution;
  version: string;
  tier: "free" | "plus";
}

export interface HeartbeatContext {
  installationId: string;
  /** `platform` aus `app_info`. */
  platform: string;
  /** `distribution` aus `app_info` · "play-store", "sideload" oder "desktop". */
  distribution: string;
  version: string;
  plus: boolean;
  now: Date;
}

/** Der Tag in UTC · die API rechnet in UTC und weist alles andere ab. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function asPlatform(value: string): AnalyticsPlatform | null {
  return (PLATFORMS as readonly string[]).includes(value) ? (value as AnalyticsPlatform) : null;
}

/**
 * Bildet den Bezugsweg auf die Werte der API ab.
 *
 * Das Backend schreibt "play-store" mit Bindestrich, die API erwartet
 * "play_store" mit Unterstrich. Außerdem sind Betriebssystem und Bezugsweg dort
 * gekoppelt: Android darf nicht "desktop" sein, alles andere muss es sein. Ein
 * Android-Build ohne Play-Merkmal ist ein Sideload; einem Desktop schreiben wir
 * "desktop" zu, was auch für ein sonderbares Feld aus dem Backend gilt.
 */
function asDistribution(platform: AnalyticsPlatform, value: string): AnalyticsDistribution {
  if (platform !== "android") return "desktop";
  return value === "play-store" || value === "play_store" ? "play_store" : "sideload";
}

/**
 * Die Nachricht · oder `null`, wenn diese Installation nichts zu melden hat.
 *
 * `null` heißt: kein bekanntes Betriebssystem (etwa die Browser-Vorschau oder
 * ein iOS-Build, den die API noch nicht kennt), keine Kennung oder keine
 * Version. In all diesen Fällen wäre die Zahl falsch statt fehlend.
 */
export function heartbeatPayload(context: HeartbeatContext): Heartbeat | null {
  const platform = asPlatform(context.platform);
  const version = context.version.trim();
  if (!platform || !context.installationId || !version) return null;
  return {
    schema: SCHEMA,
    installation_id: context.installationId,
    day: utcDay(context.now),
    platform,
    distribution: asDistribution(platform, context.distribution),
    version,
    tier: context.plus ? "plus" : "free",
  };
}

/**
 * Sorgt für eine Kennung, solange die Statistik an ist.
 *
 * Erzeugt wird sie erst hier · für eine abgeschaltete Statistik gibt es nichts
 * zu erzeugen. Sie wandert in die Einstellungen und bleibt dort, bis die
 * Statistik abgeschaltet wird.
 */
export async function ensureInstallationId(settings: Settings): Promise<string> {
  if (!settings.analytics_enabled) return "";
  if (settings.analytics_installation_id) return settings.analytics_installation_id;
  const installationId = crypto.randomUUID();
  const applied = await setSettings({ ...settings, analytics_installation_id: installationId });
  // Das Backend normalisiert und könnte die Kennung verwerfen · maßgeblich ist,
  // was zurückkommt, nicht was wir geschickt haben.
  return applied.analytics_installation_id;
}

export type HeartbeatOutcome =
  | "sent"
  | "switched_off"
  | "already_today"
  | "not_applicable"
  | "failed";

export interface HeartbeatOptions {
  /** `platform`, `distribution` und `version` aus `app_info`. */
  platform: string;
  distribution: string;
  version: string;
  plus: boolean;
  now?: Date;
}

/**
 * Schickt das Lebenszeichen dieses Tages, falls nötig.
 *
 * Der Tagesriegel liegt im `localStorage` und nicht in den Einstellungen: Ginge
 * er verloren, wäre die Folge ein zweites Lebenszeichen für denselben Tag, und
 * das fasst die API zu einer Zeile zusammen. Das ist die günstigere Seite des
 * Fehlers · Einstellungen jeden Tag neu zu schreiben wäre die teurere.
 */
export async function reportDailyHeartbeat(options: HeartbeatOptions): Promise<HeartbeatOutcome> {
  const now = options.now ?? new Date();
  const day = utcDay(now);
  if (localStorage.getItem(LAST_SENT_KEY) === day) return "already_today";

  let settings: Settings;
  try {
    settings = await getSettings();
  } catch {
    return "not_applicable";
  }
  if (!settings.analytics_enabled) return "switched_off";

  const installationId = await ensureInstallationId(settings).catch(() => "");
  const payload = heartbeatPayload({
    installationId,
    platform: options.platform,
    distribution: options.distribution,
    version: options.version,
    plus: options.plus,
    now,
  });
  if (!payload) return "not_applicable";

  try {
    await apiRequest<void>("/v1/analytics/heartbeat", {
      method: "POST",
      body: payload,
      // Der Kopf sagt der API, dass die Statistik auf diesem Gerät
      // eingeschaltet ist · ohne ihn nimmt sie nichts an. Der Name stammt aus
      // der Zeit des Opt-ins und bleibt, weil er auf der Leitung steht.
      headers: { "X-Kiebitz-Analytics-Consent": "1" },
    });
  } catch (error) {
    // Kein Hinweis in der Oberfläche · aber eine Zeile im lokalen Logbuch,
    // damit ein dauerhaft abgewiesenes Lebenszeichen auffindbar bleibt.
    logEvent("warn", "analytics", `Lebenszeichen nicht gesendet · ${String(error)}`);
    return "failed";
  }
  // Erst nach dem Erfolg · ein misslungener Versuch darf den Tag nicht
  // verbrauchen, der nächste Start soll es erneut versuchen.
  localStorage.setItem(LAST_SENT_KEY, day);
  return "sent";
}

/** Vergisst den Tagesriegel · für den Testknopf und das Ab- und Anschalten. */
export function forgetHeartbeatDay(): void {
  localStorage.removeItem(LAST_SENT_KEY);
}
