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
 *
 * Ob es ein Backend gibt, beantwortet die Prüfung unten und nicht der erste
 * fehlgeschlagene Aufruf. Der Unterschied ist kein Feinschliff: Vorher machte
 * *ein* abgelehnter Aufruf die Ablage für die ganze Sitzung zum Modul-Map —
 * und weil Android den `lichess_token` bis eben gar nicht kannte, hieß das,
 * dass nach dem Speichern des Explorer-Tokens auch Sitzung und Entitlement
 * nur noch aus dem Arbeitsspeicher kamen und beim nächsten Start weg waren.
 * Ein Fehler des Backends ist jetzt ein Fehler und keine stille Umleitung.
 *
 * Der Zusatz von `deleteSecret` ist derselbe Gedanke wie beim Schreiben: Wer
 * abmeldet, will den Wert wirklich los sein.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Die Berechtigung steht in zwei Einträgen: `entitlement` trägt den signierten
 * Token, `entitlement_keys` den öffentlichen Schlüsselsatz und das Konto. Das
 * ist keine Ordnungsfrage, sondern eine Grenze des Windows Credential Manager:
 * Er nimmt höchstens 2560 Byte je Eintrag an — bei UTF-16 also 1280 Zeichen —
 * und lehnt alles darüber mit Fehler 1783 ab. In einem Eintrag maßen die beiden
 * rund 2660 Byte, also knapp hundert zu viel; auf dem Desktop kam die
 * Freischaltung deshalb nie in der Ablage an. Getrennt bleibt jeder Eintrag
 * deutlich darunter.
 *
 * `lichess_token` ist der persönliche API-Token für den Eröffnungs-Explorer ·
 * siehe lib/lichess.ts. Er ist kein Kontowert, gehört aber in dieselbe Ablage:
 * ein Zugangsdatum bleibt eines, auch wenn es zu einem fremden Dienst gehört.
 *
 * Dieselben Namen führt das Backend (`KEYS` in src-tauri/src/plus.rs) und auf
 * Android noch einmal das Keystore-Plugin (`ALLOWED_KEYS`).
 */
export type SecretKey = "session" | "entitlement" | "entitlement_keys" | "lichess_token";

const memory = new Map<SecretKey, string>();

/**
 * Gibt es ein Backend? In der Vorschau nicht · dort gilt der Modul-Map.
 *
 * Gefragt wird nach `__TAURI_INTERNALS__`: Das ist das Objekt, über das
 * `invoke` selbst geht, und damit die genauere Auskunft als jede Fahne daneben
 * — dieselbe Prüfung wie in lib/session.ts. Sie steht im Dokument, bevor die
 * App startet; wer sie nicht sieht, hat kein Backend.
 */
function backend(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Lesen darf scheitern, ohne dass es jemand merkt: Ein Schlüsselspeicher, der
 * gerade nicht antwortet (gesperrter Bund, fehlender Secret Service), ist für
 * die App dasselbe wie ein leerer — sie fällt auf Free zurück und fragt später
 * wieder. Eine Ausnahme hier bliebe im Startpfad hängen (siehe `initPlus`).
 */
export async function readSecret(key: SecretKey): Promise<string | null> {
  if (!backend()) return memory.get(key) ?? null;
  try {
    return await invoke<string | null>("plus_secret_get", { key });
  } catch {
    return null;
  }
}

/**
 * Schreiben darf *nicht* still scheitern. Was hier durchgeht, gilt als abgelegt
 * — steht der Wert danach nur im Arbeitsspeicher, ist er beim nächsten Start
 * weg, und niemand hat es gesagt.
 */
export async function writeSecret(key: SecretKey, value: string): Promise<void> {
  if (!backend()) {
    memory.set(key, value);
    return;
  }
  await invoke("plus_secret_set", { key, value });
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  if (!backend()) {
    memory.delete(key);
    return;
  }
  await invoke("plus_secret_delete", { key });
}

/** Nur für Tests · setzt den Vorschau-Zwischenspeicher zurück. */
export function resetSecretFallback(): void {
  memory.clear();
}
