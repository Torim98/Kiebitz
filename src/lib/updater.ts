import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Ergebnis eines Update-Checks (available = null → bereits aktuell). */
export interface UpdateCheck {
  current: string;
  available: string | null;
  notes: string | null;
}

/** Fortschritts-Event `update://state` aus dem Rust-Backend. */
export interface UpdateState {
  phase: "downloading" | "installing" | "error";
  version: string;
  received: number;
  total: number | null;
  error: string | null;
}

/** `update://available`: beim Start gefunden, Auto-Install aber deaktiviert. */
export interface UpdateAvailable {
  version: string;
  notes: string | null;
}

export function checkUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("check_update");
}

/** Lädt, installiert und startet die App neu — das Promise löst i. d. R. nicht mehr auf. */
export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

export function onUpdateState(cb: (s: UpdateState) => void): Promise<UnlistenFn> {
  return listen<UpdateState>("update://state", (e) => cb(e.payload));
}

export function onUpdateAvailable(cb: (u: UpdateAvailable) => void): Promise<UnlistenFn> {
  return listen<UpdateAvailable>("update://available", (e) => cb(e.payload));
}
