/**
 * Der Ratingverlauf des Starts · bewusst als eigene, nachgeladene Datei.
 *
 * Recharts ist mit Abstand die größte Abhängigkeit der Oberfläche. Stünde sie
 * im Startbündel, müsste jeder Start erst rund ein Drittel Megabyte
 * Diagrammcode holen, bevor überhaupt etwas zu sehen ist · für ein Bild, das
 * unter den Kennzahlen steht und beim ersten Blick oft gar nicht gebraucht
 * wird. Der Start zeigt deshalb zuerst seine Karten und Partien und schiebt
 * das Diagramm nach, sobald es da ist (siehe Dashboard.tsx).
 *
 * Die Höhe steht schon vorher fest: Der Platzhalter im Dashboard ist genauso
 * hoch wie das fertige Bild, damit beim Nachladen nichts springt.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chart,
  chartSurface,
  RATING_CHART_HEIGHT,
  type ChartTooltipProps,
} from "./chartTheme";
import { deInt } from "../lib/format";
import type { HistoryPoint, RatingHistorySeries } from "../lib/stats";

/**
 * Tooltip des Ratingverlaufs. Die Linie hat einen Stützpunkt je Tag, also
 * steht im Kopf auch der Tag und darunter der an diesem Tag gültige Stand ·
 * ein Monatsname über einer Tageszahl wäre eine Auskunft über den falschen
 * Zeitraum.
 */
function DayTooltip({
  active,
  payload,
  series,
  colors,
}: ChartTooltipProps & {
  series: RatingHistorySeries[];
  colors: Record<string, string>;
}) {
  const point = payload?.[0]?.payload as HistoryPoint | undefined;
  if (!active || !point) return null;
  const rows = series.filter((s) => point[s.key] != null);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line2 bg-panel3 px-3 py-2 shadow-xl">
      <div className="mb-1 text-[11.5px] text-ink3">{point.dayLabel || point.monthLabel}</div>
      {rows.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-[12.5px] text-ink">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: colors[s.id] ?? chart.draw }}
          />
          <span className="text-ink2">{s.label}:</span>
          <span className="font-medium">{deInt(point[s.key] as number)}</span>
        </div>
      ))}
    </div>
  );
}

export default function RatingHistoryChart({
  history,
  series,
  colors,
  live,
}: {
  history: HistoryPoint[];
  series: RatingHistorySeries[];
  colors: Record<string, string>;
  /** Echte Partien statt Demo · nur dort ist die Skala frei. */
  live: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={RATING_CHART_HEIGHT}>
      <LineChart {...chartSurface} data={history} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        {/* Beschriftet ist nur der Monatserste; alle anderen Tage tragen
            einen leeren Namen und bleiben dadurch stumm.

            Die Achse liest den Namen aber *nicht* aus den Daten (kein
            `dataKey`), sondern bekommt ihn erst beim Beschriften. Der Grund
            ist der Tooltip: Mit `dataKey="month"` bildet Recharts seine
            Kategorien aus den Werten dieser Spalte · und die sind an rund
            neunzig von hundert Tagen derselbe leere Text. Alle diese Tage
            fallen dann auf dieselbe Kategorie, und die Zuordnung
            „Zeigerposition → Stützpunkt" landet immer beim *ersten* leeren
            Tag. Wer im September zeigt, liest den Stand vom zweiten April.

            Ohne `dataKey` nummeriert Recharts die Stützpunkte durch. Die
            Nummern sind eindeutig, die Zuordnung stimmt, und die Beschriftung
            holt sich der Formatierer über dieselbe Nummer aus den Daten. */}
        <XAxis
          tickFormatter={(index: number) => history[index]?.month ?? ""}
          tick={chart.tick}
          tickLine={false}
          axisLine={{ stroke: chart.axis }}
          interval={0}
        />
        <YAxis
          domain={live ? ["auto", "auto"] : [1340, 1560]}
          tick={chart.tick}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<DayTooltip series={series} colors={colors} />}
          cursor={{ stroke: chart.axis }}
        />
        {series.map((s) => (
          // Bewusst „linear": der Verlauf soll springen wie die Sparklines
          // der Karten, statt eine Kurve zu behaupten, die zwischen zwei
          // Partien niemand gespielt hat.
          <Line
            key={s.id}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={colors[s.id] ?? chart.draw}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
