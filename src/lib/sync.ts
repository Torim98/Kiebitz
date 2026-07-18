import { invoke } from "@tauri-apps/api/core";

/** Status des Geräte-Syncs (Desktop-Hub bzw. Mobile-Client). */
export interface SyncInfo {
  /** Läuft der Sync-Server (Desktop) gerade? */
  running: boolean;
  /** LAN-Adresse des Hubs, z. B. "192.168.1.5:47323". */
  addr: string | null;
  /** Pairing-Code (auf dem Desktop anzeigen, auf dem Handy eintippen). */
  code: string;
  /** Mobile: konfigurierte Hub-Adresse. */
  host: string;
  /** Unix-Sekunden des letzten erfolgreichen Syncs (0 = nie). */
  last_sync: number;
}

export interface SyncSummary {
  games_pulled: number;
  rep_merged: number;
  puzzle_attempts_pulled: number;
  endgame_attempts_pulled: number;
}

export function syncInfo(): Promise<SyncInfo> {
  return invoke<SyncInfo>("sync_info");
}

/** Startet den Sync-Server (Desktop-Hub); idempotent. */
export function syncServerStart(): Promise<SyncInfo> {
  return invoke<SyncInfo>("sync_server_start");
}

/** Mobile: kompletter Sync-Roundtrip gegen den Desktop-Hub. */
export function syncNow(): Promise<SyncSummary> {
  return invoke<SyncSummary>("sync_now");
}
