/**
 * Farben und Tooltip der Diagramme.
 *
 * Auch hier stehen keine Farbwerte, sondern Tokens: Recharts reicht `stroke`
 * und `fill` als SVG-Präsentationsattribute durch, und die behandelt der
 * Browser als CSS-Eigenschaften · `var()` trägt darin genauso wie in einer
 * Klasse. Die Diagramme folgen dem Thema deshalb ohne Zutun und ohne ein
 * Neuzeichnen von Hand.
 */
import type { TooltipProps } from "recharts";

export const chart = {
  grid: "var(--color-line)",
  axis: "var(--color-line2)",
  tick: { fill: "var(--color-ink3)", fontSize: 11.5 },
  cc: "var(--color-cc)",
  li: "var(--color-blue)",
  win: "var(--color-win)",
  draw: "var(--color-draw)",
  loss: "var(--color-loss)",
  inaccuracy: "var(--color-gold)",
  mistake: "var(--color-warn)",
  blunder: "var(--color-loss)",
  accent: "var(--color-accent)",
  gold: "var(--color-gold)",
  violet: "var(--color-violet)",
};

/**
 * Hover-Fläche der Balkendiagramme. Recharts hebt die Spalte sonst mit einem
 * hellen Grau hervor, das im dunklen Layout wie ein Fehler aussieht.
 */
export const barCursor = {
  fill: "var(--color-accent)",
  fillOpacity: 0.1,
  radius: 6,
} as const;

/**
 * Tooltip der Diagramme · liegt auf Panel-Farben und folgt dem Thema damit
 * ohne Zutun.
 */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
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
