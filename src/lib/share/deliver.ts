/**
 * Wege nach draußen.
 *
 * Jede Plattform kann etwas anderes, und die Unterschiede sind größer, als man
 * erwartet: Android hat ein Systemblatt, aber kein `navigator.share` in der
 * WebView; Windows hat eine Zwischenablage für Bilder, aber kein Blatt. Diese
 * Datei sammelt, was jeweils geht, damit der Dialog nur noch Knöpfe dafür
 * zeigen muss.
 */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

/** Was auf diesem Gerät zur Verfügung steht. */
export interface ShareTargets {
  /** Das Android-Systemblatt · der kurze Weg in jeden Messenger. */
  native: boolean;
  /** Bild in die Zwischenablage · Desktop, und nur im sicheren Kontext. */
  copyImage: boolean;
  /** Bild als Datei ablegen · Desktop. */
  saveImage: boolean;
}

export function shareTargets(platform: string | undefined, inApp: boolean): ShareTargets {
  const android = platform === "android";
  const clipboard =
    typeof navigator !== "undefined" &&
    typeof ClipboardItem !== "undefined" &&
    !!navigator.clipboard?.write;
  return {
    native: inApp && android,
    copyImage: !android && clipboard,
    // Speichern führt über den Dateidialog der App · in der Web-Vorschau gibt
    // es keinen, und ein Knopf, der nur eine Fehlermeldung erzeugt, ist keiner.
    saveImage: inApp && !android,
  };
}

/**
 * Base64 einer Bilddatei · in Blöcken, weil `String.fromCharCode(...bytes)` bei
 * einer 300-KB-Karte den Aufrufstapel sprengt.
 */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return btoa(binary);
}

/**
 * Öffnet das Systemblatt. Der Rückgabewert sagt, ob es wirklich aufging · auf
 * dem Desktop gibt es keines, und dort bleibt es beim Kopieren.
 */
export async function shareNative(options: {
  title: string;
  text: string;
  image: Blob | null;
}): Promise<boolean> {
  const result = await invoke<{ shared: boolean }>("share_position", {
    request: {
      title: options.title,
      text: options.text,
      image: options.image ? await toBase64(options.image) : "",
    },
  });
  return result.shared;
}

/** Legt die Karte in die Zwischenablage · von dort fällt sie in jeden Chat. */
export async function copyImage(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * Fragt nach einem Ort und schreibt die Karte dorthin. Liefert den Pfad oder
 * `null`, wenn der Dialog abgebrochen wurde.
 */
export async function saveImage(blob: Blob, suggestedName: string): Promise<string | null> {
  const chosen = await saveDialog({
    defaultPath: suggestedName,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!chosen) return null;
  await invoke<number>("write_share_image", { path: chosen, image: await toBase64(blob) });
  return chosen;
}
