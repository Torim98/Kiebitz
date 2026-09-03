/**
 * Partien im Diagramm-Modus · das Partienverzeichnis.
 *
 * Aus der Tabelle wird das Register hinten im Turnierbuch: laufende Nummer
 * links, Haarlinie unter jeder Zeile, Ergebnis als Punkt statt als Pille,
 * gespielte Farbe als Feld statt als eigener Wortspalte.
 *
 * Die größere Änderung steht darüber: Die Filter sind keine Pillenreihe mehr,
 * sondern ausgefüllte Formularfelder. Damit liest man den Filterzustand als
 * Satz und nicht als Sammlung angeschalteter Knöpfe.
 *
 * Rechts der Eintrag zur gewählten Partie: Schlussstellung als Diagramm — hier
 * wird gelesen, nicht gezogen, also ein Abdruck — die Angaben als
 * Formularfelder, und die Notiz auf liniertem Grund. Das ist das einzige Feld
 * auf dem Blatt, in das man schreibt.
 */
import type { ReactNode } from "react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import { MarkenSchluessel, PartieZeile } from "../../components/blatt/PartieZeile";
import {
  Ergebniskasten,
  Feldname,
  Kolumnentitel,
  Rubrik,
  Weg,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { deInt } from "../../lib/format";
import type { UiGame } from "../../lib/gameUi";

/**
 * Ein Filter als ausgefülltes Formularfeld.
 *
 * Drei Arten: ein Feld, in das man schreibt (`onChange`), eines, das
 * weiterschaltet (`onClick`), und eines, das nur dasteht.
 */
export interface Filterfeld {
  label: string;
  /** Was drinsteht · leer heißt „alle", und dann steht die Linie blass. */
  wert: string;
  leer: boolean;
  breite?: number;
  /** Platzhalter des Schreibfeldes. */
  platzhalter?: string;
  onChange?: (value: string) => void;
  onClick?: () => void;
}

export interface GamesBlattProps {
  mobile: boolean;
  /** Bestand der Datenbank · null in der Web-Vorschau. */
  bestand: number | null;
  filter: Filterfeld[];
  treffer: number;
  /** Die Zeilen dieses Blattes und ihre laufenden Nummern. */
  zeilen: { game: UiGame; nummer: number | null }[];
  gewaehlt: UiGame | undefined;
  /** Schlussstellung der gewählten Partie · schon gerechnet. */
  fen: string;
  /** Die Bildunterschrift dazu, von der Seite gesetzt. */
  unterschrift: string[];
  /** Angaben zur gewählten Partie · Formularfelder unter dem Diagramm. */
  angaben: { label: string; wert: ReactNode }[];
  notiz: string;
  von: number;
  bis: number;
  blatt: number;
  blaetter: number;
  onZurueck: () => void;
  onWeiter: () => void;
  onWaehlen: (game: UiGame) => void;
  onAnalyse: () => void;
  onOriginal?: () => void;
}

export default function GamesBlatt({
  mobile,
  bestand,
  filter,
  treffer,
  zeilen,
  gewaehlt,
  fen,
  unterschrift,
  angaben,
  notiz,
  von,
  bis,
  blatt,
  blaetter,
  onZurueck,
  onWeiter,
  onWaehlen,
  onAnalyse,
  onOriginal,
}: GamesBlattProps) {
  const { t } = useI18n();

  const filterfelder = (
    <div className="flex min-w-0 flex-1 gap-6">
      {filter.map((feld) => {
        // Ein gefülltes Feld steht auf einer kräftigen Linie, ein leeres auf
        // einer blassen · so liest man den Filterzustand als Satz.
        const linie = `mt-1.5 block w-full min-h-11 truncate border-b pb-[5px] text-start text-[13.5px] ${
          feld.leer ? "border-line2 text-ink3" : "border-ink text-ink"
        }`;
        return (
          <div
            key={feld.label}
            className={feld.breite ? "flex-none" : "min-w-0 flex-1"}
            style={feld.breite ? { width: feld.breite } : undefined}
          >
            <Feldname>{feld.label}</Feldname>
            {feld.onChange ? (
              <input
                value={feld.wert}
                onChange={(event) => feld.onChange!(event.target.value)}
                placeholder={feld.platzhalter}
                aria-label={feld.label}
                className={`${linie} bg-transparent placeholder:text-ink3 focus:outline-none`}
              />
            ) : feld.onClick ? (
              <button type="button" onClick={feld.onClick} className={linie}>
                {feld.wert}
              </button>
            ) : (
              <span className={linie}>{feld.wert}</span>
            )}
          </div>
        );
      })}
    </div>
  );

  const kopfzeile = (
    <div className="flex items-center gap-[9px] border-b border-ink pb-[5px]">
      <span className="blatt-feld w-8 flex-none text-ink3">{t("blatt.no")}</span>
      <span className="blatt-feld w-[76px] flex-none text-ink3">{t("games.colDate")}</span>
      <span className="blatt-feld w-2.5 flex-none" />
      <span className="blatt-feld w-[168px] flex-none text-ink3">{t("games.colOpponent")}</span>
      <span className="blatt-feld min-w-0 flex-1 text-ink3">{t("games.colOpening")}</span>
      <span className="blatt-feld w-[34px] flex-none text-ink3">ECO</span>
      <span className="blatt-feld w-[18px] flex-none text-center text-ink3">{t("blatt.points")}</span>
      <span className="blatt-feld w-[52px] flex-none text-end text-ink3">
        {t("blatt.accuracyShort")}
      </span>
      <span className="w-2.5 flex-none" />
    </div>
  );

  const liste = (
    <div>
      {!mobile && kopfzeile}
      {zeilen.map(({ game, nummer }) => (
        <div key={game.id} className="flex items-center gap-[9px]">
          {!mobile && (
            <span className="blatt-zahl w-8 flex-none text-[11px] text-ink3">{nummer ?? ""}</span>
          )}
          <span className="min-w-0 flex-1">
            <PartieZeile
              game={game}
              mobile={mobile}
              aktiv={gewaehlt?.id === game.id}
              notiz={Boolean(game.note)}
              offen={!game.analyzed}
              onClick={() => onWaehlen(game)}
            />
          </span>
        </div>
      ))}
      <MarkenSchluessel notiz={t("blatt.markNote")} offen={t("blatt.markOpen")} />
    </div>
  );

  const blaettern = (
    <div className="mt-3.5 flex items-center justify-between border-t border-line pt-2.5">
      <span className="blatt-zahl text-[11.5px] text-ink3">
        {t("games.rangeInfo", { from: deInt(von), to: deInt(bis), total: deInt(treffer) })}
      </span>
      <span className="flex items-center gap-4 text-[12.5px]">
        <button
          type="button"
          onClick={onZurueck}
          disabled={blatt <= 1}
          className="min-h-11 text-ink2 disabled:text-ink3"
        >
          ← {t("games.prev")}
        </button>
        <span className="blatt-zahl border-b border-ink px-1.5 pb-0.5 text-ink">
          {t("blatt.sheetOf", { n: deInt(blatt), total: deInt(blaetter) })}
        </span>
        <button
          type="button"
          onClick={onWeiter}
          disabled={blatt >= blaetter}
          className="min-h-11 text-accent disabled:text-ink3"
        >
          {t("games.next")} →
        </button>
      </span>
    </div>
  );

  const eintrag = gewaehlt && (
    <div className="flex flex-col">
      <Rubrik weg={t("games.openAnalysis")} onWeg={onAnalyse}>
        {t("blatt.theEntry")}
      </Rubrik>
      <div className="mt-3.5">
        <Diagramm fen={fen} size={mobile ? undefined : 262} gutter={13} />
        <Bildunterschrift
          nummer={unterschrift[0]}
          zeilen={unterschrift.slice(1)}
          breite={mobile ? undefined : 262}
          gutter={13}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-[18px]">
        {angaben.map((angabe) => (
          <div key={angabe.label} className="border-b border-line py-[5px]">
            <Feldname>{angabe.label}</Feldname>
            <div className="mt-[3px] truncate text-[12.5px] text-ink">{angabe.wert}</div>
          </div>
        ))}
      </div>
      <div className="mt-3.5">
        <Feldname>{t("games.notes")}</Feldname>
        {/* Linierter Grund · das eine Feld auf dem Blatt, in das man schreibt.
            Die Linien kommen aus dem Token, nicht aus einer Farbe. */}
        <div
          className="buch mt-1.5 pb-px text-[14px] leading-[1.85] text-ink2"
          style={{
            background:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 24px, var(--color-line) 24px, var(--color-line) 25px)",
          }}
        >
          {notiz ? `„${notiz}“` : <span className="text-ink3">{t("blatt.noRemark")}</span>}
        </div>
      </div>
      {onOriginal && (
        <div className="mt-3 flex gap-[18px]">
          <Weg onClick={onOriginal}>{t("games.original")}</Weg>
        </div>
      )}
    </div>
  );

  const kopf = (
    <Kolumnentitel
      links={t("blatt.gamesTitle")}
      rechts={bestand != null ? t("app.dbCount", { n: deInt(bestand) }) : undefined}
    />
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3 flex flex-col gap-3">{filterfelder}</div>
        <div className="mt-4">
          <Rubrik>{t("games.rangeInfo", { from: deInt(von), to: deInt(bis), total: deInt(treffer) })}</Rubrik>
          {liste}
        </div>
        {blaettern}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="mt-4 flex items-end">
        {filterfelder}
        <div className="w-24 flex-none border-s border-line ps-4">
          <Feldname>{t("blatt.hits")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten>{deInt(treffer)}</Ergebniskasten>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-9 pt-[22px]">
        <div className="flex min-w-0 flex-1 flex-col">
          {liste}
          <div className="flex-1" />
          {blaettern}
        </div>
        <div className="w-[304px] flex-none">{eintrag}</div>
      </div>
    </div>
  );
}
