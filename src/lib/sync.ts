import { invoke } from "@tauri-apps/api/core";

/** Pairing-Infos des Desktop-Hubs für den QR-Code. */
export interface PairInfo {
  /** Vollständige URI mit Adresse, Code und TLS-Fingerprint (im QR kodiert). */
  uri: string;
  /** Kodierte Adresse "ip:port". */
  addr: string;
  code: string;
  /** SHA-256-Fingerprint des selbstsignierten Hub-Zertifikats. */
  fingerprint: string;
  /** Fertiges SVG des QR-Codes. */
  qr_svg: string;
}

/** Status des Geräte-Syncs (Desktop-Hub bzw. Mobile-Client). */
export interface SyncInfo {
  /** Läuft der Sync-Server (Desktop) gerade? */
  running: boolean;
  /** LAN-Adresse des Hubs, z. B. "192.168.1.5:47323". */
  addr: string | null;
  /** Pairing-Code (auf dem Desktop anzeigen, auf dem Handy eintippen). */
  code: string;
  /** SHA-256-Fingerprint des HTTPS-Hub-Zertifikats. */
  fingerprint: string;
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

/** Mobile: sucht den Desktop-Hub per UDP-Broadcast ("ip:port" oder null). */
export function syncDiscover(): Promise<string | null> {
  return invoke<string | null>("sync_discover");
}

/** Desktop-Hub: Pairing-URI + QR-SVG zum Scannen auf dem Handy. */
export function syncPair(): Promise<PairInfo> {
  return invoke<PairInfo>("sync_pair");
}

/**
 * Zerlegt eine gescannte `kiebitz://sync?host=…&code=…`-URI in Host + Code.
 * Gibt `null` zurück, wenn es kein Kiebitz-Pairing-Link ist.
 */
export function parsePairUri(raw: string): { host: string; code: string; fingerprint: string } | null {
  const s = raw.trim();
  if (!s.toLowerCase().startsWith("kiebitz://sync")) return null;
  const q = s.indexOf("?");
  if (q < 0) return null;
  const params = new URLSearchParams(s.slice(q + 1));
  const host = params.get("host")?.trim() ?? "";
  const code = params.get("code")?.trim() ?? "";
  const fingerprint = (params.get("fingerprint")?.trim() ?? "").toLowerCase();
  if (!host || !code || !/^[a-f0-9]{64}$/.test(fingerprint)) return null;
  return { host, code, fingerprint };
}

/**
 * Mobile: öffnet die Kamera, scannt einen QR und liefert Host + Code aus einem
 * gültigen Kiebitz-Pairing-Link. Fragt bei Bedarf die Kamera-Berechtigung ab.
 * `null`, wenn abgebrochen wurde oder kein passender Code erkannt wurde.
 */
export async function scanPairingQr(): Promise<{ host: string; code: string; fingerprint: string } | null> {
  const bs = await import("@tauri-apps/plugin-barcode-scanner");
  let perm = await bs.checkPermissions();
  if (perm !== "granted") {
    perm = await bs.requestPermissions();
  }
  if (perm !== "granted") {
    throw new Error("no-camera-permission");
  }
  const res = await bs.scan({ windowed: false, formats: [bs.Format.QRCode] });
  return parsePairUri(res.content);
}
