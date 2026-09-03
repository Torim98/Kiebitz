/**
 * Analyse im Diagramm-Modus · die kommentierte Partie.
 *
 * Hier zahlt sich der Modus am deutlichsten aus. Die Zugliste von heute ist
 * eine umbrechende Reihe von Schaltflächen; im Turnierbuch ist eine
 * kommentierte Partie Fließsatz, und die Anmerkungen stehen eingerückt
 * zwischen den Zügen, wo sie hingehören.
 *
 * Gedruckt oder gespielt: Das Brett der Analyse ist kein Abdruck, sondern ein
 * Instrument, an dem man zieht — es trägt die Brettfarben des Themas, wie
 * heute. Deshalb kommt es als fertiges Stück von der Seite herein: Zug,
 * Hervorhebung, Drehung und Klänge hängen dort, und ein zweites Brett wäre
 * eine zweite Bedienung derselben Sache.
 *
 * Alle Anmerkungen bleiben stehen, auch bei langen Partien. Die
 * Auto-Annotation vergibt nur für Ungenauigkeit, Fehler und Patzer einen
 * Kommentar; das sind wenige, und eine Partie, in der es viele sind, ist genau
 * die, bei der man sie alle sehen will.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import {
  Ergebniskasten,
  Farbfeld,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { translateSan } from "../../lib/notation";
import { de, deInt } from "../../lib/format";
import "../../components/blatt/blatt.css";

/** Ein Zug, wie ihn der Fließsatz braucht. */
export interface SatzZug {
  san: string;
  /** Kürzel der Bewertung ("?!", "?", "??", "!!") · leer heißt: unauffällig. */
  nag?: string;
  /** Farbe des Kürzels · schon als Token, nicht als Wert. */
  farbe?: string;
  /** Die Anmerkung zu diesem Zug, falls die Analyse eine hat. */
  kommentar?: string | null;
}

export interface BilanzZeile {
  name: string;
  zahl: number;
  farbe: string;
}

export interface AnalysisBlattProps {
  mobile: boolean;
  /** Kopfzeile rechts · Partienummer und Engine, von der Seite gesetzt. */
  kopfRechts: ReactNode;
  felder: Feld[];
  ergebnis: string;
  /** Namen über und unter dem Brett · oben der Gegner, unten die eigene Farbe. */
  oben: { name: string; elo: number; farbe: "white" | "black" };
  unten: { name: string; elo: number; farbe: "white" | "black" };
  /**
   * Brett und Bewertungsbalken · ein Instrument, kein Abdruck (siehe oben).
   *
   * Sie kommen als fertiges Stück von der Seite: Der Balken nimmt dort schon
   * die Feldfarben des Bretts und dreht sich mit ihm, und ein zweiter Aufbau
   * hier wäre dieselbe Bedienung ein zweites Mal.
   */
  brett: ReactNode;
  zuege: SatzZug[];
  /** Der gezeigte Halbzug · die Marke in der Kurve und im Satz. */
  ply: number;
  onPly: (ply: number) => void;
  /** Bewertung je Halbzug in Bauerneinheiten · so lang wie analysiert wurde. */
  kurve: number[];
  /** Bewertung an der gezeigten Stellung, in Bauerneinheiten. */
  bewertung: number;
  bilanz: BilanzZeile[];
  acpl: { white: number; black: number };
  genauigkeit: number | null;
}

/**
 * Die Bewertungskurve als Haarlinienzeichnung.
 *
 * Kein Diagrammwerkzeug: eine Linie, eine Nulllinie, eine gestrichelte Marke
 * am gezeigten Halbzug. Alles über Tokens.
 */
function Kurve({ werte, ply, hoehe = 76 }: { werte: number[]; ply: number; hoehe?: number }) {
  if (werte.length < 2) return null;
  const breite = 470;
  const max = 6;
  const x = (i: number) => (i / (werte.length - 1)) * breite;
  const y = (cp: number) => hoehe / 2 - (Math.max(-max, Math.min(max, cp)) / max) * (hoehe / 2 - 3);
  const punkte = werte.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(" ");
  const flaeche = `${x(0)},${hoehe / 2} ${punkte} ${x(werte.length - 1)},${hoehe / 2}`;
  const cx = x(Math.max(0, Math.min(werte.length - 1, ply - 1)));
  return (
    <svg
      viewBox={`0 0 ${breite} ${hoehe}`}
      width="100%"
      height={hoehe}
      className="block overflow-visible"
      aria-hidden="true"
    >
      <polygon points={flaeche} fill="var(--color-win)" opacity="0.13" />
      <line x1="0" y1={hoehe / 2} x2={breite} y2={hoehe / 2} stroke="var(--color-line2)" strokeWidth="1" />
      <polyline points={punkte} fill="none" stroke="var(--color-ink)" strokeWidth="1.25" strokeLinejoin="round" />
      <line x1={cx} y1="0" x2={cx} y2={hoehe} stroke="var(--color-ink)" strokeWidth="1" strokeDasharray="2 3" />
    </svg>
  );
}

