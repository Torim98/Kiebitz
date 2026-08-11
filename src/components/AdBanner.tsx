import { useEffect, useRef, useState } from "react";
import {
  DESKTOP_AD_MESSAGE_SOURCE,
  desktopAdFrameUrl,
  setAdBanner,
} from "../lib/ads";
import { openExternal } from "../lib/ext";
import { useT } from "../lib/i18n";
import { isStoreCapture } from "../lib/storeCapture";

export default function AdBanner({
  android,
  free = true,
}: {
  android: boolean;
  /** Plus setzt dies später auf false und startet dadurch kein Werbe-SDK. */
  free?: boolean;
}) {
  const t = useT();
  const slotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [desktopVisible, setDesktopVisible] = useState(false);
  const hidden = !free || isStoreCapture();
  const frameUrl = desktopAdFrameUrl();

  useEffect(() => {
    if (!android) return;
    const slot = slotRef.current;
    if (!slot || hidden) {
      void setAdBanner({ left: 0, top: 0, width: 1, height: 1, visible: false }).catch(
        () => {}
      );
      return;
    }

    let frame = 0;
    let last = "";
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = slot.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const payload = {
          left: Math.round(rect.left * scale),
          top: Math.round(rect.top * scale),
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
          visible: rect.width > 0 && rect.height > 0,
        };
        const signature = JSON.stringify(payload);
        if (signature === last) return;
        last = signature;
        void setAdBanner(payload).catch(() => {});
      });
    };

    // Alte WebViews und JSDOM haben noch keinen ResizeObserver. Der initiale
    // Aufruf plus Fensterereignisse halten den Slot dort trotzdem korrekt.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(slot);
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    place();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
      void setAdBanner({ left: 0, top: 0, width: 1, height: 1, visible: false }).catch(
        () => {}
      );
    };
  }, [android, hidden]);

  useEffect(() => {
    setDesktopVisible(false);
    if (android || hidden || !frameUrl) return;

    const expectedOrigin = new URL(frameUrl).origin;
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== expectedOrigin ||
        event.data?.source !== DESKTOP_AD_MESSAGE_SOURCE
      ) {
        return;
      }

      if (event.data.type === "status") {
        setDesktopVisible(event.data.visible === true);
        return;
      }

      if (event.data.type === "open" && typeof event.data.href === "string") {
        try {
          const target = new URL(event.data.href);
          if (target.protocol === "https:") openExternal(target.toString());
        } catch {
          // Invalid campaign targets are never opened.
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [android, frameUrl, hidden]);

  if (hidden) return null;

  // Android legt die native AdView auf dieses Rechteck. Ein eigener Text im
  // DOM würde unter der Anzeige liegen und Screenreader doppelt informieren.
  if (android) {
    return (
      <div
        ref={slotRef}
        aria-hidden="true"
        className="h-[50px] shrink-0 border-t border-line bg-panel"
        data-ad-slot="android-banner"
      />
    );
  }

  // Ein explizit leerer Build-Wert deaktiviert Desktop-Werbung. In der
  // Entwicklung bleibt ein Platzhalter sichtbar, damit das Layout prüfbar ist.
  if (!frameUrl) {
    if (!import.meta.env.DEV) return null;
    return (
      <div className="flex h-[64px] shrink-0 items-center justify-center border-t border-line bg-panel text-[11px] text-ink3">
        {t("ads.preview")}
      </div>
    );
  }

  return (
    <aside
      aria-label={t("ads.label")}
      aria-hidden={!desktopVisible}
      className={`relative shrink-0 overflow-hidden bg-panel ${
        desktopVisible ? "h-[64px] border-t border-line" : "h-0 border-0"
      }`}
    >
      <iframe
        ref={frameRef}
        title={t("ads.label")}
        src={frameUrl}
        className="h-[64px] w-full border-0"
        sandbox="allow-same-origin allow-scripts"
        referrerPolicy="no-referrer"
        scrolling="no"
        tabIndex={desktopVisible ? 0 : -1}
      />
    </aside>
  );
}
