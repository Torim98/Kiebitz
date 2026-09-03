/**
 * Eine Partie als Zeile eines Registers — nicht als Karte.
 *
 * Am Rechner die Zeile aus dem Turnierbuch: laufende Angaben nebeneinander,
 * Haarlinie darunter, Ergebnis als Punkt statt als Pille, gespielte Farbe als
 * Feld statt als eigener Wortspalte.
 *
 * Auf dem Telefon wird daraus ein zweizeiliger Eintrag. Die neunspaltige
 * Tabelle ließe sich dort nur quer scrollend lesen, und ein Blatt, das seitlich
 * wegläuft, ist kein Blatt mehr.
 *
 * Zwei Marken am Zeilenende ersetzen die Tag-Spalte: gefülltes Quadrat = Notiz
 * vorhanden, leeres = noch ohne Analyse. Der Schlüssel dazu steht unter der
 * Liste, wie in jedem Band.
 */
import type { UiGame } from "../../lib/gameUi";
import { de } from "../../lib/format";
import { Farbfeld, Punkt } from "./Satz";
import "./blatt.css";

export interface PartieZeileProps {
  game: UiGame;
  mobile: boolean;
  /** Der laufende Eintrag bekommt die Marke am Bund, wie im Register. */
  aktiv?: boolean;
  /** Gefülltes Quadrat · zu dieser Partie steht eine Notiz. */
  notiz?: boolean;
  /** Leeres Quadrat · diese Partie ist noch ohne Analyse. */
  offen?: boolean;
  onClick: () => void;
}

export function PartieZeile({
  game,
  mobile,
  aktiv = false,
  notiz = false,
  offen = false,
  onClick,
}: PartieZeileProps) {
  const marke = notiz ? (
    <span aria-hidden className="inline-block h-[7px] w-[7px] bg-ink" />
  ) : offen ? (
    <span aria-hidden className="inline-block h-[7px] w-[7px] border border-line2" />
  ) : null;

  if (mobile) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="relative flex min-h-14 w-full items-center gap-2.5 border-b border-line text-start"
      >
        {aktiv && <span aria-hidden className="absolute inset-y-2 -start-3.5 w-[3px] bg-ink" />}
        <Farbfeld farbe={game.color} kante={9} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{game.opponent}</span>
            <span className="blatt-zahl text-[11px] text-ink3">{game.oppElo}</span>
          </span>
          <span className="buch block truncate text-[13px] italic text-ink2">{game.opening}</span>
        </span>
        <span className="flex flex-none flex-col items-end gap-0.5">
          <span className="blatt-zahl text-[15px] font-medium">
            <Punkt ergebnis={game.result} />
          </span>
          <span className="blatt-zahl text-[10.5px] text-ink3">{game.date}</span>
        </span>
        <span className="flex w-2.5 flex-none justify-center">{marke}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-h-11 w-full items-center gap-[14px] border-b border-line text-start text-[12.5px]"
    >
      {aktiv && <span aria-hidden className="absolute inset-y-1.5 -start-3.5 w-[3px] bg-ink" />}
      {/* Der Entwurf setzt hier „11.07." · die App schreibt das Datum in der
          Form der Sprache, und die ist länger. Lieber die Spalte breiter als
          das Datum beschnitten. */}
      <span className="blatt-zahl w-[76px] flex-none whitespace-nowrap text-ink3">{game.date}</span>
      <Farbfeld farbe={game.color} />
      <span className="w-[168px] flex-none truncate text-ink">
        {game.opponent} <span className="blatt-zahl text-ink3">({game.oppElo})</span>
      </span>
      <span className="buch min-w-0 flex-1 truncate text-[13.5px] italic text-ink2">
        {game.opening}
      </span>
      <span className="blatt-zahl w-[34px] flex-none text-[11.5px] text-ink3">{game.eco}</span>
      <span className="blatt-zahl w-[18px] flex-none text-center">
        <Punkt ergebnis={game.result} />
      </span>
      <span className="blatt-zahl w-[52px] flex-none text-end text-ink2">
        {game.accuracy != null ? `${de(game.accuracy)} %` : "—"}
      </span>
      <span className="flex w-2.5 flex-none justify-center">{marke}</span>
    </button>
  );
}

/** Der Schlüssel zu den Marken · steht unter der Liste, wie in jedem Band. */
export function MarkenSchluessel({ notiz, offen }: { notiz: string; offen: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-[10.5px] text-ink3">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] bg-ink" />
        {notiz}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] border border-line2" />
        {offen}
      </span>
    </div>
  );
}
