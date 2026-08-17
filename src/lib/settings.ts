import { invoke } from "@tauri-apps/api/core";
import { emitDataChange } from "./changes";
// Nur der Typ · zur Laufzeit importiert i18n dieses Modul, nicht umgekehrt.
import type { Locale } from "./i18n";

/** Spiegelt settings::Settings aus dem Rust-Backend. */
export interface Settings {
  locale: Locale;
  db_path: string | null;
  engine_path: string | null;
  engine_threads: number; // 0 = automatisch
  engine_hash_mb: number;
  engine_multipv: number;
  live_depth: number;
  batch_depth: number;
  syzygy_path: string | null;
  chessdb_enabled: boolean;
  /** Neue Partien beim Start und im Hintergrund nachladen. */
  auto_import: boolean;
  cc_user: string;
  li_user: string;
  /** Anzeigename fürs Dashboard (leer = Benutzername). */
  display_name: string;
  import_months: number;
  puzzle_goal: number;
  /** Motiv der laufenden Aufgabe im Puzzle-Training verdecken. */
  puzzle_hide_theme: boolean;
  /** Fällige Repertoire-Züge je Trainingssitzung (0 = alle). */
  rep_due_limit: number;
  /** Neue Repertoire-Züge je Trainingssitzung (0 = alle). */
  rep_new_limit: number;
  /** Zug- und Schlagklänge auf allen Brettern. */
  sound_enabled: boolean;
  /** Lautstärke der Brettklänge in Prozent (0 … 100). */
  sound_volume: number;
  auto_update: boolean;
  /** Sync-Server (Desktop-Hub) beim Start mitstarten. */
  sync_enabled: boolean;
  /** Pairing-Code · Desktop: generiert/angezeigt; Mobile: vom Desktop übernommen. */
  sync_code: string;
  /** Mobile: Adresse des Desktop-Hubs ("host:port"). */
  sync_host: string;
  /** SHA-256-Fingerprint des per QR gekoppelten HTTPS-Hubs. */
  sync_fingerprint: string;
  /** Mobile: automatisch im Hintergrund synchronisieren (Änderungen/Timer/Fokus). */
  sync_auto: boolean;
  /** Tägliche Erinnerung an anstehendes Training. */
  notify_enabled: boolean;
  /** Uhrzeit der Erinnerung als lokale "HH:MM". */
  notify_time: string;
  notify_study: boolean;
  notify_repertoire: boolean;
  notify_puzzles: boolean;
  notify_endgame: boolean;
  notify_analysis: boolean;
  /** Trainingsbudget in Minuten pro Woche (0 = aus der Aktivität ableiten). */
  weekly_minutes: number;
  /** Trainingstage als Bitmaske, Bit 0 = Montag (0 = keine Vorgabe). */
  training_days: number;
  /** Optionales Zieldatum "YYYY-MM-DD" (leer = keins). */
  goal_date: string;
  /** Länge eines Fokus-Zyklus in Tagen: 7, 14 oder 28. */
  focus_cycle_days: number;
  /** Wurde die Ersteinrichtung durchlaufen? */
  onboarded: boolean;
  /** Pseudonyme Nutzungsstatistik (ab Werk an, hier abschaltbar). */
  analytics_enabled: boolean;
  /**
   * Kennung dieser Installation für die Statistik (leer = keine).
   *
   * Das Backend löscht sie, sobald die Statistik abgeschaltet wird · ein
   * gesetzter Wert bedeutet also immer, dass sie an ist.
   */
  analytics_installation_id: string;
}

/** Wochentage aus der Bitmaske · Index 0 = Montag. */
export function trainingDayList(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, index) => (mask & (1 << index)) !== 0);
}

export function trainingDayMask(days: boolean[]): number {
  return days.reduce((mask, active, index) => (active ? mask | (1 << index) : mask), 0);
}

export interface EngineTest {
  ok: boolean;
  name: string;
  path: string;
}

export interface DbInfo {
  path: string;
  size_bytes: number;
  games: number;
  puzzles: number;
  is_default: boolean;
}

export interface ChessDbMove {
  uci: string;
  san: string;
  score: number | null; // Centipawns aus Sicht des Spielers am Zug
  rank: number | null;
  winrate: string | null;
}

export interface ChessDbResult {
  status: string; // "ok" | "unknown" | …
  moves: ChessDbMove[];
  cached: boolean;
}

let settingsCache: Settings | null = null;
let settingsRequest: Promise<Settings> | null = null;
let settingsGeneration = 0;

function invalidateSettingsCache() {
  settingsGeneration += 1;
  settingsCache = null;
  settingsRequest = null;
}

function loadSettings(): Promise<Settings> {
  if (settingsCache) return Promise.resolve(settingsCache);
  if (settingsRequest) return settingsRequest;
  const generation = settingsGeneration;
  const request = invoke<Settings>("get_settings")
    .then((settings) => {
      if (generation === settingsGeneration) settingsCache = settings;
      return settings;
    });
  const trackedRequest = request.finally(() => {
    if (settingsRequest === trackedRequest) settingsRequest = null;
  });
  settingsRequest = trackedRequest;
  return settingsRequest;
}

export function getSettings(): Promise<Settings> {
  return loadSettings();
}

/** Erzwingt ein Nachladen, wenn das Backend Einstellungen indirekt geändert hat. */
export function refreshSettings(): Promise<Settings> {
  invalidateSettingsCache();
  return loadSettings();
}

export function setSettings(newSettings: Settings): Promise<Settings> {
  invalidateSettingsCache();
  const generation = settingsGeneration;
  const request = invoke<Settings>("set_settings", { newSettings }).then((settings) => {
    if (generation === settingsGeneration) settingsCache = settings;
    return settings;
  });
  const trackedRequest = request.finally(() => {
    if (settingsRequest === trackedRequest) settingsRequest = null;
  });
  settingsRequest = trackedRequest;
  return trackedRequest;
}

export function testEngine(path?: string): Promise<EngineTest> {
  return invoke<EngineTest>("test_engine", { path: path ?? null });
}

export function dbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>("db_info");
}

export function moveDatabase(target: string): Promise<DbInfo> {
  return invoke<DbInfo>("move_database", { target }).then((info) => {
    invalidateSettingsCache();
    emitDataChange("database");
    return info;
  });
}

export function useDatabase(path: string): Promise<DbInfo> {
  return invoke<DbInfo>("use_database", { path }).then((info) => {
    invalidateSettingsCache();
    emitDataChange("database");
    return info;
  });
}

export function backupDatabase(target: string): Promise<string> {
  return invoke<string>("backup_database", { target });
}

export function restoreDatabase(source: string): Promise<DbInfo> {
  return invoke<DbInfo>("restore_database", { source }).then((info) => {
    emitDataChange("database");
    return info;
  });
}

export function chessdbQuery(fen: string): Promise<ChessDbResult> {
  return invoke<ChessDbResult>("chessdb_query", { fen });
}

/** Leert die Datenbank und setzt alle Einstellungen zurück. */
export function factoryReset(): Promise<void> {
  return invoke("factory_reset").then(() => {
    invalidateSettingsCache();
    emitDataChange("database");
  });
}

/** Bytes menschenlesbar (1 Dezimalstelle ab MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
