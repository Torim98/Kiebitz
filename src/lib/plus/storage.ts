/**
 * Sichere Ablage für Sitzungs- und Entitlement-Token.
 *
 * Die Werte gehen ins Backend und dort in den Schlüsselspeicher des Systems:
 * Windows Credential Manager, macOS-Schlüsselbund, Secret Service unter Linux,
 * Android Keystore auf dem Telefon. Weder `localStorage` noch eine Klartext-
 * datei kommen dafür in Frage · beides läge für jedes andere Programm des
 * Benutzerkontos offen.
 *
 * In der Browser-Vorschau (kein Tauri-Backend) hält ein Modul-Map die Werte
 * für die Dauer der Sitzung. Dort gibt es kein Konto und nichts zu schützen.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * `lichess_token` ist der persönliche API-Token für den Eröffnungs-Explorer ·
 * siehe lib/lichess.ts. Er ist kein Kontowert, gehört aber in dieselbe Ablage:
 * ein Zugangsdatum bleibt eines, auch wenn es zu einem fremden Dienst gehört.
 */
export type SecretKey = "session" | "entitlement" | "lichess_token";

const memory = new Map<SecretKey, string>();
let backendAvailable = true;

export async function readSecret(key: SecretKey): Promise<string | null> {
  if (backendAvailable) {
    try {
      return await invoke<string | null>("plus_secret_get", { key });
    } catch {
      backendAvailable = false;
    }
  }
  return memory.get(key) ?? null;
}

export async function writeSecret(key: SecretKey, value: string): Promise<void> {
  if (backendAvailable) {
    try {
      await invoke("plus_secret_set", { key, value });
      return;
    } catch {
      backendAvailable = false;
    }
  }
  memory.set(key, value);
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  if (backendAvailable) {
    try {
      await invoke("plus_secret_delete", { key });
      return;
    } catch {
      backendAvailable = false;
    }
  }
  memory.delete(key);
}

/** Nur für Tests · setzt den Vorschau-Zwischenspeicher zurück. */
export function resetSecretFallback(): void {
  memory.clear();
  backendAvailable = true;
}
