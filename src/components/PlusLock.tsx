/**
 * Kennzeichnung gesperrter Plus-Funktionen.
 *
 * Gesperrt heißt nicht versteckt: Wer nicht sieht, was es gibt, kann es weder
 * einschätzen noch wollen, und ein verschwundener Knopf liest sich wie ein
 * Fehler. Die Funktion bleibt deshalb sichtbar, wird als Vorschau markiert und
 * führt auf einen Klick in die gemeinsame Erklärung.
 */
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import type { PlusFeature } from "../lib/plus/types";

/** Kleiner Hinweis „Mit Plus" · für Knöpfe, Karten und Listeneinträge. */
export function PlusBadge({ feature }: { feature: PlusFeature }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlusDialog(feature);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-dim bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:border-accent"
    >
      <Sparkles size={11} /> {t("plus.badge")}
    </button>
  );
}

/**
 * Umschließt eine gesperrte Fläche.
 *
 * Freigeschaltet rendert sie unverändert. Gesperrt bleibt der Inhalt sichtbar,
 * wird aber gedämpft, für Tastatur und Screenreader inert, und darüber liegt
 * eine Fläche mit dem Hinweis · ein Klick öffnet die Erklärung.
 *
 * Solange der Plus-Zustand noch geladen wird, bleibt alles normal: ein kurz
 * aufblitzendes Schloss wäre schlechter als eine halbe Sekunde Geduld.
 */
export function PlusLock({
  feature,
  children,
  label,
  className = "",
}: {
  feature: PlusFeature;
  children: ReactNode;
  /** Ersetzt den Standardtext auf der Sperrfläche. */
  label?: string;
  className?: string;
}) {
  const t = useT();
  const { unlocked, pending } = usePlusGate(feature);
  if (unlocked || pending) return <>{children}</>;

  return (
    <div className={`relative ${className}`}>
      <div aria-hidden="true" className="pointer-events-none select-none opacity-40 blur-[1.5px]">
        {children}
      </div>
      <button
        type="button"
        onClick={() => openPlusDialog(feature)}
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-panel/45 text-center transition-colors hover:bg-panel/30"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-dim bg-accent-soft px-3 py-1 text-[12px] font-medium text-accent">
          <Sparkles size={12} /> {label ?? t("plus.badge")}
        </span>
        <span className="max-w-[34ch] px-3 text-[11.5px] text-ink2">{t("plus.previewHint")}</span>
      </button>
    </div>
  );
}
