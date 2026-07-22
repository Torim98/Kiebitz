import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Bird,
  BookOpen,
  Crown,
  Database,
  Download,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Menu,
  Puzzle as PuzzleIcon,
  RefreshCw,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useBackendInfo } from "./lib/backend";
import { dbStats } from "./lib/db";
import { getSettings } from "./lib/settings";
import { syncInfo } from "./lib/sync";
import { configureAutoSync, useSyncStatus } from "./lib/syncManager";
import {
  installUpdate,
  onUpdateAvailable,
  onUpdateState,
  type UpdateAvailable,
  type UpdateState,
} from "./lib/updater";
import { useT, type Key } from "./lib/i18n";
import Dashboard from "./pages/Dashboard";
import Games from "./pages/Games";
import Analysis from "./pages/Analysis";
import Repertoire from "./pages/Repertoire";
import Endgame from "./pages/Endgame";
import Puzzles from "./pages/Puzzles";
import Study from "./pages/Study";
import Insights from "./pages/InsightsV2";
import SettingsPage from "./pages/Settings";
import { dateLocale, deInt } from "./lib/util";
import type { GamesFilter } from "./lib/gameUi";

export type PageId =
  | "dashboard"
  | "games"
  | "analysis"
  | "repertoire"
  | "endgame"
  | "puzzles"
  | "study"
  | "insights"
  | "settings";

