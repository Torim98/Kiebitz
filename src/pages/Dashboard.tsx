import { lazy, Suspense, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpen, ChevronRight, Cpu, Puzzle } from "lucide-react";
import {
  featuredGame,
  games as demoGames,
  profile,
  ratings,
  ratingHistory,
  repertoireStats,
  puzzleStats,
} from "../data/demo";
import { useBackendInfo } from "../lib/backend";
import { LOCALE_TAGS, useI18n, type Locale } from "../lib/i18n";
import { translateSan } from "../lib/notation";
import { getGame, listGameSummaries, type GameRecord, type GameSummary } from "../lib/db";
import { gameAnalysis, type MoveEvalRow } from "../lib/analysis";
import { useDiagramMode } from "../lib/diagramMode";
import { chooseDiagramSource, criticalPly } from "../lib/blatt";
import { fenAfter, fenAfterUci } from "../lib/position";
import { repDue, type DueItem } from "../lib/repertoire";
import { nextPuzzle, type PuzzleOut } from "../lib/puzzles";
import { endgameStats } from "../lib/endgame";
import { drillText, ENDGAME_DRILLS, type EndgameDrill } from "../data/endgames";
import { getSettings } from "../lib/settings";
import { repStats, type RepStats } from "../lib/repertoire";
import { puzzleStats as fetchPuzzleStats, type PuzzleStats } from "../lib/puzzles";
import { buildDashboard, type HistoryPoint, type RatingHistorySeries } from "../lib/stats";
import type { GamesFilter, UiGame } from "../lib/gameUi";
import { Card, ExtLink, GameCard, ResultBadge, SourceBadge, Spark, Button } from "../components/ui";
import { useMobileShell } from "../components/MobileShell";
import { chart, RATING_CHART_HEIGHT } from "../components/chartTheme";
import { dateLocale, de, deInt } from "../lib/format";
import type { PageId } from "../App";

/**
 * Recharts kommt nach, nicht mit: Das Diagramm ist die einzige Stelle des
 * Starts, die es braucht, und der Rest der Seite steht ohne es sofort.
 */
const RatingHistoryChart = lazy(() => import("../components/RatingHistoryChart"));

/**
 * Das Blatt kommt nach, nicht mit.
 *
 * Es ist die zweite Darstellung derselben Seite und nur für die zu sehen, die
 * den Diagramm-Modus eingeschaltet haben · mitsamt der Serifenschrift, die es
 * mitbringt. Wer den Modus nicht benutzt, lädt davon nichts.
 */
const DashboardBlatt = lazy(() => import("./blatt/DashboardBlatt"));
import { isStoreCapture } from "../lib/storeCapture";

/**
 * Legende des Ratingverlaufs · bewusst außerhalb des Charts.
 *
 * Die eingebaute Recharts-Legende sitzt in der Zeichenfläche und bekommt eine
 * feste Höhe. Auf Telefonbreite passen die vier Modusnamen dort nicht in eine
 * Zeile; sie brechen um, laufen aus ihrer Höhe heraus und schieben sich über
 * die oberste Gitterlinie. Als normaler Textfluss unter dem Diagramm darf sie
 * dagegen umbrechen, so viele Zeilen belegen wie nötig, und die Zeichenfläche
 * bleibt unangetastet.
 */
