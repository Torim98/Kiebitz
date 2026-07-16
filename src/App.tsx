import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Bird,
  BookOpen,
  Database,
  LayoutDashboard,
  Puzzle as PuzzleIcon,
  RefreshCw,
  Settings as SettingsIcon,
} from "lucide-react";
import { useBackendInfo } from "./lib/backend";
import { dbStats } from "./lib/db";
import { useT, type Key } from "./lib/i18n";
import Dashboard from "./pages/Dashboard";
import Games from "./pages/Games";
import Analysis from "./pages/Analysis";
import Repertoire from "./pages/Repertoire";
import Puzzles from "./pages/Puzzles";
import Insights from "./pages/Insights";
import SettingsPage from "./pages/Settings";
import { deInt } from "./lib/util";

export type PageId =
  | "dashboard"
  | "games"
  | "analysis"
  | "repertoire"
  | "puzzles"
  | "insights"
  | "settings";

const nav: { id: PageId; labelKey: Key; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "games", labelKey: "nav.games", icon: Database },
  { id: "analysis", labelKey: "nav.analysis", icon: Activity },
  { id: "repertoire", labelKey: "nav.repertoire", icon: BookOpen },
  { id: "puzzles", labelKey: "nav.puzzles", icon: PuzzleIcon },
  { id: "insights", labelKey: "nav.insights", icon: BarChart3 },
];

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const backend = useBackendInfo();
  const t = useT();
  const [gameCount, setGameCount] = useState<number | null>(null);
  const [analysisGameId, setAnalysisGameId] = useState<number | null>(null);

  const openAnalysis = (gameId: number) => {
    setAnalysisGameId(gameId);
    setPage("analysis");
  };

  useEffect(() => {
    if (backend.mode === "desktop") {
      dbStats().then((s) => setGameCount(s.total)).catch(() => {});
    }
  }, [backend.mode, page]);

  return (
    <div className="flex h-full">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Bird size={20} />
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Kiebitz</div>
            <div className="text-[11px] text-ink3">{t("app.tagline")}</div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {nav.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
                page === id
                  ? "bg-panel3 font-medium text-ink"
                  : "text-ink2 hover:bg-panel2 hover:text-ink"
              }`}
            >
              <Icon size={17} className={page === id ? "text-accent" : "text-ink3"} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="mt-auto px-3 pb-5">
          <div className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px] text-ink2">
              <RefreshCw size={13} className="text-accent" />
              {backend.mode === "desktop" ? t("app.localDb") : t("app.synced")}
            </div>
            <div className="mt-0.5 text-[11px] text-ink3">
              {backend.mode === "desktop"
                ? gameCount != null
                  ? t("app.dbCount", { n: deInt(gameCount) })
                  : t("app.dbReady")
                : t("app.demoSync")}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5 text-[11px] text-ink3">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    backend.mode === "desktop" ? "var(--color-win)" : backend.mode === "web" ? "var(--color-gold)" : "var(--color-draw)",
                }}
              />
              {backend.mode === "desktop"
                ? t("app.desktopBackend", { v: backend.info?.version ?? "?" })
                : backend.mode === "web"
                  ? t("app.webMode")
                  : t("app.connecting")}
            </div>
          </div>
          <button
            onClick={() => setPage("settings")}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              page === "settings"
                ? "bg-panel3 font-medium text-ink"
                : "text-ink2 hover:bg-panel2 hover:text-ink"
            }`}
          >
            <SettingsIcon size={17} className={page === "settings" ? "text-accent" : "text-ink3"} />
            {t("nav.settings")}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {page === "dashboard" && <Dashboard go={setPage} />}
        {page === "games" && <Games openAnalysis={openAnalysis} />}
        {page === "analysis" && <Analysis targetGameId={analysisGameId} />}
        {page === "repertoire" && <Repertoire />}
        {page === "puzzles" && <Puzzles />}
        {page === "insights" && <Insights />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
