import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  Clock,
  Gauge,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useMobileShell } from "../components/MobileShell";
import { PlusLock } from "../components/PlusLock";
import { usePlusGate } from "../lib/plus/usePlus";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { listGameSummaries, type GameSummary } from "../lib/db";
import { errorStats, type PhaseErrors } from "../lib/analysis";
import { puzzleInsights, type PuzzleInsights } from "../lib/puzzles";
import { buildInsights } from "../lib/stats";
import { deepInsights, type DeepInsights } from "../lib/insights";
import { buildDna } from "../lib/dna";
import { buildFindings, findingsFor, type Finding, type FindingTab } from "../lib/findings";
import { deInt } from "../lib/format";
import type { PageId } from "../App";
import Overview from "./insights/Overview";
import Strength from "./insights/Strength";
import Time from "./insights/Time";
import Openings from "./insights/Openings";
import Patterns from "./insights/Patterns";
import Training from "./insights/Training";
import {
  DEMO_ERRORS,
  DEMO_RECORDS,
  demoDeepInsights,
  demoPuzzleInsights,
} from "./insights/demo";

type InsightTab = "overview" | FindingTab;

const TABS: { id: InsightTab; key: Key; icon: typeof Gauge }[] = [
  { id: "overview", key: "ins.tabOverview", icon: Gauge },
  { id: "strength", key: "ins.tabStrength", icon: BarChart3 },
  { id: "time", key: "ins.tabTime", icon: Clock },
  { id: "openings", key: "ins.tabOpenings", icon: BookOpen },
  { id: "patterns", key: "ins.tabPatterns", icon: CalendarClock },
  { id: "training", key: "ins.tabTraining", icon: GraduationCap },
];

