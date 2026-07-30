import { useState } from "react";
import { Check, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { markNewsSeen, type NewsEntry } from "../lib/news";
import { openExternal } from "../lib/ext";
import { Button } from "./ui";

/**
 * Die Neuigkeit zum ersten Start nach einem Update · derselbe Fensterschnitt
 * wie die Rückfragen der App, nur mit Platz für mehrere Punkte.
 *
 * Zwei Wege hinaus: "Später" schließt nur diesmal, "Nicht mehr anzeigen"
 * schreibt die Kennung in die Einstellungen. Wer die Links noch braucht,
 * verliert sie also nicht durch ein versehentliches Wegklicken.
 */
export default function NewsDialog({
  entry,
  onClose,
}: {
  entry: NewsEntry;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const dismiss = async () => {
    setBusy(true);
    try {
      await markNewsSeen(entry);
    } catch {
      // Merken ist nicht kritisch · dann kommt die Meldung eben noch einmal.
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
              {t("news.eyebrow")}
            </div>
            <h2 id="news-title" className="text-[16px] font-semibold">
              {t(entry.titleKey)}
            </h2>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink2">{t(entry.introKey)}</p>

          <ul className="mt-4 flex flex-col gap-2.5">
            {entry.pointKeys.map((key) => (
              <li key={key} className="flex gap-2.5">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="text-[13px] leading-relaxed text-ink2">{t(key)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[13px] font-medium leading-relaxed text-ink">
            {t(entry.outroKey)}
          </p>

          {entry.links.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {entry.links.map((link) => (
                <Button key={link.url} onClick={() => openExternal(link.url)}>
                  <ExternalLink size={14} /> {t(link.labelKey)}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
          <Button onClick={onClose} disabled={busy}>
            {t("news.later")}
          </Button>
          <Button primary onClick={dismiss} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t("news.dismiss")}
          </Button>
        </div>
      </div>
    </div>
  );
}
