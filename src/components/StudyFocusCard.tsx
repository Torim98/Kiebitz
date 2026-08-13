/**
 * Fokuskarte: Befund, Dosis, Aktion, Wirkung.
 *
 * Die vierte Zeile ist die, um die es geht. Ein Trainingsvorschlag ohne
 * Rückmeldung ist ein Ratschlag; erst die gemessene Veränderung macht daraus
 * ein Programm. Und weil „unverändert" der häufigste ehrliche Befund ist, steht
 * er hier gleichberechtigt neben „wirkt" — samt der Rauschgrenze, an der man
 * ablesen kann, ab wann eine Veränderung überhaupt eine wäre.
 */
import { Check, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { Button } from "./ui";
import { useI18n, type Key } from "../lib/i18n";
import { de, deInt } from "../lib/format";
import { localizeFindingParams } from "../lib/findings";
import type { Prescription } from "../lib/plan";
import type { EffectResult } from "../lib/effect";
import { cycleProgress } from "../lib/effect";
import { AREA_KEY, type StudyFocus } from "../lib/study";

const VERDICT_STYLE = {
  improved: { icon: TrendingUp, color: "text-win", key: "plan.verdictImproved" as Key },
  worse: { icon: TrendingDown, color: "text-loss", key: "plan.verdictWorse" as Key },
  unchanged: { icon: Minus, color: "text-ink3", key: "plan.verdictUnchanged" as Key },
  insufficient: { icon: Minus, color: "text-ink3", key: "plan.verdictInsufficient" as Key },
} as const;

/** Kennzahl in der Sprache des Nutzers benennen. */
function metricLabel(key: string): Key {
  return `metric.${key}` as Key;
}

export function EffectLine({ effect }: { effect: EffectResult }) {
  const { t } = useI18n();
  const style = VERDICT_STYLE[effect.verdict];
  const Icon = style.icon;

  const values =
    effect.before != null && effect.after != null
      ? `${de(effect.before)} → ${de(effect.after)}`
      : effect.after != null
        ? de(effect.after)
        : "—";

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
      <Icon size={13} className={`shrink-0 self-center ${style.color}`} />
      <span className="text-ink3">{t(metricLabel(effect.key))}</span>
      <span className="font-medium tabular-nums text-ink2">{values}</span>
      <span className={style.color}>
        {effect.verdict === "insufficient"
          ? t("plan.verdictInsufficient", { n: deInt(effect.missing) })
          : t(style.key)}
      </span>
      {effect.noise != null && effect.verdict !== "insufficient" && (
        <span className="text-ink3">
          {t("plan.noiseNote", { v: de(effect.noise) })}
        </span>
      )}
    </div>
  );
}

export default function StudyFocusCard({
  prescription,
  focus,
  effect,
  now,
  mobile,
  onStart,
  onStop,
  onComplete,
  onAction,
}: {
  prescription: Prescription;
  /** Laufender Zyklus zu diesem Bereich, falls einer aktiv ist. */
  focus: StudyFocus | null;
  effect: EffectResult | null;
  now: number;
  mobile: boolean;
  onStart: () => void;
  onStop: () => void;
  onComplete: () => void;
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
  const progress = focus ? cycleProgress(focus.start_ts, focus.cycle_days, now) : 0;

  return (
    <div
      data-focus-card={prescription.id}
      className="rounded-xl border border-line bg-panel2 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-md bg-panel3 px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-ink3">
          {t(AREA_KEY[prescription.area])}
        </span>
        {focus ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] tabular-nums text-ink3">
              {t("plan.cycleDay", {
                d: Math.min(
                  focus.cycle_days,
                  Math.floor((now - focus.start_ts) / 86_400) + 1
                ),
                n: focus.cycle_days,
              })}
            </span>
            {progress >= 100 && (
              <button
                type="button"
                onClick={onComplete}
                title={t("plan.focusComplete")}
                className="flex items-center gap-1 rounded-md border border-accent-dim bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15"
              >
                <Check size={12} />
                {t("plan.focusComplete")}
              </button>
            )}
            <button
              type="button"
              onClick={onStop}
              title={t("plan.focusStop")}
              className="rounded-md border border-line p-1 text-ink3 transition-colors hover:text-ink"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          // Ohne messbare Kennzahl gibt es keinen Zyklus · ein Fokus, dessen
          // Wirkung niemand feststellen kann, ist nur ein Vorsatz.
          prescription.metricKey && (
            <button
              type="button"
              onClick={onStart}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-[11.5px] text-ink3 transition-colors hover:border-accent-dim hover:text-accent"
            >
              {t("plan.focusStart")}
            </button>
          )
        )}
      </div>

      {focus && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel3">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}

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

      {effect && (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <EffectLine effect={effect} />
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
