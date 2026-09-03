/**
 * Ein Befund im Buchsatz.
 *
 * Quadrat, Titel, Begründung, und die Verordnung darunter. Die Schwere steht
 * rechts als Zahl und nicht als Farbbalken: Sie ist eine Rangordnung, keine
 * Note — sie sagt, welcher Befund zuerst dran ist, nicht wie schlimm er ist.
 * Die Fußnote unter der Liste sagt das ausdrücklich.
 *
 * Titel und Begründung kommen fertig übersetzt herein; hier wird nur gesetzt.
 */
import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import "./blatt.css";

export interface BefundProps {
  titel: string;
  text: ReactNode;
  /** 0 … 100 · die Rangordnung, nicht die Note. */
  schwere: number;
  /** "bad" | "warn" | "good" — die Töne der Befund-Engine. */
  ton: string;
  /** Die Verordnung · fehlt, wo die Daten keine hergeben. */
  verordnung?: ReactNode;
  letzte?: boolean;
  onClick?: () => void;
}

const TONFARBE: Record<string, string> = {
  bad: "var(--color-loss)",
  warn: "var(--color-warn)",
  good: "var(--color-win)",
};

export function Befund({ titel, text, schwere, ton, verordnung, letzte = false, onClick }: BefundProps) {
  const { t } = useI18n();
  const inhalt = (
    <>
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden
          className="inline-block h-[9px] w-[9px] flex-none -translate-y-px"
          style={{ background: TONFARBE[ton] ?? "var(--color-draw)" }}
        />
        <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">{titel}</span>
        <span className="blatt-zahl shrink-0 text-[11px] text-ink3">
          {t("blatt.severity", { n: deInt(schwere) })}
        </span>
      </div>
      <div className="buch mt-1 ps-[19px] text-[13.5px] leading-[1.5] text-ink2">{text}</div>
      {verordnung && (
        <div className="mt-1.5 flex items-baseline gap-[9px] ps-[19px]">
          <span className="blatt-feld shrink-0 text-ink3">{t("blatt.prescription")}</span>
          <span className="flex-1 text-[12.5px] text-ink">{verordnung}</span>
        </div>
      )}
    </>
  );
  const klasse = `w-full py-[11px] text-start ${letzte ? "" : "border-b border-line"}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={klasse}>
      {inhalt}
    </button>
  ) : (
    <div className={klasse}>{inhalt}</div>
  );
}
