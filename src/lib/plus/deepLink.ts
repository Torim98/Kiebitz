/**
 * Deep Link der Anmeldung.
 *
 * Der Magic-Link im Postfach führt auf die API; die bestätigt die Anmeldung und
 * bietet `kiebitz://auth?code=…` an. Das Betriebssystem gibt diese URL an die
 * laufende oder gerade startende App weiter, hier wird der Einmalcode daraus
 * gelöst und gegen eine Sitzung getauscht.
 *
 * Der Code ist fünf Minuten gültig und nur einmal verwendbar; er landet
 * deshalb nirgends in einem Log.
 */
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { signInWithCode } from "./store";

/**
 * Einmalcode aus einer Deep-Link-URL.
 *
 * Nur `kiebitz://auth` zählt · dieselbe Schema-Registrierung trägt auch die
 * Pairing-URL des Gerätesyncs, und die hat mit dem Konto nichts zu tun.
 */
export function parseAuthDeepLink(raw: string): string | null {
  const value = raw.trim();
  if (!/^kiebitz:\/\/auth(\?|$)/i.test(value)) return null;
  const query = value.slice(value.indexOf("?") + 1);
  if (!value.includes("?")) return null;
  const code = new URLSearchParams(query).get("code");
  if (!code) return null;
  const trimmed = code.trim();
  // Die API vergibt einen Base64url-Token; alles andere ist kein Code von uns.
  return /^[A-Za-z0-9_-]{16,256}$/.test(trimmed) ? trimmed : null;
}

/** Erster passender Code aus einer Liste von URLs. */
export function firstAuthCode(urls: readonly string[] | null | undefined): string | null {
  for (const url of urls ?? []) {
    const code = parseAuthDeepLink(url);
    if (code) return code;
  }
  return null;
}

/** Seiten, die ein Deep Link ansteuern darf · dieselben Ziele wie die Navigation. */
const OPEN_PAGES = [
  "dashboard",
  "games",
  "analysis",
  "repertoire",
  "endgame",
  "puzzles",
  "study",
  "insights",
  "settings",
] as const;

export type OpenPage = (typeof OPEN_PAGES)[number];

/**
 * Ziel eines `kiebitz://open?page=…`-Links.
 *
 * Diese Links kommen von den Android-Widgets. Eine unbekannte Seite ist kein
 * Fehler, sondern schlicht kein Ziel · die App bleibt dann, wo sie ist.
 */
export function parseOpenDeepLink(raw: string): OpenPage | null {
  const value = raw.trim();
  if (!/^kiebitz:\/\/open\?/i.test(value)) return null;
  const page = new URLSearchParams(value.slice(value.indexOf("?") + 1)).get("page");
  return (OPEN_PAGES as readonly string[]).includes(page ?? "") ? (page as OpenPage) : null;
}

export function firstOpenPage(urls: readonly string[] | null | undefined): OpenPage | null {
  for (const url of urls ?? []) {
    const page = parseOpenDeepLink(url);
    if (page) return page;
  }
  return null;
}

export interface DeepLinkHandlers {
  /** Der Code wurde angenommen und die Sitzung steht. */
  onSignedIn?: () => void;
  /** Der Code war abgelaufen, schon benutzt oder die API nicht erreichbar. */
  onError?: (error: unknown) => void;
  /** Ein Widget hat eine Seite angefordert. */
  onOpenPage?: (page: OpenPage) => void;
}

/**
 * Hört auf die Deep Links der App und arbeitet sie ab. Liefert einen
 * Abmelder; ohne Deep-Link-Plugin (Browser-Vorschau) passiert nichts.
 */
export function installDeepLinks(handlers: DeepLinkHandlers = {}): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  const redeem = async (code: string) => {
    try {
      await signInWithCode(code);
      if (!disposed) handlers.onSignedIn?.();
    } catch (error) {
      if (!disposed) handlers.onError?.(error);
    }
  };

  const handle = (urls: readonly string[] | null | undefined) => {
    if (disposed) return;
    const code = firstAuthCode(urls);
    if (code) void redeem(code);
    const page = firstOpenPage(urls);
    if (page) handlers.onOpenPage?.(page);
  };

  // Kaltstart über den Link: Die URL liegt schon bereit, bevor irgendjemand
  // zuhören konnte.
  getCurrent()
    .then(handle)
    .catch(() => {});

  onOpenUrl(handle)
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {});

  return () => {
    disposed = true;
    unlisten?.();
  };
}
