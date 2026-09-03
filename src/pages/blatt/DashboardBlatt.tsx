/**
 * Das Blatt · der Start im Diagramm-Modus.
 *
 * Ein Satzspiegel, kein Kartenraster: Kolumnentitel, Formularkopf, in der
 * Mitte das gedruckte Diagramm, rechts die Anmerkung und die Tagesliste,
 * unten die Partien als Formularzeilen. Die vier Wertungen stehen als
 * Randnotiz — sie sind das Kleingedruckte, nicht die Überschrift.
 *
 * Die Komponente holt nichts. Sie bekommt genau das, was `Dashboard.tsx`
 * ohnehin schon geladen hat, und setzt es anders. Der Modus ist eine zweite
 * Darstellung derselben Daten.
 *
 * Auf dem Telefon gibt es die zweite Spalte nicht: Das Diagramm steht oben,
 * die Zahlen darunter, und die Reihenfolge sagt, was zuerst gebraucht wird.
 */
import type { ReactNode } from "react";
import { Bildunterschrift, Diagramm } from "../../components/blatt/Diagramm";
import {
  ErledigenZeile,
  Ergebniskasten,
  Feldname,
  Formularkopf,
  Kolumnentitel,
  Rubrik,
  Weg,
  Zitat,
  Zugfolge,
  type Feld,
} from "../../components/blatt/Satz";
import { useI18n } from "../../lib/i18n";
import { translateSan } from "../../lib/notation";
import { dateLocale, deInt } from "../../lib/format";
import { PartieZeile } from "../../components/blatt/PartieZeile";
import type { UiGame } from "../../lib/gameUi";
import type { DiagramSource } from "../../lib/blatt";

/** Ein Zug mit dem Urteil der Auto-Analyse, soweit es eines gibt. */
export interface BlattZug {
  san: string;
  /** „?!" · „?" · „??" — die drei Urteile, die die Analyse vergibt. */
  nag?: string;
}

/** Was im Diagramm des Tages steht · von Dashboard.tsx zusammengestellt. */
export interface Tagesdiagramm {
  quelle: DiagramSource;
  fen: string;
  orientation: "white" | "black";
  amZug: "white" | "black";
  /** Kopf des Formulars · Namen, Partie, Eröffnung. */
  felder: Feld[];
  /** Was im Kasten rechts steht ("1 : 0" oder ein Gedankenstrich). */
  ergebnis: string;
  /** Titelzeile und kursive Beizeile der Bildunterschrift. */
  zeilen: string[];
  /** Die Züge bis zur Stellung und die, die danach kamen. */
  davor?: BlattZug[];
  danach?: BlattZug[];
  /** Halbzüge vor `davor` · für die Zugnummern. */
  offset?: number;
  /** Eigene Notiz zur Partie, wenn eine da ist. */
  notiz?: string;
  onOeffnen?: () => void;
}

export interface Wertung {
  id: string;
  platform: string;
  tc: string;
  value: number | string;
  delta: number;
}

export interface DashboardBlattProps {
  mobile: boolean;
  /** Partien in der Datenbank · null in der Web-Vorschau. */
  bestand: number | null;
  diagramm: Tagesdiagramm | null;
  /** Die Quellen, die heute etwas anzubieten hätten · nur im Leerfall gesetzt. */
  angebot?: { repertoire: number; puzzles: number; endgame: boolean };
  wertungen: Wertung[];
  letzte: UiGame[];
  repDue: number;
  repNeben: string;
  unanalyzed: number;
  puzzles: { done: number; goal: number };
  onRepertoire: () => void;
  onAnalyse: () => void;
  onPuzzles: () => void;
  onAllePartien: () => void;
  onPartie: (game: UiGame) => void;
}

/** Zugfolge in der Notation der Oberflächensprache, mit den Urteilen daneben. */
function Zuege({
  zuege,
  offset,
  gross,
}: {
  zuege: readonly BlattZug[];
  offset: number;
  gross: number;
}) {
  const { locale } = useI18n();
  const teile: ReactNode[] = [];
  zuege.forEach((zug, index) => {
    const ply = offset + index;
    const nummer = ply % 2 === 0 ? `${ply / 2 + 1}.` : index === 0 ? `${(ply + 1) / 2}…` : "";
    teile.push(
      <span key={index}>
        {index > 0 && " "}
        {nummer}
        {translateSan(zug.san, locale)}
        {zug.nag && (
          <span style={{ color: zug.nag.includes("?") ? "var(--color-loss)" : "var(--color-win)" }}>
            {zug.nag}
          </span>
        )}
      </span>
    );
  });
  return <Zugfolge gross={gross}>{teile}</Zugfolge>;
}