const nav: { id: PageId; labelKey: Key; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "games", labelKey: "nav.games", icon: Database },
  { id: "analysis", labelKey: "nav.analysis", icon: Activity },
  { id: "repertoire", labelKey: "nav.repertoire", icon: BookOpen },
  { id: "endgame", labelKey: "nav.endgame", icon: Crown },
  { id: "puzzles", labelKey: "nav.puzzles", icon: PuzzleIcon },
  { id: "study", labelKey: "nav.study", icon: GraduationCap },
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

  // Deep-Link vom Dashboard: Games mit einem Vorfilter öffnen (Datum, Quelle,
  // Modus, Gegner, Eröffnung oder Ergebnis).
  const [gamesFilter, setGamesFilter] = useState<GamesFilter | null>(null);
  const openGames = (filter?: GamesFilter) => {
    setGamesFilter(filter ?? null);
    setPage("games");
  };

  // Deep-Link vom Coach: Puzzles direkt mit Motiv-Filter öffnen.
  const [puzzleTheme, setPuzzleTheme] = useState<string>("");
  const openPuzzles = (theme?: string) => {
    setPuzzleTheme(theme ?? "");
    setPage("puzzles");
  };

  useEffect(() => {
    if (backend.mode === "desktop") {
      dbStats().then((s) => setGameCount(s.total)).catch(() => {});
    }
  }, [backend.mode, page]);

  // Auto-Sync (Mobile-Client) nach den Einstellungen scharfschalten. Läuft nur,
  // wenn wir mobil sind, es aktiviert ist und ein Hub konfiguriert wurde.
  const isMobile = backend.info?.platform === "android" || backend.info?.platform === "ios";
  const syncStatus = useSyncStatus();
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    Promise.all([getSettings(), syncInfo().catch(() => null)])
      .then(([s, info]) =>
        configureAutoSync({
          isMobile,
          syncAuto: s.sync_auto,
          syncHost: s.sync_host,
          lastSync: info?.last_sync,
        })
      )
      .catch(() => {});
  }, [backend.mode, isMobile]);

  // Toast für den Auto-Update-Lauf beim Start (der Neustart soll nicht
  // kommentarlos passieren); Fehler zeigt die Settings-Seite.
  const [update, setUpdate] = useState<UpdateState | null>(null);
  // Bei deaktiviertem Auto-Update meldet das Backend nur, dass eine Version
  // bereitsteht — wir zeigen dann unten rechts einen Hinweis mit Aktion.
  const [available, setAvailable] = useState<UpdateAvailable | null>(null);
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const track = (u: () => void) => (disposed ? u() : cleanups.push(u));
    onUpdateState((s) => setUpdate(s.phase === "error" ? null : s)).then(track);
    onUpdateAvailable(setAvailable).then(track);
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [backend.mode]);

  // Der Nutzer startet das Update aus der Benachrichtigung; ab da übernimmt
  // der Fortschritts-Toast (update://state). Fehler zeigt die Settings-Seite.
  const startUpdate = () => {
    setAvailable(null);
    installUpdate().catch(() => {});
  };

  // Mobile: Sidebar wird zum Slide-in-Drawer hinter einem Hamburger-Button.
  const [navOpen, setNavOpen] = useState(false);
  const navigate = (id: PageId) => {
    if (id === "games") openGames();
    else {
      if (id === "analysis") setAnalysisGameId(null);
      setPage(id);
    }
    setNavOpen(false);
  };

  // Inhalt der Sidebar — identisch für Desktop-Aside und Mobile-Drawer.
  const sidebarContent = (
    <>
      <div className={`flex items-center gap-2.5 ${isMobile ? "px-4 py-3" : "px-5 pb-5 pt-6"}`}>
        <span className={`flex items-center justify-center rounded-xl bg-accent-soft text-accent ${isMobile ? "h-8 w-8" : "h-9 w-9"}`}>
          <Bird size={20} />
        </span>
        <div>
          <div className="text-[15px] font-semibold tracking-tight">Kiebitz</div>
          <div className="text-[11px] text-ink3">{t("app.tagline")}</div>
        </div>
      </div>

      <nav className={`flex flex-col ${isMobile ? "gap-0 px-2" : "gap-0.5 px-3"}`}>
        {nav.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            className={`flex items-center gap-3 rounded-lg px-3 text-left text-[13.5px] transition-colors ${isMobile ? "py-1.5" : "py-2"} ${
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

      <div className={`mt-auto px-3 ${isMobile ? "pb-2" : "pb-5"}`}>
        <div className={`mb-3 rounded-lg border border-line bg-panel2 px-3 py-2.5 ${isMobile ? "mobile-landscape-hide" : ""}`}>
          <div className="flex items-center gap-2 text-[12px] text-ink2">
            {syncStatus.active ? (
              <>
                <RefreshCw
                  size={13}
                  className={
                    syncStatus.phase === "syncing"
                      ? "animate-spin text-accent"
                      : syncStatus.phase === "error"
                        ? "text-ink3"
                        : "text-accent"
                  }
                />
                {syncStatus.phase === "syncing"
                  ? t("app.syncing")
                  : syncStatus.phase === "error"
                    ? t("app.syncOffline")
                    : syncStatus.lastSync > 0
                      ? t("app.syncedAt", {
                          t: new Date(syncStatus.lastSync * 1000).toLocaleTimeString(dateLocale()),
                        })
                      : t("app.synced")}
              </>
            ) : (
              <>
                <RefreshCw size={13} className="text-accent" />
                {backend.mode === "desktop" ? t("app.localDb") : t("app.synced")}
              </>
            )}
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
          onClick={() => navigate("settings")}
          className={`flex w-full items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors ${isMobile ? "py-1.5" : "py-2"} ${
            page === "settings"
              ? "bg-panel3 font-medium text-ink"
              : "text-ink2 hover:bg-panel2 hover:text-ink"
          }`}
        >
          <SettingsIcon size={17} className={page === "settings" ? "text-accent" : "text-ink3"} />
          {t("nav.settings")}
        </button>
      </div>
    </>
  );

  return (
    <div className={`flex h-full flex-col ${isMobile ? "" : "md:flex-row"}`}>
      <aside className={`${isMobile ? "hidden" : "hidden md:flex"} w-[228px] shrink-0 flex-col border-r border-line bg-panel`}>
        {sidebarContent}
      </aside>

      {/* Mobile-Topbar (unter md) */}
      <header
        className={`${isMobile ? "flex" : "flex md:hidden"} shrink-0 items-center justify-between border-b border-line bg-panel px-4 pb-2`}
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Bird size={17} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Kiebitz</span>
        </div>
        <button
          onClick={() => setNavOpen(true)}
          aria-label={t("app.menu")}
          className="rounded-lg p-2 text-ink2 transition-colors hover:bg-panel2 hover:text-ink"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* Mobile-Drawer */}
      {navOpen && (
        <div className={`fixed inset-0 z-50 ${isMobile ? "" : "md:hidden"}`}>
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <aside
            className="absolute inset-y-0 left-0 flex w-[248px] flex-col overflow-y-auto border-r border-line bg-panel shadow-2xl"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      <main
        className="min-w-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {page === "dashboard" && (
          <Dashboard go={navigate} openAnalysis={openAnalysis} openGames={openGames} />
        )}
        {page === "games" && <Games openAnalysis={openAnalysis} initialFilter={gamesFilter} />}
        {page === "analysis" && <Analysis targetGameId={analysisGameId} />}
        {page === "repertoire" && <Repertoire />}
        {page === "endgame" && <Endgame />}
        {page === "puzzles" && <Puzzles initialTheme={puzzleTheme} />}
        {page === "study" && <Study go={navigate} openPuzzles={openPuzzles} />}
        {page === "insights" && <Insights />}
        {page === "settings" && <SettingsPage />}
      </main>

      {update ? (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-lg border border-line bg-panel2 px-4 py-3 text-[12.5px] text-ink2 shadow-xl">
          <Loader2 size={15} className="animate-spin text-accent" />
          {update.phase === "installing"
            ? t("app.updateInstalling", { v: update.version })
            : t("app.updateDownloading", { v: update.version })}
        </div>
      ) : (
        available && (
          <div className="fixed bottom-4 right-4 z-50 flex w-[288px] flex-col gap-2.5 rounded-lg border border-line bg-panel2 px-4 py-3 shadow-xl">
            <div className="flex items-start gap-2.5">
              <RefreshCw size={15} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 text-[12.5px] text-ink2">
                {t("app.updateAvailable", { v: available.version })}
              </div>
              <button
                onClick={() => setAvailable(null)}
                aria-label={t("app.updateLater")}
                className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-ink3 transition-colors hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAvailable(null)}
                className="rounded-md px-2.5 py-1 text-[12px] text-ink3 transition-colors hover:text-ink"
              >
                {t("app.updateLater")}
              </button>
              <button
                onClick={startUpdate}
                className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-[#06251a] transition-colors hover:bg-[#2bd49b]"
              >
                <Download size={13} /> {t("app.updateNow")}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
