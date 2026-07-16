import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Öffnet eine URL im System-Standardbrowser.
 *
 * Desktop (Tauri): über das Opener-Plugin — ein normales <a target="_blank">
 * tut in der Webview nichts. Web-Preview: normaler neuer Tab.
 */
export function openExternal(href: string): void {
  if (isTauri()) {
    openUrl(href).catch(() => {});
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}
