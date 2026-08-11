import { useEffect, useRef } from "react";
import { desktopAdFrameUrl, setAdBanner } from "../lib/ads";
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

  // Ohne einen schriftlich für Desktopsoftware freigegebenen Provider bleibt
  // der Release-Build leer. Im Dev-Build zeigt die Fläche ihre vorgesehene
  // Position, ohne eine echte Anzeigenanfrage auszulösen.
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
      className="relative h-[64px] shrink-0 overflow-hidden border-t border-line bg-panel"
    >
      <span className="absolute left-2 top-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/80">
        {t("ads.label")}
      </span>
      <iframe
        title={t("ads.label")}
        src={frameUrl}
        className="h-full w-full border-0"
        sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts"
        referrerPolicy="no-referrer"
        scrolling="no"
      />
    </aside>
  );
}
