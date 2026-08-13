/**
 * Die laufende Woche auf einen Blick.
 *
 * Ein Balken, nach Bereichen eingefärbt, mit einer Marke am Wochenziel. Das
 * ist die Antwort auf „bin ich auf Kurs?", und es ist bewusst *ein* Balken:
 * die frühere Soll-/Ist-Darstellung zeigte zehn Balken über zwei verschiedene
 * Zeiträume und beantwortete diese Frage nicht.
 *
 * Alle Minuten sind gemessen · siehe `lib/session.ts` und `study/sessions.rs`.
 */
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import type { WeekBudget } from "../lib/week";
import type { Area } from "../lib/study";

const AREA_KEY: Record<Area, Key> = {
  play: "plan.areaPlay",
  tactics: "plan.areaTactics",
  openings: "plan.areaOpenings",
  endgames: "plan.areaEndgames",
  analysis: "plan.areaAnalysis",
};

/** Feste Farben je Bereich · dieselbe Zuordnung wie in der Tageszelle. */
export const AREA_COLOR: Record<Area, string> = {
  play: "var(--color-accent)",
  tactics: "var(--color-blue)",
  openings: "var(--color-violet)",
  endgames: "var(--color-gold)",
  analysis: "var(--color-cc)",
};

export default function WeekBudgetBar({ budget }: { budget: WeekBudget }) {
  const { t } = useI18n();
  // Die Skala reicht bis zum Ziel; wer darüber hinaus trainiert hat, füllt den
  // Balken und bekommt die Zahl daneben · gestaucht wäre er eine Bestrafung.
  const scale = Math.max(budget.target, budget.minutes, 1);
  const filled = budget.byArea.filter((entry) => entry.minutes > 0);

  return (
    <div data-week-budget="">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium tabular-nums text-ink">
          {t("st.weekBudgetValue", {
            a: deInt(budget.minutes),
            m: deInt(budget.target),
          })}
        </span>
        <span className="text-[12px] text-ink3">
          {budget.remaining === 0
            ? t("st.weekBudgetDone")
            : t("st.weekBudgetLeft", { m: deInt(budget.remaining) })}
        </span>
      </div>

      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-panel3">
        <div className="flex h-full">
          {filled.map((entry) => (
            <div
              key={entry.area}
              title={`${t(AREA_KEY[entry.area])} · ${deInt(entry.minutes)} min`}
              style={{
                width: `${(entry.minutes / scale) * 100}%`,
                background: AREA_COLOR[entry.area],
              }}
            />
          ))}
        </div>
        {/* Zielmarke · sie steht still, während der Balken wächst. */}
        {budget.target > 0 && budget.minutes > budget.target && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-ink/60"
            style={{ left: `${(budget.target / scale) * 100}%` }}
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink3">
        {budget.byArea.map((entry) => (
          <span key={entry.area} className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: AREA_COLOR[entry.area], opacity: entry.minutes > 0 ? 1 : 0.35 }}
            />
            <span className={entry.minutes > 0 ? "text-ink2" : ""}>{t(AREA_KEY[entry.area])}</span>
            <span className="tabular-nums">
              {deInt(entry.minutes)}/{deInt(entry.target)}
            </span>
          </span>
        ))}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">
        {t("st.weekToday", { m: deInt(budget.today) })} · {t("st.weekMeasured")}
      </p>
    </div>
  );
}
