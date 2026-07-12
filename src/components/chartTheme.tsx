import type { TooltipProps } from "recharts";

export const chart = {
  grid: "#2c2c2a",
  axis: "#3a3a37",
  tick: { fill: "#8b8a82", fontSize: 11.5 },
  cc: "#81b64c",
  li: "#3987e5",
  win: "#22c08a",
  draw: "#6f6e66",
  loss: "#e66767",
  inaccuracy: "#d9a028",
  mistake: "#e08a3c",
  blunder: "#e66767",
  accent: "#22c08a",
};

export function DarkTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 shadow-xl">
      {label != null && <div className="mb-1 text-[11.5px] text-ink3">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-[12.5px] text-ink">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink2">{p.name}:</span>
          <span className="font-medium">{typeof p.value === "number" ? p.value.toLocaleString("de-DE") : p.value}</span>
        </div>
      ))}
    </div>
  );
}
