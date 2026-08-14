/**
 * Die laufende Woche auf einen Blick · und die einzige Ist-Zahl der App.
 *
 * Ein Balken, nach Bereichen eingefärbt, darunter je Bereich gemessen gegen
 * Ziel. Das ist die Antwort auf „bin ich auf Kurs?", und es ist bewusst *eine*
 * Fläche: daneben stand früher ein zweites „Trainingsbudget", dessen Ist die
 * letzten 28 Tage ÷ 4 waren. Zwei Zeiträume, zwei Zahlen, dieselbe Frage — und
 * bei Taktik sagten sie 18 und 67 Minuten auf demselben Bildschirm.
 *
 * Alle Minuten sind gemessen · siehe `lib/session.ts` und `study/sessions.rs`.
 */
import { useI18n } from "../lib/i18n";
import { deInt } from "../lib/format";
import type { WeekBudget } from "../lib/week";
import { AREA_COLOR, AREA_KEY } from "../lib/study";

export default function WeekBudgetBar({
  budget,
  /** Woher das Wochenziel kommt · als eine Zeile unter der Tabelle. */
  source,
}: {
  budget: WeekBudget;
  source?: React.ReactNode;
}) {
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
          {budget.open === 0
            ? t("st.weekBudgetDone")
            : t("st.weekBudgetLeft", { m: deInt(budget.open) })}
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

      {/* Je Bereich eine Zeile: gemessen, Ziel, Anteil. Der Balken darunter
          zeigt das Verhältnis, nicht die absolute Größe · sonst verschwindet
          ein 9-Minuten-Ziel neben einem 36-Minuten-Ziel. */}
      <ul className="mt-3 flex flex-col gap-1.5">
        {budget.byArea.map((entry) => {
          const done = entry.target > 0 ? Math.min(100, (entry.minutes / entry.target) * 100) : 0;
          return (
            <li key={entry.area} data-week-area={entry.area} className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: AREA_COLOR[entry.area],
                  opacity: entry.minutes > 0 ? 1 : 0.35,
                }}
              />
              <span
                className={`w-[74px] shrink-0 truncate text-[11.5px] ${
                  entry.minutes > 0 ? "text-ink2" : "text-ink3"
                }`}
              >
                {t(AREA_KEY[entry.area])}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${done}%`, background: AREA_COLOR[entry.area] }}
                />
              </span>
              <span className="shrink-0 text-right text-[11.5px] tabular-nums text-ink3">
                {t("st.weekAreaValue", {
                  a: deInt(entry.minutes),
                  m: deInt(entry.target),
                  p: entry.share,
                })}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink3">
        {t("st.weekToday", { m: deInt(budget.today) })}
      </p>
      {source && <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">{source}</div>}
    </div>
  );
}
