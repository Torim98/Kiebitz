/**
 * Der Wochenbericht · ein Symbol im Kopf der Seite, der Bericht als Dialog.
 *
 * Er stand zuerst als Karte ganz oben im Study-Reiter und nahm dort den halben
 * Bildschirm ein — an jedem Tag, an dem er noch nicht gelesen war, verdrängte
 * er genau die Frage, mit der man diese Seite öffnet („was mache ich jetzt").
 * Ein Rückblick ist aber kein Tagesgeschäft: Er wird einmal gelesen und dann
 * höchstens noch einmal nachgeschlagen.
 *
 * Deshalb jetzt zweiteilig. Im Kopf sitzt ein Symbol neben Rating und Serie ·
 * es leuchtet, solange der Bericht der Woche ungelesen ist, und bleibt danach
 * ruhig stehen. Das ist der zweite Gewinn: Der Bericht verschwindet nicht mehr
 * für immer, wenn man ihn einmal weggeklickt hat, sondern ist die Woche über
 * erreichbar. Ein Menüpunkt ist er trotzdem nicht — nichts in der Navigation
 * verweist auf ihn.
 *
 * Der Dialog selbst trägt drei Blöcke in fester Reihenfolge, weil sie eine
 * Kette bilden: was sich verändert hat → was das Training dazu beigetragen
 * haben könnte → was daraus für die begonnene Woche folgt. Der letzte Block
 * ist der einzige mit einem Knopf: Der Bericht endet in einer Handlung und
 * nicht in einer Zahl.
 *
 * Gerechnet wird nichts hier · siehe `lib/weekly.ts`.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, CalendarCheck, X } from "lucide-react";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { isoWeek } from "../lib/dates";
import { localizeFindingParams } from "../lib/findings";
import { ratingNoise } from "../lib/effect";
import { AREA_COLOR, AREA_KEY } from "../lib/study";
import { useBackDismiss } from "../lib/backDismiss";
import { useMobileShell } from "./MobileShell";
import {
  formatDelta,
  formatMetric,
  reportHeadline,
  type WeeklyChange,
  type WeeklyReport,
} from "../lib/weekly";
import { PlusLock } from "./PlusLock";

/** Überschrift eines der drei Blöcke · sie tragen den Bericht, nicht die Zahlen. */
function BlockTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-ink3">{children}</h3>
  );
}

/**
 * Eine Veränderung: Name, Vorher-Nachher, Vorzeichen.
 *
 * `quiet` ist derselbe Aufbau in Grau · eine Bewegung, die ihre Rauschgrenze
 * nicht erreicht hat, wird gezeigt und als das beschriftet, was sie ist. Sie
 * wegzulassen wäre ehrlicher, aber der Bericht stünde dann in ruhigen Wochen
 * leer da; sie wie einen Fortschritt zu färben wäre gelogen.
 */
function ChangeRow({ change, quiet = false }: { change: WeeklyChange; quiet?: boolean }) {
  const { t } = useI18n();
  const color = quiet ? "text-ink3" : change.better ? "text-accent" : "text-loss";
  return (
    <li data-weekly-change={change.key} className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">
        {t(`metric.${change.key}` as Key)}
      </span>
      <span className="shrink-0 text-[12.5px] tabular-nums text-ink3">
        {formatMetric(change.from, change.unit)}
        <ArrowRight size={11} className="mx-1 inline align-[-1px]" aria-hidden="true" />
        <span className="font-medium text-ink">{formatMetric(change.to, change.unit)}</span>
      </span>
      <span className={`w-[62px] shrink-0 text-end text-[12px] font-medium tabular-nums ${color}`}>
        {formatDelta(change)}
      </span>
    </li>
  );
}

/**
 * Das Symbol im Kopf der Seite.
 *
 * Es steht neben Rating und Serie, weil es dieselbe Art Angabe ist: eine
 * Kennzahl über die Woche, kein Bedienelement des Tagesgeschäfts. Ungelesen
 * trägt es die Akzentfarbe, danach steht es ruhig daneben — der Bericht bleibt
 * die Woche über erreichbar, statt nach dem ersten Wegklicken verschwunden zu
 * sein.
 */