export default function DashboardBlatt({
  mobile,
  bestand,
  diagramm,
  angebot,
  wertungen,
  letzte,
  repDue,
  repNeben,
  unanalyzed,
  puzzles,
  onRepertoire,
  onAnalyse,
  onPuzzles,
  onAllePartien,
  onPartie,
}: DashboardBlattProps) {
  const { t } = useI18n();
  const heute = new Date();

  const tagesliste = (
    <div>
      <Rubrik>{t("blatt.today")}</Rubrik>
      <ErledigenZeile
        zahl={deInt(repDue)}
        sache={t("dash.dueReviews")}
        neben={repNeben}
        weg={t("blatt.wayTrain")}
        onWeg={onRepertoire}
        erledigt={repDue === 0}
        hoehe={mobile ? 48 : 52}
      />
      <ErledigenZeile
        zahl={deInt(unanalyzed)}
        sache={t("dash.gamesWithoutAnalysis")}
        neben={t("dash.stockfishNative")}
        weg={t("blatt.wayStart")}
        onWeg={onAnalyse}
        erledigt={unanalyzed === 0}
        hoehe={mobile ? 48 : 52}
      />
      <ErledigenZeile
        zahl={deInt(puzzles.done)}
        zusatz={` / ${deInt(puzzles.goal)}`}
        sache={t("blatt.puzzlesToday")}
        neben={t("dash.puzzleGoal")}
        weg={t("blatt.waySolve")}
        onWeg={onPuzzles}
        erledigt={puzzles.done >= puzzles.goal}
        letzte
        hoehe={mobile ? 48 : 52}
      />
    </div>
  );

  const anmerkung = diagramm && (
    <div>
      <Rubrik>{t("blatt.theNote")}</Rubrik>
      {diagramm.davor && diagramm.davor.length > 0 && (
        <div className="mt-[11px]">
          <Feldname>{t("blatt.upToDiagram")}</Feldname>
          <div className="mt-[3px]">
            <Zuege zuege={diagramm.davor} offset={diagramm.offset ?? 0} gross={14} />
          </div>
        </div>
      )}
      {diagramm.danach && diagramm.danach.length > 0 && (
        <div className="mt-[11px]">
          <Feldname>{t("blatt.thenFollowed")}</Feldname>
          <div className="mt-[3px]">
            <Zuege
              zuege={diagramm.danach}
              offset={(diagramm.offset ?? 0) + (diagramm.davor?.length ?? 0)}
              gross={17}
            />
          </div>
        </div>
      )}
      {diagramm.notiz && (
        <div className="mt-[13px]">
          <Zitat quelle={t("blatt.ownNote")}>{`„${diagramm.notiz}“`}</Zitat>
        </div>
      )}
      {diagramm.onOeffnen && (
        <div className="mt-2 flex gap-5">
          <Weg onClick={diagramm.onOeffnen}>{t("blatt.openGame")}</Weg>
        </div>
      )}
    </div>
  );

  /**
   * Der Leerfall · ein Tag ohne neue Partie.
   *
   * Das Formular bleibt dasselbe Formular, es ist nur anders ausgefüllt: Die
   * Liste zeigt angehakt, aus welcher Quelle die Stellung nachgerückt ist.
   */
  const herkunft = angebot && (
    <div>
      <Rubrik>{t("blatt.whereFrom")}</Rubrik>
      <div className="mt-[11px] border-t border-line">
        {(
          [
            ["game", t("blatt.srcGame"), t("blatt.srcGameNone")],
            [
              "repertoire",
              t("blatt.srcRepertoire"),
              angebot.repertoire > 0
                ? t("blatt.srcRepertoireDue", { n: deInt(angebot.repertoire) })
                : t("blatt.srcNothing"),
            ],
            [
              "puzzle",
              t("blatt.srcPuzzle"),
              angebot.puzzles > 0
                ? t("blatt.srcPuzzleLeft", { n: deInt(angebot.puzzles) })
                : t("blatt.srcNothing"),
            ],
            [
              "endgame",
              t("blatt.srcEndgame"),
              angebot.endgame ? t("blatt.srcEndgameOpen") : t("blatt.srcNothing"),
            ],
          ] as const
        ).map(([id, was, stand]) => {
          const aktiv = diagramm?.quelle === id;
          return (
            <div key={id} className="flex h-[34px] items-center gap-[11px] border-b border-line">
              <span
                aria-hidden
                className={`inline-flex h-[15px] w-[15px] flex-none items-center justify-center border text-ink ${
                  aktiv ? "border-ink" : "border-line2"
                }`}
              >
                {aktiv && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span
                className={`w-[150px] flex-none text-[13px] ${aktiv ? "text-ink" : "text-ink3"}`}
              >
                {was}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink3">{stand}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const wertungenBlock = wertungen.length > 0 && (
    <div>
      <Rubrik>{t("blatt.ratings")}</Rubrik>
      <div className="mt-0.5 grid gap-x-[26px] min-[900px]:grid-cols-2">
        {wertungen.map((r) => (
          <div key={r.id} className="flex items-baseline gap-2 border-b border-line py-[5px]">
            <span
              className="blatt-feld min-w-[60px]"
              style={{
                color: r.platform === "chess.com" ? "var(--color-cc)" : "var(--color-blue)",
              }}
            >
              {r.platform}
            </span>
            <span className="flex-1 truncate text-[11.5px] text-ink3">{r.tc}</span>
            <span className="blatt-zahl text-[14px] text-ink">{r.value}</span>
            <span
              className="blatt-zahl min-w-[30px] text-end text-[11.5px]"
              style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
            >
              {r.delta >= 0 ? "+" : "−"}
              {Math.abs(r.delta)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px] text-ink3">{t("blatt.change30")}</div>
    </div>
  );

  const partienZeilen = (
    <div>
      {letzte.map((g) => (
        <PartieZeile
          key={g.id}
          game={g}
          mobile={mobile}
          notiz={Boolean(g.note)}
          offen={!g.analyzed}
          onClick={() => onPartie(g)}
        />
      ))}
    </div>
  );

  const kopfDatum = heute.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const kurzDatum = heute.toLocaleDateString(dateLocale(), {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });

  const diagrammBlock = diagramm && (
    <div className="flex-none">
      <Diagramm
        fen={diagramm.fen}
        size={mobile ? undefined : 420}
        gutter={mobile ? 13 : 15}
        orientation={diagramm.orientation}
      />
      <Bildunterschrift
        nummer={t("blatt.diagram", { n: "1" })}
        zeilen={diagramm.zeilen}
        amZug={{
          farbe: diagramm.amZug,
          text: diagramm.amZug === "white" ? t("sh.whiteToMove") : t("sh.blackToMove"),
        }}
        breite={mobile ? undefined : 420}
        gutter={mobile ? 13 : 15}
      />
    </div>
  );

  // ── Telefon ────────────────────────────────────────────────────────────────
  if (mobile) {
    return (
      <div className="flex flex-col px-3.5 pb-6 pt-3">
        <Kolumnentitel links={t("blatt.dashTitleShort")} rechts={kurzDatum} />
        {diagramm && (
          <div className="mt-3">
            <Formularkopf felder={diagramm.felder.slice(0, 2)} spalten="1fr 1fr" />
          </div>
        )}
        {diagrammBlock && <div className="mt-3.5">{diagrammBlock}</div>}
        {diagramm?.danach && diagramm.danach.length > 0 && (
          <div className="mt-3">
            <Feldname>{t("blatt.thenFollowed")}</Feldname>
            <div className="mt-[3px]">
              <Zuege
                zuege={diagramm.danach}
                offset={(diagramm.offset ?? 0) + (diagramm.davor?.length ?? 0)}
                gross={15}
              />
            </div>
          </div>
        )}
        {herkunft && <div className="mt-4">{herkunft}</div>}
        <div className="mt-3">{tagesliste}</div>
        <div className="mt-4">
          <Rubrik weg={t("dash.showAll")} onWeg={onAllePartien}>
            {t("dash.recentGames")}
          </Rubrik>
          {partienZeilen}
        </div>
      </div>
    );
  }

  // ── Rechner ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex min-h-full max-w-[1200px] flex-col px-10 pb-[22px] pt-6">
      <Kolumnentitel
        links={t("blatt.dashTitle")}
        rechts={
          <>
            {kopfDatum}
            {bestand != null && (
              <>
                {" · "}
                {t("blatt.page", { n: deInt(bestand) })}
              </>
            )}
          </>
        }
      />

      {diagramm && (
        <div className="mt-4 flex items-end">
          <div className="min-w-0 flex-1">
            <Formularkopf felder={diagramm.felder} spalten="0.95fr 1.3fr 1.35fr 1.4fr" />
          </div>
          <div className="w-24 flex-none border-s border-line ps-3.5">
            <Feldname>{t("blatt.result")}</Feldname>
            <div className="mt-1.5">
              <Ergebniskasten>{diagramm.ergebnis}</Ergebniskasten>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-9 pt-[22px]">
        {diagrammBlock}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-6">
          {/* Kommt die Stellung nicht aus einer Partie, steht rechts, woher
              sie stattdessen kommt · der Kopf bleibt derselbe Kopf. */}
          {herkunft ?? anmerkung}
          {tagesliste}
          {wertungenBlock}
        </div>
      </div>

      <div className="pt-[18px]">
        <Rubrik weg={t("dash.showAll")} onWeg={onAllePartien}>
          {t("dash.recentGames")}
        </Rubrik>
        {partienZeilen}
      </div>
    </div>
  );
}
