/**
 * Was heute ansteht · und wie man es startet.
 *
 * Vorher standen hier drei feste Zeilen (Wiederholungen, Puzzles, Analyse),
 * daneben die Fokuskarten mit ihrer Dosis und darunter der Kalender mit den
 * geplanten Einheiten. Drei Flächen, die dieselbe Frage verschieden
 * beantworteten, und keine davon führte direkt in den Trainer.
 *
 * Hier ist es eine Liste: die für heute geplanten Einheiten in ihrer
 * Reihenfolge, jede mit ihrer Dosis aus dem Lernplan („15 Aufgaben, Band
 * 1420–1580, Motiv Fesselung") und einer Schaltfläche, die genau das öffnet.
 * Darunter steht, was ohne Plan täglich anfällt — fällige Wiederholungen,
 * Tagesdosis, offene Analysen. Auch erledigt: der erreichte Zustand ist die
 * halbe Rückmeldung, und eine Liste, die beim Abhaken verschwindet, nimmt sie
 * einem wieder weg.
 */
import { CheckCircle2, type LucideIcon } from "lucide-react";
import { Button } from "./ui";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { AREA_COLOR, type Area } from "../lib/study";

export interface SessionItem {
  id: string;
  /** Bereich für Farbe und Zuordnung; null bei Einheiten ohne Bereich. */
  area: Area | null;
  icon: LucideIcon;
  label: string;
  /** Dosis oder Fortschritt, eine Zeile. */
  detail: string;
  minutes: number | null;
  done: boolean;
  /** Von der Messung erfüllt statt von Hand abgehakt. */
  auto: boolean;
  action?: { label: string; run: () => void };
}

export default function TodaySession({
  items,
  emptyKey,
}: {
  items: SessionItem[];
  /** Text, wenn heute nichts offen ist. */
  emptyKey: Key;
}) {
  const { t } = useI18n();
  const open = items.filter((item) => !item.done);

  if (items.length === 0) {
    return <p className="py-2 text-[13px] leading-relaxed text-ink3">{t(emptyKey)}</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => (
        <div
          key={item.id}
          data-session-item={item.id}
          className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
            item.done ? "border-accent-dim bg-accent-soft/40" : "border-line bg-panel2"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            {item.done ? (
              <CheckCircle2 size={17} className="shrink-0 text-win" />
            ) : (
              <item.icon
                size={17}
                className="shrink-0"
                style={{ color: item.area ? AREA_COLOR[item.area] : "var(--color-ink3)" }}
              />
            )}
            <div className="min-w-0">
              <div className={`text-[13px] ${item.done ? "text-ink3" : "text-ink"}`}>
                {item.label}
                {item.minutes != null && (
                  <span className="ml-1.5 text-[11.5px] tabular-nums text-ink3">
                    {t("plan.minutes", { m: deInt(item.minutes) })}
                  </span>
                )}
              </div>
              <div className="text-[12px] leading-snug text-ink3">{item.detail}</div>
            </div>
          </div>
          {item.done ? (
            <span className="shrink-0 text-right text-[12px] font-medium text-win">
              {/* „Von selbst erledigt" ist die eigentliche Neuerung: die
                  gemessene Zeit hat die Einheit erfüllt, niemand musste sie
                  noch einmal melden. */}
              {item.auto ? t("st.doneMeasured") : t("st.doneLabel")}
            </span>
          ) : (
            item.action && (
              <Button onClick={item.action.run} className="shrink-0">
                {item.action.label}
              </Button>
            )
          )}
        </div>
      ))}
      {open.length === 0 && (
        <div className="rounded-lg border border-accent-dim bg-accent-soft px-3 py-2.5 text-[12.5px] font-medium text-accent">
          {t("st.allDone")}
        </div>
      )}
    </div>
  );
}