export default function InsightsV2({
  go,
  openPuzzles,
  openAnalysis,
}: {
  go: (page: PageId) => void;
  openPuzzles: (theme?: string) => void;
  openAnalysis: (gameId: number) => void;
}) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const mobile = useMobileShell();
  const desktop = backend.mode === "desktop";

  const [tab, setTab] = useState<InsightTab>("overview");
  const deepGate = usePlusGate("full_insights");
  const [records, setRecords] = useState<GameSummary[]>([]);
  const [errors, setErrors] = useState<PhaseErrors[]>([]);
  const [deep, setDeep] = useState<DeepInsights | null>(null);
  const [puzzles, setPuzzles] = useState<PuzzleInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!desktop) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listGameSummaries().catch(() => [] as GameSummary[]),
      errorStats().catch(() => [] as PhaseErrors[]),
      // Die Tiefenanalyse läuft über die Zugebene · sie darf ruhig eine Sekunde
      // brauchen, aber sie darf die Seite nicht blockieren.
      deepInsights().catch(() => null),
    ]).then(([nextRecords, nextErrors, nextDeep]) => {
      if (cancelled) return;
      setRecords(nextRecords);
      setErrors(nextErrors);
      setDeep(nextDeep);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  // Die Puzzle-Detailauswertung erst holen, wenn der Reiter geöffnet wird.
  useEffect(() => {
    if (!desktop || tab !== "training" || puzzles) return;
    let cancelled = false;
    puzzleInsights()
      .then((next) => !cancelled && setPuzzles(next))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktop, tab, puzzles]);

  const analysisRecords = desktop ? records : DEMO_RECORDS;
  const live = useMemo(() => buildInsights(analysisRecords, locale), [analysisRecords, locale]);
  const deepData = useMemo(() => (desktop ? deep : demoDeepInsights()), [desktop, deep]);
  const puzzleData = desktop ? puzzles : demoPuzzleInsights();
  const analysisErrors = desktop ? errors : DEMO_ERRORS;

  const dna = useMemo(
    () => (deepData ? buildDna(deepData, live) : []),
    [deepData, live]
  );
  const findings = useMemo(
    () => (deepData ? buildFindings(deepData, live) : []),
    [deepData, live]
  );

  const onAction = (finding: Finding) => {
    switch (finding.action?.kind) {
      case "repertoire":
        go("repertoire");
        break;
      case "puzzles":
        openPuzzles(finding.action.theme);
        break;
      case "endgame":
        go("endgame");
        break;
      case "analysis":
        go("analysis");
        break;
      case "games":
        go("games");
        break;
    }
  };

  const subtitle = deepData
    ? t("ins.subtitleDeep", { n: deInt(live.totalGames) })
    : t("common.loading");

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("ins.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{subtitle}</p>
      </header>

      {/* Sechs Reiter passen mobil in zwei Reihen zu dritt · quer scrollende
          Leisten verstecken genau die Reiter, die niemand findet. */}
      <nav
        className={`mb-5 rounded-xl border border-line bg-panel p-1 ${
          mobile ? "grid grid-cols-3 gap-1" : "flex gap-1"
        }`}
        aria-label={t("ins.sections")}
        data-tour="insights-tabs"
      >
        {TABS.map(({ id, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`flex items-center justify-center rounded-lg font-medium transition-colors ${
              mobile
                ? "min-w-0 flex-col gap-1 px-1 py-2 text-[11.5px]"
                : "min-w-fit flex-1 gap-2 px-3 py-2.5 text-[12.5px]"
            } ${tab === id ? "bg-panel3 text-ink shadow-sm" : "text-ink3 hover:bg-panel2 hover:text-ink2"}`}
          >
            <Icon size={14} className={`shrink-0 ${tab === id ? "text-accent" : ""}`} />
            <span className="max-w-full truncate">{t(key)}</span>
            {id !== "overview" && !deepGate.unlocked && !deepGate.pending && (
              <Sparkles size={11} className="shrink-0 text-accent" />
            )}
          </button>
        ))}
      </nav>

      {desktop && loading && (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-10 text-center text-[12.5px] text-ink3">
          {t("ins.loadingDeep")}
        </div>
      )}

      {desktop && !loading && records.length === 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-3 text-[12.5px] text-ink3">
          {t("ins.noGames")}
        </div>
      )}

      {!loading && deepData && (
        <>
          {tab === "overview" && (
            <Overview
              deep={deepData}
              live={live}
              dna={dna}
              findings={findings}
              onAction={onAction}
              onOpenGame={(gameId) => openAnalysis(gameId)}
            />
          )}
          {/* Die Übersicht ist die grundlegende Statistik und bleibt frei.
              Die fünf Tiefenseiten sind „Vollständige Insights" · gesperrt
              stehen sie als Vorschau da, nicht als leere Seite. */}
          {tab !== "overview" && (
            <PlusLock feature="full_insights">
              {tab === "strength" && (
                <Strength
                  deep={deepData}
                  live={live}
                  errors={analysisErrors}
                  findings={findingsFor(findings, "strength")}
                  onAction={onAction}
                />
              )}
              {tab === "time" && (
                <Time deep={deepData} findings={findingsFor(findings, "time")} onAction={onAction} />
              )}
              {tab === "openings" && (
                <Openings
                  deep={deepData}
                  live={live}
                  findings={findingsFor(findings, "openings")}
                  onAction={onAction}
                  desktop={desktop}
                  onOpenRepertoire={() => go("repertoire")}
                />
              )}
              {tab === "patterns" && (
                <Patterns
                  deep={deepData}
                  live={live}
                  findings={findingsFor(findings, "patterns")}
                  onAction={onAction}
                />
              )}
              {tab === "training" && (
                <Training
                  deep={deepData}
                  puzzles={puzzleData}
                  findings={findingsFor(findings, "training")}
                  onAction={onAction}
                  desktop={desktop}
                />
              )}
            </PlusLock>
          )}
        </>
      )}

      {!loading && !deepData && desktop && (
        <div className="rounded-xl border border-dashed border-line2 px-4 py-10 text-center text-[12.5px] text-ink3">
          {t("ins.deepFailed")}
        </div>
      )}
    </div>
  );
}
