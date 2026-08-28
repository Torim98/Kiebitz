/**
 * Die laufende Woche auf einen Blick · und die einzige Ist-Zahl der App.
 *
 * Ein Ring, nach Bereichen eingefärbt, daneben je Bereich gemessen gegen Ziel.
 * Das ist die Antwort auf „bin ich auf Kurs?", und es ist bewusst *eine*
 * Fläche: daneben stand früher ein zweites „Trainingsbudget", dessen Ist die
 * letzten 28 Tage ÷ 4 waren. Zwei Zeiträume, zwei Zahlen, dieselbe Frage — und
 * bei Taktik sagten sie 18 und 67 Minuten auf demselben Bildschirm.
 *
 * Der Ring hat den Balken abgelöst, der die Seite bis dahin eröffnete: er
 * trägt Zusammensetzung, Gesamtstand und Zielmarke in einer Figur und lässt
 * damit oben Platz für die Frage, mit der man diese Seite öffnet — was mache
 * ich jetzt. Für das Handy gibt es dieselben Zahlen als flacher Balken, der
 * sich aufklappen lässt.
 *
 * Alle Minuten sind gemessen · siehe `lib/session.ts` und `study/sessions.rs`.
 */
import { useI18n } from "../lib/i18n";
import { deInt } from "../lib/format";
import type { WeekBudget } from "../lib/week";
import { AREA_COLOR, AREA_KEY } from "../lib/study";

/** Radius und Strichstärke des Rings · daraus folgt der Umfang. */
const RADIUS = 52;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Lücke zwischen zwei Segmenten, damit die Farben nicht ineinanderlaufen. */
const GAP = 2.5;

/**
 * Der Ring: ein Segment je Bereich, Skala bis Ziel oder Ist.
 *
 * Wer über das Ziel hinaus trainiert hat, füllt den Ring und bekommt die
 * Zielmarke als Strich daneben · gestaucht wäre der Ring eine Bestrafung.
 */
export function WeekRing({ budget }: { budget: WeekBudget }) {
  const { t } = useI18n();
  const scale = Math.max(budget.target, budget.minutes, 1);
  const filled = budget.byArea.filter((entry) => entry.minutes > 0);

  let offset = 0;
  const segments = filled.map((entry) => {
    const length = (entry.minutes / scale) * CIRCUMFERENCE;
    const segment = { area: entry.area, length: Math.max(0, length - GAP), offset };
    offset += length;
    return segment;
  });

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
        <circle cx="64" cy="64" r={RADIUS} fill="none" stroke="var(--color-panel3)" strokeWidth={STROKE} />
        <g transform="rotate(-90 64 64)" fill="none" strokeWidth={STROKE}>
          {segments.map((segment) => (
            <circle
              key={segment.area}
              cx="64"
              cy="64"
              r={RADIUS}
              stroke={AREA_COLOR[segment.area]}
              strokeDasharray={`${segment.length} ${CIRCUMFERENCE}`}
              strokeDashoffset={-segment.offset}
            />
          ))}
        </g>
        {/* Zielmarke · sie steht still, während der Ring wächst. */}
        {budget.target > 0 && budget.minutes > budget.target && (
          <rect
            x="63"
            y="6"
            width="2"
            height="16"
            rx="1"
            fill="var(--color-ink)"
            opacity="0.75"
            transform={`rotate(${(budget.target / scale) * 360} 64 64)`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[24px] font-semibold tracking-tight tabular-nums text-ink">
          {deInt(budget.minutes)}
        </span>
        <span className="mt-px text-[10.5px] tabular-nums text-ink3">
          {t("st.weekBudgetOf", { m: deInt(budget.target) })}
        </span>
      </div>
    </div>
  );
}

/**
 * Je Bereich eine Zeile: gemessen, Ziel, Balken.
 *
 * Der Balken zeigt das Verhältnis zum eigenen Ziel, nicht die absolute Größe ·
 * sonst verschwindet ein 9-Minuten-Ziel neben einem 36-Minuten-Ziel.
 */
export function WeekAreaList({ budget }: { budget: WeekBudget }) {
  const { t } = useI18n();
  return (
    <ul className="flex min-w-0 flex-1 flex-col gap-2">
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
              className={`w-[66px] shrink-0 truncate text-[11.5px] ${
                entry.minutes > 0 ? "text-ink2" : "text-ink3"
              }`}
            >
              {t(AREA_KEY[entry.area])}
            </span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3">
              <span
                className="block h-full rounded-full"
                style={{ width: `${done}%`, background: AREA_COLOR[entry.area] }}
              />
            </span>
            <span className="w-[54px] shrink-0 text-right text-[11.5px] tabular-nums text-ink3">
              {t("st.weekAreaValue", { a: deInt(entry.minutes), m: deInt(entry.target) })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Die Woche als ein flacher Balken · der Kopf der Karte auf dem Handy. */
export function WeekBar({ budget }: { budget: WeekBudget }) {
  const { t } = useI18n();
  const scale = Math.max(budget.target, budget.minutes, 1);
  const filled = budget.byArea.filter((entry) => entry.minutes > 0);
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-panel3">
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
  );
}

/** Herkunft des Ziels und die heutige Zahl · der Fuß beider Fassungen. */
export function WeekNote({
  budget,
  source,
  className = "",
}: {
  budget: WeekBudget;
  source?: React.ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12px] tabular-nums text-ink2">
          {t("st.weekToday", { m: deInt(budget.today) })}
        </span>
        <span className="text-[11.5px] text-ink3">{t("st.weekMeasured")}</span>
      </div>
      {source && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">{source}</p>}
    </div>
  );
}

/** Die Wochenkarte am Desktop: Ring, Legende, Fußnote. */
export default function WeekBudgetBar({
  budget,
  /** Woher das Wochenziel kommt · als eine Zeile unter der Legende. */
  source,
}: {
  budget: WeekBudget;
  source?: React.ReactNode;
}) {
  return (
    <div data-week-budget="">
      <div className="flex items-center gap-4">
        <WeekRing budget={budget} />
        <WeekAreaList budget={budget} />
      </div>
      <WeekNote budget={budget} source={source} className="mt-3.5 border-t border-line pt-2.5" />
    </div>
  );
}
