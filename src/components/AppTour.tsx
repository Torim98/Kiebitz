import { useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Database,
  GraduationCap,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useT, type Key } from "../lib/i18n";
import { Button, Card } from "./ui";

/**
 * Fünf Folien, die erklären, wofür Kiebitz da ist.
 *
 * Sie laufen an zwei Stellen: als mittlerer Schritt der Ersteinrichtung und —
 * unverändert — als Overlay aus den Einstellungen. Deshalb hält die Tour keinen
 * eigenen Zustand über die Sitzung hinaus: Wer sie noch einmal sehen will,
 * bekommt sie noch einmal, ohne dass irgendwo ein "schon gesehen"-Flag steht.
 */
const SLIDES: { icon: LucideIcon; title: Key; body: Key }[] = [
  { icon: Database, title: "tour.s1.title", body: "tour.s1.body" },
  { icon: Activity, title: "tour.s2.title", body: "tour.s2.body" },
  { icon: GraduationCap, title: "tour.s3.title", body: "tour.s3.body" },
  { icon: BarChart3, title: "tour.s4.title", body: "tour.s4.body" },
  { icon: ShieldCheck, title: "tour.s5.title", body: "tour.s5.body" },
];

export default function AppTour({
  overlay = false,
  onDone,
  onBack,
  doneLabel,
}: {
  /** Einstellungen: eigene Fläche über der Seite. Ersteinrichtung: eingebettet. */
  overlay?: boolean;
  /** Letzte Folie bestätigt oder Tour übersprungen. */
  onDone: () => void;
  /** Zurück von der *ersten* Folie · in der Ersteinrichtung die Sprachwahl. */
  onBack?: () => void;
  /** Beschriftung der Schaltfläche auf der letzten Folie. */
  doneLabel?: string;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const Icon = slide.icon;
  const last = index === SLIDES.length - 1;

  const card = (
    <Card
      title={t("tour.title")}
      action={
        overlay ? (
          <button
            type="button"
            onClick={onDone}
            aria-label={t("tour.close")}
            className="-mr-1 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        ) : undefined
      }
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon size={22} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{t(slide.title)}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink2">{t(slide.body)}</p>
        </div>
      </div>

      {/* Punkte statt "3/5": Sie zeigen die Länge der Tour auf einen Blick und
          lassen zurückspringen, ohne sich durchklicken zu müssen. */}
      <div className="mt-5 flex items-center justify-center gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={t("tour.step", { n: i + 1, total: SLIDES.length })}
            aria-current={i === index ? "step" : undefined}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? "w-5 bg-accent" : "w-1.5 bg-line2 hover:bg-ink3"
            }`}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button onClick={() => (index > 0 ? setIndex(index - 1) : onBack?.())} disabled={index === 0 && !onBack}>
          <ArrowLeft size={14} /> {t("tour.back")}
        </Button>
        <div className="flex gap-2">
          {!last && <Button onClick={onDone}>{t("tour.skip")}</Button>}
          <Button primary onClick={() => (last ? onDone() : setIndex(index + 1))}>
            {last ? (
              <>
                <Check size={14} /> {doneLabel ?? t("tour.done")}
              </>
            ) : (
              <>
                {t("tour.next")} <ArrowRight size={14} />
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );

  if (!overlay) return card;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={t("tour.title")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDone();
      }}
    >
      <div className="mx-auto flex min-h-full max-w-[560px] items-center">
        <div className="w-full">{card}</div>
      </div>
    </div>
  );
}
