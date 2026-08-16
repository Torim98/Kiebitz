/**
 * Free oder Plus · auf einen Blick.
 *
 * Kiebitz sperrt Funktionen nicht weg, sondern zeigt sie gesperrt. Damit ist
 * aber nicht mehr selbstverständlich, in welchem Modell man gerade steckt: Wer
 * eine Vorschau sieht, weiß nicht, ob sie gesperrt ist oder er nur nichts
 * eingetragen hat. Dieses Abzeichen beantwortet die Frage dort, wo sie
 * entsteht · in der Hülle, auf jeder Seite.
 *
 * Es nennt nur das Modell, nie den Testzeitraum: Wer testet, hat Plus, und wie
 * lange noch, steht in den Einstellungen. Ein „Plus · Test" wäre in der Leiste
 * ein zweites, längeres Wort neben einem kurzen · und erinnert bei jedem Blick
 * an ein Ablaufdatum, das hier niemand ändern kann.
 *
 * Solange der Zustand noch geladen wird, steht hier nichts. „Free" anzuzeigen
 * und eine Sekunde später auf „Plus" zu springen wäre schlimmer als ein
 * Abzeichen, das einen Moment später erscheint · gerade für jemanden, der
 * gerade bezahlt hat.
 */
import { Sparkles } from "lucide-react";
import { useT } from "../lib/i18n";
import { usePlus } from "../lib/plus/usePlus";

export default function PlanBadge() {
  const t = useT();
  const plus = usePlus();

  if (plus.loading) return null;

  const label = plus.isPlus ? t("plus.planPlus") : t("plus.planFree");

  // Feste Höhe statt senkrechter Polsterung: `py-0.5` ergab bei 10,5 px Schrift
  // eine Pille von 16,5 px. Die geht in keiner üblichen Bildschirmskalierung
  // glatt auf, sodass Rahmen und Schrift gegeneinander gerundet werden · 16 px
  // ergeben bei 100, 125 und 150 Prozent ganze Bildpunkte.
  //
  // Waagerecht steht die Schrift nicht allein in der Pille: Links sitzt das
  // Symbol und bringt dort eigenes Gewicht mit. Gleiche Polsterung auf beiden
  // Seiten ließe die Beschriftung deshalb nach rechts gedrängt wirken; die
  // schmalere linke Seite gleicht das aus.
  return (
    <span
      title={label}
      aria-label={t("plus.planLabel", { p: label })}
      className={`inline-flex h-4 shrink-0 items-center gap-1 rounded-full border text-[10.5px] font-medium leading-none ${
        plus.isPlus
          ? "border-accent-dim bg-accent-soft pl-1.5 pr-2 text-accent"
          : "border-line2 px-2 text-ink3"
      }`}
    >
      {plus.isPlus && <Sparkles size={9} aria-hidden="true" />}
      {label}
    </span>
  );
}