export function WeeklyReportButton({
  unread,
  onClick,
}: {
  /** Ist der Bericht dieser Woche noch ungelesen? */
  unread: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  // Mobil steht der Knopf ohnehin in einer eigenen Zeile: Rating und Serie
  // füllen dort die Breite allein. Eine Zeile, in der nur ein Quadrat sitzt,
  // sieht nach einem Rest aus · deshalb trägt er dort seinen Namen.
  const mobile = useMobileShell();
  const label = unread ? t("wk.openNew") : t("wk.open");
  return (
    <button
      type="button"
      data-weekly-open=""
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
        unread
          ? "border-accent-dim bg-accent-soft text-accent hover:border-accent"
          : "border-line bg-panel text-ink3 hover:border-line2 hover:text-ink"
      }`}
    >
      <CalendarCheck size={15} aria-hidden="true" />
      {mobile && <span className="font-medium">{t("wk.title")}</span>}
      {/* Ein Punkt statt einer Zahl · es gibt genau einen Bericht pro Woche,
          und „1" daneben wäre eine Zählung ohne Gegenstand. */}
      {unread && <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />}
    </button>
  );
}

export default function WeeklyReportDialog({
  report,
  mobile,
  onClose,
  onAction,
}: {
  report: WeeklyReport;
  mobile: boolean;
  onClose: () => void;
  /** Der Knopf des letzten Blocks · dieselbe Verordnungslogik wie im Coach. */
  onAction: () => void;
}) {
  const { locale, t } = useI18n();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Escape schließt · derselbe Griff wie in den übrigen Dialogen der App.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Android-Zurück schließt den Bericht, statt die App zu verlassen.
  useBackDismiss(onClose);

  const from = new Date(report.week.start * 1_000);
  const to = new Date((report.week.end - 86_400) * 1_000);
  // Die Tagesgrenzen sind UTC · ohne `timeZone` würde westlich von Greenwich
  // der Sonntag davor als Wochenanfang dastehen.
  const day = (date: Date) =>
    date.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  // Bereiche in der Reihenfolge ihrer Zeit · was am meisten Zeit gekostet hat,
  // ist das, worüber der Block Auskunft geben soll.
  const trained = report.byArea
    .filter((entry) => entry.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const ratingLine =
    report.rating &&
    (Math.abs(report.rating.delta) > ratingNoise(report.rating.games)
      ? t("wk.ratingMoved", {
          d: `${report.rating.delta > 0 ? "+" : ""}${deInt(report.rating.delta)}`,
          n: deInt(report.rating.games),
        })
      : t("wk.ratingNoise", { n: deInt(report.rating.games) }));

  const changed = (
    <div data-weekly-block="changes">
      <BlockTitle>{t("wk.blockChanged")}</BlockTitle>
      {report.changes.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {report.changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </ul>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.changesQuiet")}</p>
          {report.quiet && (
            <ul className="mt-2.5">
              <ChangeRow change={report.quiet} quiet />
            </ul>
          )}
        </>
      )}
      {ratingLine && (
        <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
          {ratingLine}
        </p>
      )}
    </div>
  );

  const effect = (
    <div data-weekly-block="effect">
      <BlockTitle>{t("wk.blockEffect")}</BlockTitle>
      <p className="mb-2.5 text-[13px] text-ink2">
        <span className="font-semibold tabular-nums text-ink">{deInt(report.minutes)}</span>{" "}
        {report.target > 0
          ? t("wk.minutesOfTarget", { m: deInt(report.target) })
          : t("wk.minutesPlain")}
        {report.previousMinutes > 0 && (
          <span className="text-ink3">
            {" · "}
            {t("wk.minutesBefore", { m: deInt(report.previousMinutes) })}
          </span>
        )}
      </p>
      {trained.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {trained.map((entry) => (
            <li
              key={entry.area}
              data-weekly-area={entry.area}
              // Umbrechend statt abschneidend · auf dem Handy passt „im
              // Repertoire geblieben +6,7 %" nicht mehr neben die Minuten,
              // und abgeschnitten sagt der Satz weniger als gar keiner.
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            >
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: AREA_COLOR[entry.area] }}
              />
              <span className="w-[66px] shrink-0 truncate text-[12px] text-ink2">
                {t(AREA_KEY[entry.area])}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-ink">
                {t("plan.minutes", { m: deInt(entry.minutes) })}
              </span>
              {entry.change && (
                <span className="ms-auto text-[11.5px] tabular-nums text-ink3">
                  {t(`metric.${entry.change.key}` as Key)}{" "}
                  <span className={entry.change.moved ? (entry.change.better ? "text-accent" : "text-loss") : ""}>
                    {formatDelta(entry.change)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.effectNone")}</p>
      )}
      <p className="mt-2.5 border-t border-line pt-2.5 text-[11.5px] leading-relaxed text-ink3">
        {t("wk.effectNote")}
      </p>
    </div>
  );

  const next = report.next;
  const nextParams = next ? localizeFindingParams(next.finding.params, t, locale) : undefined;
  const doseParams: Record<string, string | number> = {};
  if (next) {
    for (const [key, value] of Object.entries(next.doseParams)) {
      doseParams[key] = typeof value === "number" ? deInt(value) : value;
    }
    if (typeof doseParams.theme === "string" && doseParams.theme) {
      doseParams.theme = localizeFindingParams({ theme: doseParams.theme }, t, locale).theme;
    }
  }

  const nextBlock = (
    <div data-weekly-block="next" className="flex flex-col">
      <BlockTitle>{t("wk.blockNext")}</BlockTitle>
      {next ? (
        <>
          <div className="text-[13px] font-semibold leading-snug text-ink">
            {t(next.finding.titleKey, nextParams)}
          </div>
          {next.doseKey && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-accent">
              {t(next.doseKey, doseParams)}
            </p>
          )}
          {next.action && (
            <button
              type="button"
              onClick={onAction}
              className={`mt-3 inline-flex items-center justify-center gap-2 self-start rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px] font-medium text-ink2 transition-colors hover:border-line2 hover:text-ink ${
                mobile ? "h-11 w-full self-stretch" : ""
              }`}
            >
              {t(`fnd.action.${next.action.kind}` as Key)}
            </button>
          )}
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink3">{t("wk.nextNone")}</p>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-report-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-weekly-report=""
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <CalendarCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="weekly-report-title" className="text-[16px] font-semibold">
              {t("wk.title")}
            </h2>
            <p className="mt-0.5 text-[12px] tabular-nums text-ink3">
              {t("wk.weekRange", { w: deInt(isoWeek(from)), a: day(from), b: day(to) })}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("wk.close")}
            title={t("wk.close")}
            className="-me-1 shrink-0 rounded p-1 text-ink3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Gesperrt bleibt der Bericht sichtbar, aber unlesbar · wer den
            Knopf im Kopf gefunden hat, soll sehen, was dahinter steckt, ohne
            es geschenkt zu bekommen. Der Schließen-Knopf sitzt außerhalb der
            Sperre und funktioniert weiter. */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <PlusLock feature="adaptive_plan" label={t("wk.plusLabel")}>
            <p
              className={`font-medium leading-snug text-ink ${
                mobile ? "text-[14px]" : "text-[15px]"
              }`}
            >
              {reportHeadline(report, t)}
            </p>
            <p className="mt-1 text-[12px] text-ink3">
              {t("wk.summary", {
                g: deInt(report.games),
                d: deInt(report.activeDays),
                m: deInt(report.minutes),
              })}
            </p>
            {/* Untereinander und nicht nebeneinander · die drei Blöcke sind
                eine Kette, und in der Breite eines Dialogs wären drei Spalten
                so schmal, dass „Patzer/100 Züge" abgeschnitten dasteht. */}
            <div className="mt-4 flex flex-col gap-4">
              {changed}
              {effect}
              {nextBlock}
            </div>
          </PlusLock>
        </div>
      </div>
    </div>
  );
}
