/**
 * Verordnungskarte: Befund, Dosis, Aktion.
 *
 * Drei Zeilen, mehr nicht. Was fehlt, ist Absicht: Es gab hier einmal einen
 * Knopf „Als Fokus setzen", der einen Zyklus startete und dessen Wirkung
 * nachmaß. Der Coach nennt seine Baustellen inzwischen von selbst und rechnet
 * über ein Fenster, das der Spielhäufigkeit folgt · damit war der von Hand
 * gesetzte Fokus ein zweiter Weg zum selben Ziel, der gepflegt werden wollte.
 *
 * Am Desktop stehen die Karten nebeneinander, deshalb sitzen Dosis und Knopf
 * unten bündig — drei Karten mit unterschiedlich langen Befunden sollen dort
 * eine Zeile bilden. Auf dem Handy steht die Verordnung direkt unter dem
 * Titel und die Begründung erst auf „Warum?": auf einem Bildschirm, der drei
 * Befunde untereinander zeigt, ist der Beleg das, was man nachschlägt, und
 * nicht das, was man liest.
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { localizeFindingParams } from "../lib/findings";
import type { Prescription } from "../lib/plan";
import { AREA_COLOR, AREA_KEY } from "../lib/study";

export default function PrescriptionCard({
  prescription,
  mobile,
  onAction,
  index,
  total,
}: {
  prescription: Prescription;
  mobile: boolean;
  onAction: () => void;
  /** Platz in der Liste · nur mobil, wo immer nur eine Karte im Blick ist. */
  index?: number;
  total?: number;
}) {
  const { locale, t } = useI18n();
  // Der erste Befund liegt offen · so ist der Aufklapper einmal vorgeführt,
  // ohne dass die Seite zur Textwand wird.
  const [open, setOpen] = useState(index === 0);
  const finding = prescription.finding;
  const params = localizeFindingParams(finding.params, t, locale);
  const color = AREA_COLOR[prescription.area];
  // Zahlen der Dosis folgen der Locale wie überall sonst · ein Ratingband
  // liest sich sonst als "1400" neben "1.400" in derselben Ansicht.
  const doseParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(prescription.doseParams)) {
    doseParams[key] = typeof value === "number" ? deInt(value) : value;
  }
  if (typeof doseParams.theme === "string" && doseParams.theme) {
    doseParams.theme = localizeFindingParams({ theme: doseParams.theme }, t, locale).theme;
  }

  const area = (
    <span
      className="self-start rounded-md bg-panel3 px-2 py-0.5 text-[10.5px] uppercase tracking-wide"
      style={{ color }}
    >
      {t(AREA_KEY[prescription.area])}
    </span>
  );

  const title = (
    <div className={`font-semibold leading-snug text-ink ${mobile ? "text-[14px]" : "text-[13.5px]"}`}>
      {t(finding.titleKey, params)}
    </div>
  );

  const body = (
    <p className="text-[12.5px] leading-relaxed text-ink3">{t(finding.bodyKey, params)}</p>
  );

  const dose = prescription.doseKey && (
    <div className="flex items-start gap-2 rounded-lg border border-accent-dim bg-accent-soft px-2.5 py-2">
      <Check size={13} className="mt-0.5 shrink-0 text-accent" />
      <span className="text-[12.5px] leading-relaxed text-accent">
        {t(prescription.doseKey, doseParams)}
      </span>
    </div>
  );

  const action = prescription.action && (
    <button
      type="button"
      onClick={onAction}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-panel font-medium text-ink2 transition-colors hover:border-line2 hover:text-ink ${
        mobile ? "h-11 w-full flex-1 text-[13px]" : "px-3.5 py-2 text-[13px]"
      }`}
    >
      {t(`fnd.action.${prescription.action.kind}` as Key)}
    </button>
  );

  if (mobile) {
    return (
      <div
        data-prescription={prescription.id}
        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
        className="rounded-xl border border-line bg-panel2 px-3.5 py-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          {area}
          {index != null && total != null && (
            <span className="text-[10.5px] tabular-nums text-ink3">
              {t("st.findingOf", { i: index + 1, n: total })}
            </span>
          )}
        </div>
        <div className="mt-2.5">{title}</div>
        {dose && <div className="mt-2.5">{dose}</div>}
        {open && <div className="mt-2.5">{body}</div>}
        <div className="mt-2.5 flex items-center gap-2">
          {action}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="h-11 shrink-0 px-1 text-[12.5px] text-ink3 transition-colors hover:text-ink"
          >
            {open ? t("st.less") : t("st.why")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-prescription={prescription.id}
      className="flex flex-col rounded-xl border border-line bg-panel2 p-3.5"
    >
      {area}
      <div className="mt-2.5">{title}</div>
      <div className="mt-1.5">{body}</div>
      <div className="mt-auto pt-3">
        {dose}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