export default function AnalysisBlatt({
  mobile,
  kopfRechts,
  felder,
  ergebnis,
  oben,
  unten,
  brett,
  zuege,
  ply,
  onPly,
  kurve,
  bewertung,
  bilanz,
  acpl,
  genauigkeit,
}: AnalysisBlattProps) {
  const { t, locale } = useI18n();

  /**
   * Der Fließsatz der Partie.
   *
   * Züge laufen durch, bis einer eine Anmerkung trägt; dann bricht der Satz,
   * die Anmerkung steht eingerückt darunter, und der nächste Satz beginnt.
   * Genau so steht eine kommentierte Partie im Turnierbuch.
   */
  const abschnitte: { zuege: { zug: SatzZug; index: number }[]; anmerkung: { zug: SatzZug; index: number } | null }[] =
    [];
  let laufend: { zug: SatzZug; index: number }[] = [];
  zuege.forEach((zug, index) => {
    laufend.push({ zug, index });
    if (zug.kommentar) {
      abschnitte.push({ zuege: laufend, anmerkung: { zug, index } });
      laufend = [];
    }
  });
  if (laufend.length > 0) abschnitte.push({ zuege: laufend, anmerkung: null });

  const zugLabel = (zug: SatzZug, index: number) =>
    `${index % 2 === 0 ? `${index / 2 + 1}.` : ""}${translateSan(zug.san, locale)}`;

  const satz = (stuecke: { zug: SatzZug; index: number }[]) => (
    <div className="buch notation text-[15px] leading-[1.6] text-ink" style={{ fontVariantNumeric: "lining-nums" }}>
      {stuecke.map(({ zug, index }) => (
        <button
          key={index}
          type="button"
          onClick={() => onPly(index + 1)}
          className={`me-1.5 ${
            ply === index + 1 ? "bg-panel3 font-semibold text-ink" : "hover:text-accent"
          }`}
        >
          {zugLabel(zug, index)}
          {zug.nag && <span style={{ color: zug.farbe }}>{zug.nag}</span>}
        </button>
      ))}
    </div>
  );

  const partietext = (
    <div>
      <Rubrik>{t("blatt.theGame")}</Rubrik>
      {abschnitte.map((abschnitt, i) => (
        <div key={i} className={i === 0 ? "mt-3" : "mt-2.5"}>
          {satz(abschnitt.zuege)}
          {abschnitt.anmerkung && (
            <div
              className="mt-[7px] border-s-2 ps-[18px]"
              style={{ borderColor: abschnitt.anmerkung.zug.farbe ?? "var(--color-line2)" }}
            >
              <span
                className="buch notation text-[13px] font-semibold"
                style={{ color: abschnitt.anmerkung.zug.farbe }}
              >
                {zugLabel(abschnitt.anmerkung.zug, abschnitt.anmerkung.index)}
                {abschnitt.anmerkung.zug.nag}
              </span>{" "}
              <span className="buch text-[13.5px] leading-[1.55] text-ink2">
                {abschnitt.anmerkung.zug.kommentar}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const auswertung = (
    <div>
      <Rubrik>{t("an.autoAnnotation")}</Rubrik>
      <div className="mt-2 grid grid-cols-2 gap-x-[26px]">
        {bilanz.map((zeile) => (
          <div key={zeile.name} className="flex items-baseline gap-2 border-b border-line py-[5px]">
            <span
              aria-hidden
              className="inline-block h-2 w-2 flex-none"
              style={{ background: zeile.farbe }}
            />
            <span className="flex-1 truncate text-[12.5px] text-ink2">{zeile.name}</span>
            <span className="blatt-zahl text-[13.5px] text-ink">{deInt(zeile.zahl)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-[22px] gap-y-1 text-[11.5px] text-ink3">
        <span>
          {t("an.acpl")}: <span className="blatt-zahl text-ink2">{t("common.white")} {deInt(acpl.white)}</span>
          {" · "}
          <span className="blatt-zahl text-ink2">{t("common.black")} {deInt(acpl.black)}</span>
        </span>
        {genauigkeit != null && (
          <span>
            {t("games.colAccuracy")} <span className="blatt-zahl text-ink2">{de(genauigkeit)} %</span>
          </span>
        )}
      </div>
    </div>
  );

  const spieler = (
    seite: { name: string; elo: number; farbe: "white" | "black" },
    unten_: boolean
  ) => (
    <div className={`flex items-center gap-[9px] ${unten_ ? "pt-[9px]" : "pb-[9px]"}`}>
      <Farbfeld farbe={seite.farbe} kante={11} />
      <span className="min-w-0 truncate text-[14px] text-ink">{seite.name}</span>
      {seite.elo > 0 && <span className="blatt-zahl text-[12px] text-ink3">{seite.elo}</span>}
    </div>
  );

  const steuerung = (
    <div className="mt-3 flex items-center border-y border-line">
      {[
        { icon: SkipBack, label: t("an.toStart"), to: 0 },
        { icon: ChevronLeft, label: t("an.prevMove"), to: Math.max(0, ply - 1) },
        { icon: ChevronRight, label: t("an.nextMove"), to: Math.min(zuege.length, ply + 1) },
        { icon: SkipForward, label: t("an.toEnd"), to: zuege.length },
      ].map(({ icon: Icon, label, to }, index) => (
        <button
          key={label}
          type="button"
          onClick={() => onPly(to)}
          aria-label={label}
          className={`flex h-11 flex-1 items-center justify-center text-ink2 hover:text-ink ${
            index ? "border-s border-line" : ""
          }`}
        >
          <Icon size={16} />
        </button>
      ))}
      <span className="blatt-zahl flex h-11 flex-[2] items-center justify-center border-s border-line text-[12.5px] text-ink3">
        {t("blatt.plyOf", { n: deInt(ply), total: deInt(zuege.length) })}
      </span>
    </div>
  );

  const brettSpalte = (
    <div className={mobile ? "flex flex-col" : "flex w-[470px] flex-none flex-col"}>
      {spieler(oben, false)}
      {brett}
      {spieler(unten, true)}
      {steuerung}
      {kurve.length > 1 && (
        <div className="mt-3.5">
          <div className="flex items-baseline justify-between">
            <Feldname>{t("blatt.evalCurve")}</Feldname>
            <span
              className="blatt-zahl text-[13px] font-medium"
              style={{ color: bewertung >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
            >
              {bewertung >= 0 ? "+" : "−"}
              {de(Math.abs(bewertung))}
            </span>
          </div>
          <div className="mt-[7px] border-y border-line py-1.5">
            <Kurve werte={kurve} ply={ply} hoehe={mobile ? 56 : 76} />
          </div>
          <div className="mt-1 flex justify-between text-[9.5px] text-ink3">
            <span className="blatt-feld">{t("ins.phase.opening")}</span>
            <span className="blatt-feld">{t("ins.phase.middlegame")}</span>
            <span className="blatt-zahl">{t("blatt.halfMoves", { n: deInt(zuege.length) })}</span>
          </div>
        </div>
      )}
    </div>
  );

  const kopf = (
    <>
      <Kolumnentitel links={t("blatt.analysisTitle")} rechts={kopfRechts} />
      <div className="mt-4 flex items-end">
        <div className="min-w-0 flex-1">
          <Formularkopf
            felder={mobile ? felder.slice(0, 2) : felder}
            spalten={mobile ? "1fr 1fr" : "0.95fr 1.3fr 1.35fr 1.4fr"}
          />
        </div>
        <div className={`flex-none border-s border-line ${mobile ? "w-[62px] ps-2.5" : "w-24 ps-3.5"}`}>
          <Feldname>{t("blatt.result")}</Feldname>
          <div className="mt-1.5">
            <Ergebniskasten hoehe={mobile ? 27 : 32} gross={mobile ? 13 : 15}>
              {ergebnis}
            </Ergebniskasten>
          </div>
        </div>
      </div>
    </>
  );

  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        {kopf}
        <div className="mt-3.5">{brettSpalte}</div>
        <div className="mt-4">{partietext}</div>
        <div className="mt-4">{auswertung}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-[1560px] flex-col px-10 pb-[22px] pt-6">
      {kopf}
      <div className="flex min-h-0 flex-1 gap-9 pt-5">
        {brettSpalte}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
          {partietext}
          {auswertung}
        </div>
      </div>
    </div>
  );
}
