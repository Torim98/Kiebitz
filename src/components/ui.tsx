import { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import type { Result, Source } from "../data/demo";
import { useT } from "../lib/i18n";
import { resultColor } from "../lib/util";
import { openExternal } from "../lib/ext";

export function Card({
  title,
  action,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-medium text-ink2">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
        active
          ? "border-accent-dim bg-accent-soft text-accent"
          : "border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-line bg-panel2 px-2 py-0.5 text-[11.5px] text-ink2">
      {children}
    </span>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  const t = useT();
  const label =
    result === "win" ? t("common.win") : result === "loss" ? t("common.loss") : t("common.draw");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: resultColor[result] }}>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: resultColor[result] }}
      />
      {label}
    </span>
  );
}

export function SourceBadge({ source }: { source: Source }) {
  const cc = source === "chess.com";
  const manual = source === "manual";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: cc ? "var(--color-cc)" : manual ? "var(--color-gold)" : "var(--color-blue)",
        background: cc ? "rgba(129,182,76,0.12)" : manual ? "rgba(210,170,70,0.12)" : "rgba(57,135,229,0.12)",
      }}
    >
      {cc ? "chess.com" : manual ? "PGN" : "lichess"}
    </span>
  );
}

export function ExtLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className="inline-flex items-center gap-1 text-[12.5px] text-ink3 transition-colors hover:text-accent"
    >
      {label}
      <ExternalLink size={13} />
    </a>
  );
}

export function Button({
  children,
  primary = false,
  onClick,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors [&>svg]:shrink-0 ${
        primary
          ? "bg-accent text-[#06251a] hover:bg-[#2bd49b]"
          : "border border-line bg-panel2 text-ink2 hover:border-line2 hover:text-ink"
      } disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
    >
      {children}
    </button>
  );
}

export function Spark({ data, color = "var(--color-accent)", width = 96, height = 30 }: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (width - 8) + 4;
      const y = height - 4 - ((v - min) / range) * (height - 8);
      return `${x},${y}`;
    })
    .join(" ");
  const last = pts.split(" ").pop()!.split(",");
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} stroke="var(--color-panel)" strokeWidth="2" />
    </svg>
  );
}
