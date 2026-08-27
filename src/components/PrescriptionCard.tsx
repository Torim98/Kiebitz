/**
 * Verordnungskarte: Befund, Dosis, Aktion.
 *
 * Drei Zeilen, mehr nicht. Was fehlt, ist Absicht: Es gab hier einmal einen
 * Knopf „Als Fokus setzen", der einen Zyklus startete und dessen Wirkung
 * nachmaß. Der Coach nennt seine Baustellen inzwischen von selbst und rechnet
 * über ein Fenster, das der Spielhäufigkeit folgt · damit war der von Hand
 * gesetzte Fokus ein zweiter Weg zum selben Ziel, der gepflegt werden wollte.
 */
import { Check } from "lucide-react";
import { Button } from "./ui";
import { useI18n, type Key } from "../lib/i18n";
import { deInt } from "../lib/format";
import { localizeFindingParams } from "../lib/findings";
import type { Prescription } from "../lib/plan";
import { AREA_KEY } from "../lib/study";

export default function PrescriptionCard({
  prescription,
  mobile,
  onAction,
}: {
  prescription: Prescription;
  mobile: boolean;
  onAction: () => void;
}) {
  const { locale, t } = useI18n();
  const finding = prescription.finding;
  const params = localizeFindingParams(finding.params, t, locale);
  // Zahlen der Dosis folgen der Locale wie überall sonst · ein Ratingband
  // liest sich sonst als "1400" neben "1.400" in derselben Ansicht.
  const doseParams: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(prescription.doseParams)) {
    doseParams[key] = typeof value === "number" ? deInt(value) : value;
  }
  if (typeof doseParams.theme === "string" && doseParams.theme) {
    doseParams.theme = localizeFindingParams({ theme: doseParams.theme }, t, locale).theme;
  }

  return (
    <div
      data-prescription={prescription.id}
      className="rounded-xl border border-line bg-panel2 p-4"
    >
      <span className="rounded-md bg-panel3 px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-ink3">
        {t(AREA_KEY[prescription.area])}
      </span>

      <div className="mt-2.5 text-[13.5px] font-medium leading-snug text-ink">
        {t(finding.titleKey, params)}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink3">
        {t(finding.bodyKey, params)}
      </p>

      {prescription.doseKey && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2">
          <Check size={13} className="mt-0.5 shrink-0 text-accent" />
          <span className="text-[12.5px] leading-relaxed text-accent">
            {t(prescription.doseKey, doseParams)}
          </span>
        </div>
      )}

      {prescription.action && (
        <Button
          onClick={onAction}
          className={mobile ? "mt-3 w-full justify-center" : "mt-3"}
        >
          {t(`fnd.action.${prescription.action.kind}` as Key)}
        </Button>
      )}
    </div>
  );
}
