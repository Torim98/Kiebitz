import { invoke } from "@tauri-apps/api/core";

export interface AdBannerRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface AdBannerResult {
  available: boolean;
}

export interface PrivacyOptionsResult {
  shown: boolean;
}

export const DESKTOP_AD_FRAME_URL =
  "https://torim98.github.io/kiebitz-site/desktop-ad/";

export const DESKTOP_AD_MESSAGE_SOURCE = "kiebitz-desktop-ad";

/** Native Android-Anzeige über dem vom Frontend reservierten Rechteck. */
export function setAdBanner(rect: AdBannerRect): Promise<AdBannerResult> {
  return invoke<AdBannerResult>("set_ad_banner", { rect });
}

/** Google-UMP-Dialog zum nachträglichen Ändern der Werbeeinwilligung. */
export function showAdPrivacyOptions(): Promise<PrivacyOptionsResult> {
  return invoke<PrivacyOptionsResult>("show_ad_privacy_options");
}

/**
 * Standardmäßig wird nur die statische, selbst kontrollierte Kiebitz-Fläche
 * geladen. Ein explizit leerer Build-Wert deaktiviert Desktop-Werbung.
 */
export function desktopAdFrameUrl(
  raw = import.meta.env.VITE_DESKTOP_AD_FRAME_URL ?? DESKTOP_AD_FRAME_URL
): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
