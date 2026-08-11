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

/** Native Android-Anzeige über dem vom Frontend reservierten Rechteck. */
export function setAdBanner(rect: AdBannerRect): Promise<AdBannerResult> {
  return invoke<AdBannerResult>("set_ad_banner", { rect });
}

/** Google-UMP-Dialog zum nachträglichen Ändern der Werbeeinwilligung. */
export function showAdPrivacyOptions(): Promise<PrivacyOptionsResult> {
  return invoke<PrivacyOptionsResult>("show_ad_privacy_options");
}

/**
 * Ein Desktop-Provider muss die Einbettung in installierter Software
 * ausdrücklich erlauben. Deshalb kommt die freigegebene Frame-URL nur aus dem
 * Release-Build und niemals als fest verdrahteter AdSense-Schnipsel ins Repo.
 */
export function desktopAdFrameUrl(raw = import.meta.env.VITE_DESKTOP_AD_FRAME_URL): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
