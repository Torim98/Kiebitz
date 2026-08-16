/**
 * Free oder Plus · auf einen Blick.
 *
 * Kiebitz sperrt Funktionen nicht weg, sondern zeigt sie gesperrt. Damit ist
 * aber nicht mehr selbstverständlich, in welchem Modell man gerade steckt: Wer
 * eine Vorschau sieht, weiß nicht, ob sie gesperrt ist oder er nur nichts
 * eingetragen hat. Dieses Abzeichen beantwortet die Frage dort, wo sie
 * entsteht · in der Hülle, auf jeder Seite.
 *
 * Solange der Zustand noch geladen wird, steht hier nichts. „Free" anzuzeigen
 * und eine Sekunde später auf „Plus" zu springen wäre schlimmer als ein
 * Abzeichen, das einen Moment später erscheint · gerade für jemanden, der
 * gerade bezahlt hat.
 */
import { Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { usePlus } from "../lib/plus/usePlus";

export default function PlanBadge({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const plus = usePlus();

  if (plus.loading) return null;

  // In der App-Leiste ist der Platz knapp · dort steht nur Free oder Plus. Wie
  // lange der Testzeitraum noch läuft, steht ohnehin in den Einstellungen.
  const label = plus.isPlus
    ? !compact && plus.isTrial
      ? t("plus.planTrial")
      : t("plus.planPlus")
    : t("plus.planFree");
  const full = plus.isPlus && plus.isTrial ? t("plus.planTrial") : label;

  return (
    <span
      title={full}
      aria-label={t("plus.planLabel", { p: full })}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none ${
        plus.isPlus
          ? "border-accent-dim bg-accent-soft text-accent"
          : "border-line2 text-ink3"
      }`}
    >
      {plus.isPlus && <Sparkles size={9} aria-hidden="true" />}
      {label}
    </span>
  );
}
