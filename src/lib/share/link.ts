/**
 * Adressen einer geteilten Stellung.
 *
 * Ein Share erzeugt zwei Wege zur selben Nutzlast: die Webadresse für alle,
 * die Kiebitz (noch) nicht haben, und den Deep Link für alle, die es haben.
 * Beide tragen dieselbe Zeichenkette aus `codec.ts`; die Landeseite bietet den
 * Deep Link als „In Kiebitz öffnen" an.
 */
import { decodeShare, encodeShare, type SharePayload } from "./codec";

/**
 * Host der Landeseiten · eigene Subdomain und nicht `kiebitz.dev`, weil die
 * Website auf GitHub Pages liegt und dort kein Worker antworten kann.
 */
export const SHARE_ORIGIN = "https://s.kiebitz.dev";

/** Webadresse einer Nutzlast · das ist der Link, der im Chat landet. */
export function shareUrl(payload: SharePayload): string {
  return `${SHARE_ORIGIN}/p/${encodeShare(payload)}`;
}

/** Derselbe Inhalt für die installierte App. */
export function shareDeepLink(payload: SharePayload): string {
  return `kiebitz://p/${encodeShare(payload)}`;
}

/**
 * Nutzlast aus einer Adresse: Deep Link, Webadresse oder auch nur die nackte
 * Zeichenkette aus der Zwischenablage. Alles andere ergibt `null`.
 *
 * Der optionale Schrägstrich hinter dem Host ist nicht Höflichkeit, sondern
 * Notwendigkeit: Chromium kanonisiert `kiebitz://p/xy` unverändert, andere
 * Wege hängen einen Schrägstrich an. Siehe `plus/deepLink.ts`.
 */
export function parseShareLink(raw: string): SharePayload | null {
  const value = raw.trim();
  if (!value) return null;

  const deepLink = /^kiebitz:\/\/p\/+([A-Za-z0-9_-]+)\/?$/i.exec(value);
  if (deepLink) return decodeShare(deepLink[1]);

  const web = /^https?:\/\/(?:[a-z0-9-]+\.)*kiebitz\.dev\/p\/+([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(
    value
  );
  if (web) return decodeShare(web[1]);

  // Nackte Nutzlast: nur annehmen, wenn sie sich auch entschlüsseln lässt.
  if (/^[A-Za-z0-9_-]{12,}$/.test(value)) return decodeShare(value);
  return null;
}

/** Erste brauchbare Nutzlast aus einer Liste von URLs · Gegenstück zu `firstOpenPage`. */
export function firstSharePayload(urls: readonly string[] | null | undefined): SharePayload | null {
  for (const url of urls ?? []) {
    const payload = parseShareLink(url);
    if (payload) return payload;
  }
  return null;
}
