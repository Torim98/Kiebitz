/**
 * Was heute ansteht · und wie man es startet.
 *
 * Vorher standen hier drei feste Zeilen (Wiederholungen, Puzzles, Analyse),
 * daneben die Fokuskarten mit ihrer Dosis und darunter der Kalender mit den
 * geplanten Einheiten. Drei Flächen, die dieselbe Frage verschieden
 * beantworteten, und keine davon führte direkt in den Trainer.
 *
 * Heute ist es eine Liste mit einem herausgehobenen Kopf: „Jetzt dran" zeigt
 * die erste offene Einheit groß, mit ihrer Dosis aus dem Lernplan („15 Aufgaben,
 * Band 1420–1580, Motiv Fesselung") und einer Schaltfläche, die genau das
 * öffnet. Darunter steht der Rest des Tages als Liste — geplante Einheiten und
 * das, was ohne Plan täglich anfällt. Der eine große Block ist der Unterschied
 * zwischen fünf gleich aussehenden Zeilen und einer Antwort auf „womit fange
 * ich an?".
 *
 * Auch erledigt bleibt stehen: der erreichte Zustand ist die halbe Rückmeldung,
 * und eine Liste, die beim Abhaken verschwindet, nimmt sie einem wieder weg.
 */
import { Check, CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { AREA_COLOR, AREA_KEY, type Area } from "../lib/study";

export interface SessionItem {
  id: string;
  /** Bereich für Farbe und Zuordnung; null bei Einheiten ohne Bereich. */
  area: Area | null;
  icon: LucideIcon;
  label: string;
  /** Dosis oder Fortschritt, eine Zeile · so steht es in der Liste. */
  detail: string;
  /** Ausführliche Fassung für den Block „Jetzt dran" · sonst `detail`. */
  dose?: string;
  /** Herkunft der Einheit, über dem Titel im Block „Jetzt dran". */
  meta?: string;
  minutes: number | null;
  done: boolean;
  /** Von der Messung erfüllt statt von Hand abgehakt. */
  auto: boolean;
  action?: {
    /** Kurz, für die Liste. */
    label: string;
    /** Ausführlich, für den großen Knopf · sonst `label`. */
    heroLabel?: string;
    run: () => void;
  };
  /**
   * Von Hand abhaken · nur geplante Einheiten haben das. Wiederholungen,
   * Tagesdosis und Analyse-Rückstand sind Mengen, die die Messung selbst
   * beantwortet; ein Häkchen daran wäre eine Behauptung.
   */
  toggle?: () => void;
}

function areaColor(area: Area | null): string {
  return area ? AREA_COLOR[area] : "var(--color-ink3)";
}

/**
 * Der Kopf der Tagessitzung: die erste offene Einheit, groß.
 *
 * Ist nichts mehr offen, steht hier der erreichte Zustand — und, wenn morgen
 * schon etwas geplant ist, woran es weitergeht.
 */
export function SessionHero({
  item,
  mobile,
  tomorrow,
}: {
  item: SessionItem | null;
  mobile: boolean;
  /** Fertige Zeile für „morgen geht es weiter mit …" · optional. */
  tomorrow?: string;
}) {
  const { t } = useI18n();

  if (!item) {
    return (
      <div
        data-session-hero="done"
        className="flex items-center gap-3 rounded-xl border border-accent-dim bg-accent-soft p-4"
      >
        <CheckCircle2 size={22} className="shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-accent">{t("st.allDone")}</div>
          {tomorrow && <div className="mt-0.5 text-[12.5px] text-ink2">{tomorrow}</div>}
        </div>
      </div>
    );
  }

  const color = areaColor(item.area);
  const Icon = item.icon;

  return (
    <div
      data-session-hero={item.id}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      className={`relative overflow-hidden rounded-xl border border-line ${
        mobile ? "bg-panel px-4 py-3.5" : "bg-panel2 px-4 py-3.5"
      }`}
    >
      {/* Das Bereichssymbol als Wasserzeichen · es sagt auf einen Blick, worum
          es geht, ohne eine Zeile dafür zu verbrauchen. */}
      <Icon
        size={mobile ? 128 : 132}
        strokeWidth={1.4}
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -top-3 opacity-[0.07]"
        style={{ color }}
      />

      <div className="relative flex items-center justify-between gap-2">
        {mobile && (
          <span className="text-[10.5px] uppercase tracking-wider text-ink3">{t("st.now")}</span>
        )}
        {item.area && (
          <span
            className="rounded-md bg-panel3 px-2 py-0.5 text-[10.5px] uppercase tracking-wide"
            style={{ color }}
          >
            {t(AREA_KEY[item.area])}
          </span>
        )}
        {!mobile && item.meta && (
          <span className="flex-1 text-[11.5px] tabular-nums text-ink3">{item.meta}</span>
        )}
      </div>

      <div
        className={`relative mt-2 font-semibold tracking-tight text-ink ${
          mobile ? "text-[19px]" : "text-[18px]"
        }`}
      >
        {item.label}
      </div>
      <p className="relative mt-1 max-w-[470px] text-[13px] leading-relaxed text-ink2">
        {item.dose ?? item.detail}
      </p>
      {mobile && item.meta && (
        <div className="relative mt-1.5 text-[11.5px] tabular-nums text-ink3">{item.meta}</div>
      )}

      <div className={`relative mt-3.5 flex items-center gap-2 ${mobile ? "" : "gap-2.5"}`}>
        {item.action && (
          <button
            type="button"
            onClick={item.action.run}
            className={`inline-flex items-center justify-center gap-2 rounded-lg bg-accent font-medium text-[#06251a] transition-colors hover:bg-[#2bd49b] ${
              mobile ? "h-[46px] flex-1 text-[14px] font-semibold" : "px-4 py-2.5 text-[13px]"
            }`}
          >
            {item.action.heroLabel ?? item.action.label}
            <ChevronRight size={mobile ? 16 : 15} />
          </button>
        )}
        {item.toggle && (
          <button
            type="button"
            onClick={item.toggle}
            aria-label={t("st.checkOff")}
            title={t("st.checkOff")}
            className={`shrink-0 rounded-lg border border-line bg-panel2 text-ink3 transition-colors hover:border-line2 hover:text-ink ${
              mobile ? "flex h-[46px] w-[46px] items-center justify-center" : "px-3.5 py-2 text-[12.5px]"
            }`}
          >
            {mobile ? <Check size={18} /> : t("st.checkOff")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Der Rest des Tages · geplante Einheiten und was täglich anfällt. */
export function SessionList({ items, mobile }: { items: SessionItem[]; mobile: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const color = item.done ? "var(--color-accent-dim)" : areaColor(item.area);
        return (
          <div
            key={item.id}
            data-session-item={item.id}
            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
            className={`flex items-center rounded-lg border border-line ${
              item.done ? "bg-accent-soft/40" : "bg-panel2"
            } ${mobile ? "min-h-[60px] pr-2" : "gap-3 py-2 pl-2.5 pr-3"}`}
          >
            <Mark item={item} mobile={mobile} />
            <div className={`min-w-0 flex-1 ${mobile ? "pr-2" : ""}`}>
              <div
                className={`truncate ${mobile ? "text-[13.5px]" : "text-[13px]"} ${
                  item.done ? "text-ink3" : "text-ink"
                }`}
              >
                {item.label}
                {item.minutes != null && (
                  <span className="ml-1.5 text-[11.5px] tabular-nums text-ink3">
                    {t("plan.minutes", { m: deInt(item.minutes) })}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[12px] leading-snug text-ink3">
                {item.detail}
              </div>
            </div>
            {item.done ? (
              <span
                className={`shrink-0 text-right text-[12px] font-medium leading-tight text-accent ${
                  mobile ? "max-w-[96px] text-[11.5px]" : ""
                }`}
              >
                {/* „Von selbst erledigt" ist die eigentliche Neuerung: die
                    gemessene Zeit hat die Einheit erfüllt, niemand musste sie
                    noch einmal melden. */}
                {item.auto ? t("st.doneMeasured") : t("st.doneLabel")}
              </span>
            ) : (
              item.action && (
                <button
                  type="button"
                  onClick={item.action.run}
                  className={`shrink-0 rounded-lg border border-line bg-panel font-medium text-ink2 transition-colors hover:border-line2 hover:text-ink ${
                    mobile ? "h-11 px-4 text-[13px]" : "px-3 py-1.5 text-[12.5px]"
                  }`}
                >
                  {item.action.label}
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Das Häkchen links · Knopf nur dort, wo von Hand abgehakt werden darf.
 *
 * Die Trefferfläche ist mobil bewusst größer als der sichtbare Kreis: 20 px
 * sind zu treffen, 44 px sind bequem zu treffen.
 */
function Mark({ item, mobile }: { item: SessionItem; mobile: boolean }) {
  const { t } = useI18n();
  const circle = (
    <span
      className={`flex items-center justify-center rounded-full border-[1.5px] ${
        mobile ? "h-[22px] w-[22px]" : "h-5 w-5"
      } ${item.done ? "border-accent bg-accent" : "border-line2"}`}
    >
      {item.done && <Check size={mobile ? 13 : 12} strokeWidth={3} className="text-[#06251a]" />}
    </span>
  );

  if (!item.toggle) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center ${mobile ? "h-[58px] w-11" : ""}`}
      >
        {circle}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={item.toggle}
      aria-label={item.done ? t("st.markOpen") : t("st.markDone")}
      className={`flex shrink-0 items-center justify-center ${mobile ? "h-[58px] w-11" : ""}`}
    >
      {circle}
    </button>
  );
}

export default function TodaySession({
  items,
  emptyKey,
  mobile,
  tomorrow,
}: {
  items: SessionItem[];
  /** Text, wenn heute nichts offen ist. */
  emptyKey: Key;
  mobile: boolean;
  tomorrow?: string;
}) {
  const { t } = useI18n();
  const next = items.find((item) => !item.done) ?? null;
  const rest = items.filter((item) => item.id !== next?.id);

  if (items.length === 0) {
    return <p className="py-2 text-[13px] leading-relaxed text-ink3">{t(emptyKey)}</p>;
  }

  return (
    <div>
      <SessionHero item={next} mobile={mobile} tomorrow={tomorrow} />
      {rest.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-[10.5px] uppercase tracking-wider text-ink3">
            {t("st.nextToday")}
          </div>
          <SessionList items={rest} mobile={mobile} />
        </>
      )}
    </div>
  );
}