function HistoryLegend({
  series,
  colors,
}: {
  series: RatingHistorySeries[];
  colors: Record<string, string>;
}) {
  if (series.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 text-[11.5px] text-ink2">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: colors[s.id] ?? chart.draw }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** „Tom 1462" · der Wert eines Namensfeldes im Formularkopf. */
function nameWithElo(name: string, elo: string): ReactNode {
  return (
    <>
      {name} <span className="blatt-zahl text-ink3">{elo}</span>
    </>
  );
}

/** „16…dxe5" · Nummer und Zug in der Notation der Oberflächensprache. */
function moveLabel(cut: number, san: string, locale: Locale): string {
  const ply = cut - 1;
  const nummer = ply % 2 === 0 ? `${ply / 2 + 1}.` : `${(ply + 1) / 2}…`;
  return nummer + translateSan(san, locale);
}

export default function Dashboard({
  go,
  openAnalysis,
  openGames,
}: {
  go: (p: PageId) => void;
  openAnalysis: (gameId: number) => void;
  openGames: (filter?: GamesFilter) => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const storeCapture = isStoreCapture();
  const mobile = useMobileShell();
  const [records, setRecords] = useState<GameSummary[] | null>(null);
  const [rep, setRep] = useState<RepStats | null>(null);
  const [pz, setPz] = useState<PuzzleStats | null>(null);
  // Desktop startet ohne Demo-Konto; die echten Werte kommen aus den Settings.
  const [users, setUsers] = useState(
    backend.mode === "desktop"
      ? { cc: "", li: "", name: "" }
      : { cc: profile.ccUser, li: profile.liUser, name: "" }
  );
  const [goal, setGoal] = useState(puzzleStats.todayGoal);
  const diagramMode = useDiagramMode();
  // Die Partie hinter dem Diagramm des Tages · nur der Modus braucht sie, und
  // nur er holt sie. Die Züge stehen nicht in der Übersicht, die Urteile der
  // Auto-Analyse ohnehin nicht.
  const [blattGame, setBlattGame] = useState<{ record: GameRecord; rows: MoveEvalRow[] } | null>(
    null
  );
  // Womit die übrigen Quellen aufwarten können, wenn keine Partie da ist ·
  // in der Reihenfolge Partie → Repertoire → Puzzle → Endspiel (lib/blatt.ts).
  const [nachrueck, setNachrueck] = useState<{
    rep: DueItem | null;
    puzzle: PuzzleOut | null;
    endgame: EndgameDrill | null;
  } | null>(null);

  useEffect(() => {
    if (backend.mode === "desktop") {
      listGameSummaries().then(setRecords).catch(() => setRecords(null));
      repStats().then(setRep).catch(() => {});
      fetchPuzzleStats().then(setPz).catch(() => {});
      getSettings()
        .then((s) => {
          setUsers({ cc: s.cc_user, li: s.li_user, name: s.display_name });
          setGoal(s.puzzle_goal);
        })
        .catch(() => {});
    }
  }, [backend.mode]);

  const live = records !== null && records.length > 0;

  const dash = useMemo(
    () =>
      live ? buildDashboard(records!, { locale, ccUser: users.cc, liUser: users.li }) : null,
    [live, records, locale, users]
  );

  const cards = dash
    ? dash.cards
    : ratings.map((r) => ({ id: r.id, platform: r.platform, tc: r.tc, timeClass: r.timeClass, value: r.value, delta: r.delta, spark: r.spark, url: r.url }));

  const recent: UiGame[] = dash ? dash.recent : demoGames.slice(0, 5);
  const unanalyzed = dash ? dash.unanalyzed : demoGames.filter((g) => !g.analyzed).length;
  const history: HistoryPoint[] = dash ? dash.history : ratingHistory.map((point, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (ratingHistory.length - 1 - index));
    const monthLabel = date.toLocaleDateString(LOCALE_TAGS[locale], { month: "short" });
    return {
      ...point,
      month: monthLabel,
      monthLabel,
      dayLabel: monthLabel,
    };
  });
  const allSeries: RatingHistorySeries[] = dash?.historySeries ?? [
    { key: "cc", id: "cc", platform: "chess.com" as const, timeClass: "rapid", label: "chess.com" },
    { key: "li", id: "li", platform: "lichess" as const, timeClass: "rapid", label: "lichess" },
  ];
  // Ein Modus, der im gezeigten Halbjahr keinen einzigen Stützpunkt hat, zieht
  // keine Linie · dann gehört er auch nicht in die Legende. Vorher standen dort
  // Namen ohne sichtbare Entsprechung im Diagramm.
  const historySeries = allSeries.filter((s) => history.some((point) => point[s.key] != null));
  // ── Das Diagramm des Tages ────────────────────────────────────────────────
  //
  // Ein Buch druckt nicht die Schlussstellung, sondern die Stelle, an der die
  // Partie entschieden wurde. Welche das ist, hat die Auto-Analyse schon
  // beurteilt · `criticalPly` liest es aus ihren Urteilen (lib/blatt.ts).
  const featuredId = recent[0]?.dbId ?? null;

  useEffect(() => {
    if (!diagramMode || backend.mode !== "desktop" || featuredId == null) {
      setBlattGame(null);
      return;
    }
    let alive = true;
    void Promise.all([getGame(featuredId), gameAnalysis(featuredId).catch(() => [])])
      .then(([record, rows]) => {
        if (alive) setBlattGame({ record, rows });
      })
      .catch(() => {
        if (alive) setBlattGame(null);
      });
    return () => {
      alive = false;
    };
  }, [diagramMode, backend.mode, featuredId]);

  // Ohne Partie in der Datenbank rückt die Stellung aus der nächsten Quelle
  // nach, die etwas anzubieten hat. Geholt wird das nur dann — solange eine
  // Partie da ist, gewinnt sie ohnehin.
  useEffect(() => {
    if (!diagramMode || backend.mode !== "desktop" || featuredId != null) {
      setNachrueck(null);
      return;
    }
    let alive = true;
    void Promise.all([
      repDue(1, 1).catch(() => [] as DueItem[]),
      nextPuzzle({}).catch(() => null),
      endgameStats().catch(() => []),
    ]).then(([due, puzzle, stats]) => {
      if (!alive) return;
      // Die erste Aufgabe, die noch nicht gelöst wurde · aus der eigenen
      // Statistik, nicht geraten.
      const gemeistert = new Set(stats.filter((row) => row.solved > 0).map((row) => row.drill_id));
      setNachrueck({
        rep: due[0] ?? null,
        puzzle,
        endgame: ENDGAME_DRILLS.find((drill) => !gemeistert.has(drill.id)) ?? null,
      });
    });
    return () => {
      alive = false;
    };
  }, [diagramMode, backend.mode, featuredId]);

  /** Urteil der Analyse als Marke, wie sie im Buch neben dem Zug steht. */
  const nagOf = (judgment: string): string | undefined =>
    judgment === "blunder" ? "??" : judgment === "mistake" ? "?" : judgment === "inaccuracy" ? "?!" : undefined;

  const tagesdiagramm = useMemo(() => {
    if (!diagramMode) return null;

    /** Gemeinsame Form für die echte und die Demo-Partie. */
    const build = (g: {
      sans: string[];
      nags: (string | undefined)[];
      white: string;
      whiteElo: string;
      black: string;
      blackElo: string;
      partie: string;
      eco: string;
      opening: string;
      ergebnis: string;
      titel: string;
      note?: string;
      color: "white" | "black";
      onOeffnen?: () => void;
      cut: number;
    }) => {
      const cut = Math.max(0, Math.min(g.cut, g.sans.length));
      const fen = fenAfter(g.sans, cut);
      const davor = g.sans.slice(Math.max(0, cut - 6), cut).map((san, i) => ({
        san,
        nag: g.nags[Math.max(0, cut - 6) + i],
      }));
      const danach = g.sans.slice(cut, cut + 5).map((san, i) => ({ san, nag: g.nags[cut + i] }));
      const letzterZug = cut > 0 ? g.sans[cut - 1] : null;
      return {
        quelle: "game" as const,
        fen,
        orientation: g.color,
        amZug: (cut % 2 === 0 ? "white" : "black") as "white" | "black",
        felder: [
          { label: t("common.white"), wert: nameWithElo(g.white, g.whiteElo), gross: true },
          { label: t("common.black"), wert: nameWithElo(g.black, g.blackElo), gross: true },
          { label: t("blatt.gameField"), wert: g.partie },
          {
            label: t("games.colOpening"),
            wert: (
              <>
                {g.eco && <span className="blatt-zahl text-ink3">{g.eco} </span>}
                {g.opening}
              </>
            ),
          },
        ],
        ergebnis: g.ergebnis,
        zeilen: [
          g.titel,
          letzterZug
            ? t("blatt.positionAfter", { m: moveLabel(cut, letzterZug, locale) })
            : t("blatt.startPosition"),
        ],
        davor,
        danach,
        offset: Math.max(0, cut - 6),
        notiz: g.note?.trim() || undefined,
        onOeffnen: g.onOeffnen,
      };
    };

    if (blattGame) {
      const { record, rows } = blattGame;
      const sans = record.moves ? record.moves.split(" ").filter(Boolean) : [];
      if (sans.length === 0) return null;
      const nags = sans.map((_, index) => nagOf(rows[index]?.judgment ?? ""));
      const me = record.my_name || users.name || users.cc || users.li || t("blatt.you");
      const white = record.color === "white" ? me : record.opponent;
      const black = record.color === "white" ? record.opponent : me;
      const whiteElo = String(record.color === "white" ? record.my_elo : record.opp_elo);
      const blackElo = String(record.color === "white" ? record.opp_elo : record.my_elo);
      const punkte =
        record.result === "draw"
          ? "½ : ½"
          : (record.result === "win") === (record.color === "white")
            ? "1 : 0"
            : "0 : 1";
      return build({
        sans,
        nags,
        white,
        whiteElo,
        black,
        blackElo,
        partie: [record.source, record.time_class, new Date(record.played_ts * 1000).toLocaleDateString(dateLocale())]
          .filter(Boolean)
          .join(" · "),
        eco: record.eco,
        opening: record.opening,
        ergebnis: punkte,
        titel: `${white} – ${black}`,
        note: record.note,
        color: record.color,
        onOeffnen: record.id != null ? () => openAnalysis(record.id!) : undefined,
        cut: criticalPly(rows, sans.length),
      });
    }

    // Kein Spiel in der Datenbank · die Stellung rückt nach. Der Formularkopf
    // bleibt derselbe Kopf, er ist nur anders ausgefüllt.
    if (nachrueck) {
      const quelle = chooseDiagramSource({
        game: false,
        repertoire: nachrueck.rep != null,
        puzzle: nachrueck.puzzle != null,
        endgame: nachrueck.endgame != null,
      });
      if (quelle == null) return null;

      const leerKopf = (woher: string) => [
        {
          label: t("common.white"),
          wert: nameWithElo(users.name || users.cc || users.li || t("blatt.you"), ""),
          gross: true,
        },
        { label: t("common.black"), wert: <span className="text-ink3">{t("blatt.noNewGame")}</span>, gross: true },
        { label: t("blatt.lastGame"), wert: <span className="text-ink3">{t("blatt.none")}</span> },
        { label: t("blatt.diagramFrom"), wert: woher },
      ];

      if (quelle === "repertoire" && nachrueck.rep) {
        const item = nachrueck.rep;
        const letzter = item.prompt_sans[item.prompt_sans.length - 1];
        return {
          quelle,
          fen: fenAfter(item.prompt_sans),
          orientation: item.side,
          amZug: (item.prompt_sans.length % 2 === 0 ? "white" : "black") as "white" | "black",
          felder: leerKopf(
            `${t("nav.repertoire")} · ${t(item.side === "white" ? "common.white" : "common.black")}`
          ),
          ergebnis: t("blatt.none"),
          zeilen: [
            item.line,
            letzter
              ? `${t("blatt.fromRepertoire")} · ${t("blatt.positionAfter", {
                  m: moveLabel(item.prompt_sans.length, letzter, locale),
                })}`
              : t("blatt.fromRepertoire"),
          ],
        };
      }

      if (quelle === "puzzle" && nachrueck.puzzle) {
        const p = nachrueck.puzzle;
        const fen = fenAfterUci(p.fen, p.moves.slice(0, p.setup_plies));
        const weissAmZug = fen.split(" ")[1] === "w";
        return {
          quelle,
          fen,
          orientation: (weissAmZug ? "white" : "black") as "white" | "black",
          amZug: (weissAmZug ? "white" : "black") as "white" | "black",
          felder: leerKopf(`${t("nav.puzzles")} · ${t("pz.rating")} ${deInt(p.rating)}`),
          ergebnis: t("blatt.none"),
          zeilen: [t("blatt.srcPuzzle"), t("blatt.fromPuzzles")],
        };
      }

      if (quelle === "endgame" && nachrueck.endgame) {
        const drill = nachrueck.endgame;
        const weissAmZug = drill.fen.split(" ")[1] === "w";
        return {
          quelle,
          fen: drill.fen,
          orientation: drill.side,
          amZug: (weissAmZug ? "white" : "black") as "white" | "black",
          felder: leerKopf(
            `${t("nav.endgame")} · ${t(drill.goal === "win" ? "eg.goalWin" : "eg.goalDraw")}`
          ),
          ergebnis: t("blatt.none"),
          zeilen: [drillText(drill.name, locale), t("blatt.fromEndgames")],
        };
      }
      return null;
    }

    // Web-Vorschau: die Demo-Partie bringt ihre Urteile selbst mit.
    if (!live) {
      const sans = featuredGame.moves.map((m) => m.san);
      const nags = featuredGame.moves.map((m) => m.nag);
      const cut = nags.findIndex((nag) => nag === "??");
      return build({
        sans,
        nags,
        white: profile.name,
        whiteElo: "1462",
        black: "DragonSlayer_88",
        blackElo: "1448",
        partie: featuredGame.event,
        eco: demoGames[0]?.eco ?? "",
        opening: demoGames[0]?.opening ?? "",
        ergebnis: "1 : 0",
        titel: `${profile.name} – DragonSlayer_88`,
        note: demoGames[0]?.note,
        color: "white",
        cut: cut >= 0 ? cut : sans.length,
      });
    }

    return null;
  }, [diagramMode, blattGame, nachrueck, live, locale, t, users, openAnalysis]);

  const historyColors: Record<string, string> = {
    "chess.com-rapid": chart.cc,
    "chess.com-blitz": chart.gold,
    "chess.com-bullet": chart.mistake,
    "chess.com-daily": chart.violet,
    "lichess-rapid": chart.li,
    "lichess-blitz": chart.accent,
    "lichess-bullet": chart.loss,
    "lichess-daily": "#b09bea",
    cc: chart.cc,
    li: chart.li,
  };

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 11 ? t("dash.goodMorning") : h < 18 ? t("dash.goodDay") : t("dash.goodEvening");
  })();
  const name = storeCapture
    ? "Alex"
    : backend.mode === "desktop" ? users.name || users.cc || users.li : profile.name;

  // Der Modus ist eine zweite Darstellung derselben Daten · alles, was oben
  // geladen und gerechnet wurde, gilt hier unverändert weiter.
  if (diagramMode) {
    return (
      <Suspense fallback={<div className="min-h-[40vh]" aria-busy="true" />}>
        <DashboardBlatt
          mobile={mobile}
          bestand={live ? records!.length : null}
          diagramm={tagesdiagramm}
          angebot={
            // Nur wenn die Stellung *nicht* aus einer Partie kommt · dann
            // ersetzt die Herkunft die Anmerkung.
            tagesdiagramm?.quelle === "game"
              ? undefined
              : {
                  repertoire: rep ? rep.due_now : repertoireStats.dueToday,
                  puzzles: Math.max(
                    0,
                    (pz ? goal : puzzleStats.todayGoal) -
                      (pz ? pz.today_attempts : puzzleStats.todaySolved)
                  ),
                  endgame: nachrueck?.endgame != null,
                }
          }
          wertungen={cards.map((r) => ({
            id: r.id,
            platform: r.platform,
            tc: r.tc,
            value: r.value,
            delta: r.delta,
          }))}
          letzte={recent}
          repDue={rep ? rep.due_now : repertoireStats.dueToday}
          repNeben={
            rep
              ? t("dash.repSummary", { n: rep.my_positions, p: de(rep.coverage_pct) })
              : t("dash.streak", { n: repertoireStats.streak })
          }
          unanalyzed={unanalyzed}
          puzzles={{
            done: pz ? pz.today_attempts : puzzleStats.todaySolved,
            goal: pz ? goal : puzzleStats.todayGoal,
          }}
          onRepertoire={() => go("repertoire")}
          onAnalyse={() => go("analysis")}
          onPuzzles={() => go("puzzles")}
          onAllePartien={() => openGames()}
          onPartie={(game) => (game.dbId != null ? openAnalysis(game.dbId) : openGames())}
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{greeting}, {name}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">
            {new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {live ? t("dash.gamesInDb", { n: deInt(records!.length) }) : storeCapture ? "" : t("dash.demoData")}
          </p>
        </div>
        {!storeCapture && <div className="flex gap-2">
          <ExtLink href={`https://www.chess.com/member/${users.cc}`} label="chess.com" />
          <span className="text-line2">·</span>
          <ExtLink href={`https://lichess.org/@/${users.li}`} label="lichess" />
        </div>}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-4 min-[1100px]:grid-cols-4">
        {cards.map((r) => {
          // Die Karte beantwortet „welche Partien stecken hinter dieser Zahl?"
          // und führt in die Partienliste, gefiltert auf Plattform und
          // Bedenkzeit · dieselbe Leitung, die auch die Badges der letzten
          // Partien darunter benutzen.
          //
          // Ohne Bedenkzeitklasse gibt es nichts zu filtern (die Puzzle-Karte
          // der Demo-Daten): Sie bleibt eine Fläche und tut nichts, statt in
          // eine leere Liste zu führen.
          const target: GamesFilter | null = r.timeClass
            ? { source: r.platform, tc: r.timeClass }
            : null;
          const label = t("dash.showGamesFor", { p: r.platform, tc: r.tc });
          const body = (
            <>
              <div className="mb-2 flex items-center justify-between">
                <SourceBadge source={r.platform} />
                <span className="flex items-center gap-0.5 text-[11.5px] text-ink3">
                  {r.tc}
                  {/* Ohne Zeigegerät gibt es kein Hover · auf dem Telefon muss
                      der Hinweis deshalb stehen bleiben, sonst sieht die Karte
                      aus wie die Anzeige, die sie bisher war. */}
                  {target && (
                    <ChevronRight
                      size={13}
                      className={
                        mobile
                          ? "-mr-1"
                          : "-mr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      }
                      aria-hidden
                    />
                  )}
                </span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[26px] font-semibold leading-none tracking-tight">{r.value}</div>
                  <div
                    className="mt-1.5 flex items-center gap-1 text-[12px]"
                    style={{ color: r.delta >= 0 ? "var(--color-win)" : "var(--color-loss)" }}
                  >
                    {r.delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {r.delta >= 0 ? "+" : ""}
                    {r.delta} · {t("dash.days30")}
                  </div>
                </div>
                <span className="hidden min-[440px]:block">
                  <Spark data={r.spark} color={r.platform === "chess.com" ? chart.cc : chart.li} />
                </span>
              </div>
            </>
          );

          if (!target) {
            return (
              <div key={r.id} className="rounded-xl border border-line bg-panel p-4">
                {body}
              </div>
            );
          }

          return (
            <button
              key={r.id}
              type="button"
              onClick={() => openGames(target)}
              title={label}
              aria-label={label}
              className="group w-full touch-manipulation rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-line2 hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-dim active:bg-panel2"
            >
              {body}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-3">
        <Card
          title={live ? t("dash.ratingHistoryLive") : t("dash.ratingHistoryDemo")}
          className="min-[1100px]:col-span-2"
        >
          <Suspense
            fallback={<div style={{ height: RATING_CHART_HEIGHT }} aria-hidden />}
          >
            <RatingHistoryChart
              history={history}
              series={historySeries}
              colors={historyColors}
              live={live}
            />
          </Suspense>
          <HistoryLegend series={historySeries} colors={historyColors} />
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <BookOpen size={15} className="text-accent" /> {t("dash.repTraining")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {rep ? rep.due_now : repertoireStats.dueToday}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.dueReviews")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">
                  {rep
                    ? t("dash.repSummary", { n: rep.my_positions, p: de(rep.coverage_pct) })
                    : t("dash.streak", { n: repertoireStats.streak })}
                </div>
              </div>
              <Button primary onClick={() => go("repertoire")}>{t("dash.train")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Cpu size={15} className="text-violet" /> {t("dash.analysisQueue")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {deInt(unanalyzed)}
                  <span className="ml-1.5 text-[13px] font-normal text-ink3">{t("dash.gamesWithoutAnalysis")}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink3">{t("dash.stockfishNative")}</div>
              </div>
              <Button onClick={() => go("analysis")}>{t("dash.start")}</Button>
            </div>
          </Card>

          <Card>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Puzzle size={15} className="text-gold" /> {t("dash.puzzleGoal")}
                </div>
                <div className="mt-2 text-[24px] font-semibold leading-none">
                  {pz ? pz.today_attempts : puzzleStats.todaySolved}
                  <span className="text-[15px] font-normal text-ink3"> / {pz ? goal : puzzleStats.todayGoal}</span>
                </div>
                <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-panel3">
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{
                      width: `${Math.min(100, ((pz ? pz.today_attempts : puzzleStats.todaySolved) / (pz ? goal : puzzleStats.todayGoal)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <Button onClick={() => go("puzzles")}>{t("dash.solve")}</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card title={t("dash.recentGames")} className="mt-4" pad={false}
        action={<button onClick={() => openGames()} className="text-[12.5px] text-ink3 hover:text-accent">{t("dash.showAll")}</button>}
      >
        {mobile ? (
          // Auf Handybreite wird aus jeder Zeile eine Karte · die achtspaltige
          // Tabelle liesse sich sonst nur quer scrollend lesen.
          <div>
            {recent.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                onClick={g.dbId != null ? () => openAnalysis(g.dbId!) : undefined}
              />
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <tbody>
            {recent.map((g) => {
              const filterTo = (e: MouseEvent, f: GamesFilter) => {
                e.stopPropagation();
                openGames(f);
              };
              const openable = g.dbId != null;
              return (
                <tr
                  key={g.id}
                  onClick={() => openable && openAnalysis(g.dbId!)}
                  title={openable ? t("dash.openInAnalysis") : undefined}
                  className={`border-b border-line last:border-0 hover:bg-panel2 ${
                    openable ? "cursor-pointer" : ""
                  }`}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <button
                      onClick={(e) => filterTo(e, { date: g.dateKey })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.date}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { source: g.source })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <SourceBadge source={g.source} />
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { tc: g.timeClass })}
                      className="text-ink3 transition-colors hover:text-accent"
                    >
                      {g.tc}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opponent: g.opponent })}
                      className="text-ink transition-colors hover:text-accent"
                    >
                      {g.opponent}
                    </button>
                    <span className="ml-1.5 text-ink3">({g.oppElo})</span>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { opening: g.opening })}
                      className="text-left text-ink2 transition-colors hover:text-accent"
                    >
                      {g.opening}
                    </button>
                  </td>
                  <td className="px-2">
                    <button
                      onClick={(e) => filterTo(e, { result: g.result })}
                      className="transition-opacity hover:opacity-80"
                    >
                      <ResultBadge result={g.result} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 text-right text-ink2">
                    {g.accuracy != null ? `${de(g.accuracy)} %` : "—"}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <ExtLink
                      href={
                        g.url ??
                        (g.source === "chess.com"
                          ? `https://www.chess.com/games/archive/${users.cc}`
                          : `https://lichess.org/@/${users.li}/all`)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </Card>
    </div>
  );
}
