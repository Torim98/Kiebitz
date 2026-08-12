/**
 * Gemeinsame Bausteine der Insights-Reiter.
 *
 * Der wichtigste ist `Section`: eine Karte, die eingeklappt nur ihre Kernaussage
 * zeigt. Damit passen auf einen Reiter zehn Auswertungen, ohne dass er beim
 * Öffnen erschlägt · und auf dem Handy ist alles bis auf die erste zu.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, TrendingDown, TrendingUp, Sparkles } from "lucide-react";
import { useI18n, type Key } from "../../lib/i18n";
import { useMobileShell } from "../../components/MobileShell";
import { chart } from "../../components/chartTheme";
import { de, deInt } from "../../lib/format";
import { localizeFindingParams, type Finding, type Tone } from "../../lib/findings";

export function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: Tone;
}) {
  const color = tone === "bad" ? "text-loss" : tone === "good" ? "text-win" : "";
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[11.5px] text-ink3">{label}</div>
      <div className={`mt-1.5 text-[25px] font-semibold leading-none tracking-tight ${color}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-ink3">{sub}</div>
    </div>
  );
}

/**
 * Ausklappbare Auswertung. `summary` ist die eine Zeile, die im geschlossenen
 * Zustand stehen bleibt · sie muss für sich allein etwas aussagen.
 */
export function Section({
  title,
  summary,
  children,
  defaultOpen = false,
  disabled = false,
  disabledNote,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Zu wenig Daten · dann bleibt die Karte zu und erklärt, warum. */
  disabled?: boolean;
  disabledNote?: string;
}) {
  const mobile = useMobileShell();
  const [open, setOpen] = useState(defaultOpen && !mobile && !disabled);
  const { t } = useI18n();

  return (
    <section className="rounded-xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => !disabled && setOpen((value) => !value)}
        aria-expanded={open}
        disabled={disabled}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
          disabled ? "cursor-default" : "hover:bg-panel2"
        } ${open ? "border-b border-line" : ""} rounded-xl`}
      >
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-ink2">{title}</h2>
          {(summary || disabled) && (
            <div className="mt-0.5 text-[12px] leading-snug text-ink3">
              {disabled ? (disabledNote ?? t("ins.tooFewData")) : summary}
            </div>
          )}
        </div>
        {!disabled && (
          <ChevronDown
            size={16}
            className={`shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

/** Balken mit Beschriftung links und Prozentwert rechts. */
export function MetricBar({
  label,
  note,
  value,
  /** Farbschwellen; Standard passt für Punktausbeute. */
  good = 55,
  bad = 45,
  /** Balkenlänge relativ zu diesem Maximum (Standard 100). */
  max = 100,
}: {
  label: string;
  note?: string;
  value: number;
  good?: number;
  bad?: number;
  max?: number;
}) {
  const width = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="grid grid-cols-[minmax(96px,1fr)_2fr_58px] items-center gap-3">
      <div className="min-w-0">
        <div className="truncate text-[12px] text-ink2">{label}</div>
        {note && <div className="truncate text-[10.5px] text-ink3">{note}</div>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel3">
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: value >= good ? chart.win : value >= bad ? chart.draw : chart.loss,
          }}
        />
      </div>
      <div className="text-right text-[12px] tabular-nums text-ink2">{de(value)}</div>
    </div>
  );
}

/** Zwei Werte gegeneinander · das Arbeitspferd dieser Seite. */
export function Versus({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  unit = "",
  /** Ist ein kleinerer Wert besser? */
  lowerIsBetter = false,
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  const leftWins = lowerIsBetter ? leftValue < rightValue : leftValue > rightValue;
  const tone = (mine: boolean) =>
    mine === leftWins ? "text-win" : "text-ink";
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { label: leftLabel, value: leftValue, mine: true },
        { label: rightLabel, value: rightValue, mine: false },
      ].map((side) => (
        <div key={side.label} className="rounded-lg border border-line bg-panel2 p-3.5 text-center">
          <div className="text-[11.5px] text-ink3">{side.label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone(side.mine)}`}>
            {de(side.value)}
            {unit && <span className="ml-0.5 text-[13px] font-normal text-ink3">{unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kleine Kennzahl in einer Reihe von Kennzahlen. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel2 p-3">
      <div className="text-[11px] text-ink3">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-ink3">{hint}</div>}
    </div>
  );
}

const TONE_STYLE: Record<Tone, { border: string; icon: typeof TrendingDown; color: string }> = {
  bad: { border: "border-loss/40", icon: TrendingDown, color: "text-loss" },
  warn: { border: "border-gold/40", icon: TrendingDown, color: "text-gold" },
  good: { border: "border-win/40", icon: TrendingUp, color: "text-win" },
};

/** Ein Befund als Karte · optional mit Sprung ins passende Training. */
export function FindingCard({
  finding,
  onAction,
  compact = false,
}: {
  finding: Finding;
  onAction?: (finding: Finding) => void;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  const style = TONE_STYLE[finding.tone];
  const Icon = style.icon;
  const label = finding.action ? t(`fnd.action.${finding.action.kind}` as Key) : null;
  const params = localizeFindingParams(finding.params, t, locale);

  return (
    <div className={`rounded-lg border bg-panel2 p-3.5 ${style.border}`}>
      <div className="flex items-start gap-3">
        <Icon size={16} className={`mt-0.5 shrink-0 ${style.color}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug text-ink">
            {t(finding.titleKey, params)}
          </div>
          {!compact && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink3">
              {t(finding.bodyKey, params)}
            </p>
          )}
        </div>
        {label && onAction && (
          <button
            type="button"
            onClick={() => onAction(finding)}
            className="shrink-0 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink2 transition-colors hover:border-line2 hover:text-ink"
          >
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

/** Befunde eines Reiters, oben angeheftet. Nichts anzeigen ist auch eine Aussage. */
export function FindingStrip({
  findings,
  onAction,
}: {
  findings: Finding[];
  onAction?: (finding: Finding) => void;
}) {
  const { t } = useI18n();
  if (findings.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2.5 flex items-center gap-2 text-[12px] text-ink3">
        <Sparkles size={14} className="text-gold" />
        {t("ins.findingsHere")}
      </div>
      <div className="flex flex-col gap-2">
        {findings.slice(0, 3).map((finding) => (
          <FindingCard key={finding.id} finding={finding} onAction={onAction} />
        ))}
      </div>
    </div>
  );
}

/** Wie viele Partien tragen diese Auswertung überhaupt? */
export function CoverageNote({ shown, total, unitKey }: { shown: number; total: number; unitKey: Key }) {
  const { t } = useI18n();
  return (
    <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink3">
      {t("ins.coverageNote", { n: deInt(shown), total: deInt(total), unit: t(unitKey) })}
    </p>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line2 px-4 py-6 text-center text-[12.5px] text-ink3">
      {text}
    </div>
  );
}
