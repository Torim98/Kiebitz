/**
 * Kennzeichnung gesperrter Plus-Funktionen.
 *
 * Gesperrt heißt nicht versteckt: Wer nicht sieht, was es gibt, kann es weder
 * einschätzen noch wollen, und ein verschwundener Knopf liest sich wie ein
 * Fehler. Die Funktion bleibt deshalb sichtbar, wird als Vorschau markiert und
 * führt auf einen Klick in die gemeinsame Erklärung.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { openPlusDialog } from "../lib/plus/dialog";
import { usePlusGate } from "../lib/plus/usePlus";
import type { PlusFeature } from "../lib/plus/types";

const badgeClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-dim bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent";

/**
 * Kleiner Hinweis „Mit Plus" · rein visuell.
 *
 * Diese Fassung steht in Knöpfen, die selbst schon zur Erklärung führen. Sie
 * darf dort kein eigener Knopf sein: Ein Knopf im Knopf ist ungültiges HTML,
 * und die Tastatur bekäme zwei Ziele, wo eine Handlung gemeint ist. Der Text
 * gehört zum Namen des umgebenden Knopfes und sagt genau das Nötige.
 */
export function PlusBadge() {
  const t = useT();
  return (
    <span className={badgeClass}>
      <Sparkles size={11} aria-hidden="true" /> {t("plus.badge")}
    </span>
  );
}

/**
 * Derselbe Hinweis als eigener Knopf.
 *
 * Für Stellen, an denen sonst nichts zur Erklärung führt · etwa neben einem
 * gesperrten Schalter. Er gehört dann neben das Bedienelement, nicht in dessen
 * Beschriftung: In einem `label` würde ein Klick auf den Hinweis zusätzlich den
 * Schalter treffen.
 */
export function PlusBadgeButton({ feature }: { feature: PlusFeature }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t("plus.badgeExplain")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openPlusDialog(feature);
      }}
      className={`${badgeClass} transition-colors hover:border-accent`}
    >
      <Sparkles size={11} aria-hidden="true" /> {t("plus.badge")}
    </button>
  );
}

/**
 * Fokussierbare Elemente · dieselbe Auswahl, die auch Browser für die
 * Tab-Reihenfolge heranziehen.
 */
const FOCUSABLE =
  "a[href], area[href], button, details, embed, iframe, input, object, select, summary, textarea, [contenteditable], [tabindex]";

/**
 * Nimmt einen Teilbaum aus Bedienung und Vorlesereihenfolge.
 *
 * `inert` erledigt das in aktuellen Webviews vollständig. Damit die Sperre aber
 * nicht allein daran hängt, verliert zusätzlich jedes fokussierbare Element im
 * Teilbaum seinen Platz in der Tab-Reihenfolge · beim Freischalten bekommt es
 * ihn unverändert zurück. Ohne das bliebe die Vorschau zwar unsichtbar für die
 * Maus, aber per Tabulator voll bedienbar: der schlechteste aller Zustände.
 *
 * Der Effekt läuft nach jedem Rendern, weil der gesperrte Inhalt selbst
 * weiterlebt und Elemente nachreichen kann.
 */
function useInertSubtree(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;
    root.setAttribute("inert", "");
    const restore: Array<[HTMLElement, string | null]> = [];
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (element.getAttribute("tabindex") === "-1") continue;
      restore.push([element, element.getAttribute("tabindex")]);
      element.setAttribute("tabindex", "-1");
    }
    return () => {
      root.removeAttribute("inert");
      for (const [element, previous] of restore) {
        if (previous === null) element.removeAttribute("tabindex");
        else element.setAttribute("tabindex", previous);
      }
    };
  });
  return ref;
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
  const locked = !unlocked && !pending;
  const previewRef = useInertSubtree(locked);
  if (!locked) return <>{children}</>;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={previewRef}
        aria-hidden="true"
        className="pointer-events-none select-none opacity-40 blur-[1.5px]"
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => openPlusDialog(feature)}
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-panel/45 text-center transition-colors hover:bg-panel/30"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-dim bg-accent-soft px-3 py-1 text-[12px] font-medium text-accent">
          <Sparkles size={12} aria-hidden="true" /> {label ?? t("plus.badge")}
        </span>
        <span className="max-w-[34ch] px-3 text-[11.5px] text-ink2">{t("plus.previewHint")}</span>
      </button>
    </div>
  );
}
