import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { getSettings, type Settings } from "./lib/settings";
import { syncInfo } from "./lib/sync";
import { configureAutoSync, useSyncStatus } from "./lib/syncManager";
import { startReminders, stopReminders } from "./lib/notify";
import { setBoardSoundEnabled, setBoardSoundVolume } from "./lib/sound";
import { installCrashReporter, logEvent } from "./lib/diag";
import { onDeviceShake } from "./lib/shake";
import { startAutoImport, stopAutoImport } from "./lib/autoImport";
import {
  installUpdate,
  onUpdateAvailable,
  onUpdateState,
  type UpdateAvailable,
  type UpdateState,
} from "./lib/updater";
import { useT, type Key } from "./lib/i18n";
import { useNavStack, type PageId } from "./lib/nav";
import {
  MobileAppBar,
  MobileNav,
  ShellProvider,
  useLandscapePhone,
} from "./components/MobileShell";
import Dashboard from "./pages/Dashboard";
import Games from "./pages/Games";
import Analysis from "./pages/Analysis";
import Repertoire from "./pages/Repertoire";
import Endgame from "./pages/Endgame";
import type { EndgameCategory } from "./data/endgames";
import Puzzles from "./pages/Puzzles";
import Study from "./pages/Study";
import Insights from "./pages/InsightsV2";
import SettingsPage from "./pages/Settings";
import Support from "./pages/Support";
import Onboarding from "./components/Onboarding";
import { dateLocale, deInt } from "./lib/util";
import type { GamesFilter } from "./lib/gameUi";
import { isMobilePreview, isStoreCapture } from "./lib/storeCapture";

export type { PageId };

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

// Die fünf Hauptziele der mobilen Bottom-Navigation · Material 3 lässt für eine
// Leiste 3 bis 5 Einträge zu. Der Rest bleibt vorerst im Drawer, bis der
// Training-Hub Repertoire, Endspiele und Puzzles aufnimmt.
const BOTTOM_NAV: PageId[] = ["dashboard", "games", "study", "analysis", "insights"];
const bottomNav = BOTTOM_NAV.map((id) => nav.find((n) => n.id === id)!);

// Ziele, die später unter "Training" einziehen. Sie markieren schon jetzt den
// passenden Tab, damit die Leiste nie ganz ohne Auswahl dasteht.
const NAV_PARENT: Partial<Record<PageId, PageId>> = {
  repertoire: "study",
  endgame: "study",
  puzzles: "study",
};

export default function App() {
  // Der Stapel hält die Seite samt Deep-Link-Parametern und hängt an der
  // Session-History · siehe lib/nav.ts. Erst dadurch tut die Android-Zurück-
  // Taste etwas anderes, als die App zu beenden.
  const { route, depth, navigate: goTo, push, back } = useNavStack();
  const page = route.page;
  const backend = useBackendInfo();
  const t = useT();
  const storeCapture = isStoreCapture();
  const [gameCount, setGameCount] = useState<number | null>(null);

  // Partie öffnen ist eine Detailebene: Zurück führt in die Partienliste
  // zurück, nicht aus der App heraus.
  const openAnalysis = (gameId: number) => push("analysis", { gameId });

  // Deep-Link vom Dashboard: Games mit einem Vorfilter öffnen (Datum, Quelle,
  // Modus, Gegner, Eröffnung oder Ergebnis).
  const openGames = (filter?: GamesFilter) => goTo("games", { filter: filter ?? null });

  // Deep-Link aus dem Trainingsplan: Puzzles mit Motiv *und* Schwierigkeitsband
  // öffnen · ebenfalls eine Detailebene, damit Zurück wieder im Training landet.
  // Ohne das Band bliebe von „15 Aufgaben zwischen 1420 und 1580" nur ein
  // Ratschlag übrig, den der Nutzer von Hand nachstellen müsste.
  const openPuzzles = (theme?: string, band?: { minRating?: number; maxRating?: number }) =>
    push("puzzles", {
      theme: theme ?? "",
      minRating: band?.minRating ?? 0,
      maxRating: band?.maxRating ?? 0,
    });

  // Dasselbe fürs Endspiel: der Lernplan kennt den schwachen Typ, also soll er
  // ihn auch vorwählen können.
  const openEndgame = (category?: EndgameCategory) =>
    push("endgame", { endgameCategory: category });

  // Rückmeldung ist immer eine Detailebene · Zurück führt dorthin zurück, wo
  // der Nutzer gerade war, egal ob er über die Einstellungen kam oder geschüttelt hat.
  const openSupport = (reportType: "feedback" | "crash" | "feature" = "feedback") =>
    push("support", { reportType });

  useEffect(() => {
    if (backend.mode === "desktop") {
      dbStats().then((s) => setGameCount(s.total)).catch(() => {});
    }
  }, [backend.mode, page]);

  // Brettklänge nach den gespeicherten Einstellungen scharfschalten. Ohne
  // Backend (Web-Preview) bleiben die Voreinstellungen aus lib/sound stehen.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    getSettings()
      .then((s) => {
        setBoardSoundEnabled(s.sound_enabled);
        setBoardSoundVolume(s.sound_volume / 100);
      })
      .catch(() => {});
  }, [backend.mode]);

  // Unbehandelte Fehler der Oberfläche landen im lokalen Logbuch · sie sind
  // die Datenbasis für einen Absturzbericht, den niemand abtippen muss.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    return installCrashReporter();
  }, [backend.mode]);

  // Ersteinrichtung: nur beim allerersten Start, danach nie wieder.
  const [onboarding, setOnboarding] = useState<Settings | null>(null);
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    getSettings()
      .then((s) => setOnboarding(s.onboarded ? null : s))
      .catch(() => {});
  }, [backend.mode]);

  // Auto-Sync (Mobile-Client) nach den Einstellungen scharfschalten. Läuft nur,
  // wenn wir mobil sind, es aktiviert ist und ein Hub konfiguriert wurde.
  const isMobile =
    backend.info?.platform === "android" ||
    backend.info?.platform === "ios" ||
    isMobilePreview();
  // Querformat auf Telefonhöhe: die Navigation tritt an die linke Kante.
  const rail = useLandscapePhone();
  const mobileMainRef = useRef<HTMLElement>(null);

  // Die mobile Shell behält denselben Scroll-Container über alle Seiten
  // hinweg. Ohne Reset übernimmt der nächste Tab die Position des vorherigen
  // und beginnt dadurch irgendwo mitten im Inhalt.
  useLayoutEffect(() => {
    if (!isMobile) return;
    const main = mobileMainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.scrollLeft = 0;
  }, [isMobile, page]);

  // Kräftiges Schütteln öffnet auf dem Handy die Rückmeldung · vorgewählt als
  // Absturzbericht, weil man das Gerät selten aus Begeisterung schüttelt.
  // Der Ref hält die aktuelle Seite, damit die Geste nicht bei jedem
  // Seitenwechsel neu angemeldet werden muss.
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!isMobile) return;
    return onDeviceShake(() => {
      if (pageRef.current === "support") return;
      logEvent("info", "ui", "Feedback über Schüttelgeste geöffnet");
      push("support", { reportType: "crash" });
    });
  }, [isMobile, push]);

  // Markiert die mobile Shell fürs Stylesheet · dort unterdrückt die Regel für
  // .page-title die von der App-Bar bereits gezeigten Überschriften.
  useEffect(() => {
    if (!isMobile) return;
    document.documentElement.dataset.shell = "mobile";
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, [isMobile]);
  useEffect(() => {
    if (!storeCapture) return;
    document.documentElement.dataset.storeCapture = "true";
    return () => {
      delete document.documentElement.dataset.storeCapture;
    };
  }, [storeCapture]);
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

  // Trainings-Erinnerungen: der Prüf-Timer liest die Einstellungen bei jedem
  // Durchlauf selbst, Änderungen greifen also ohne Neustart.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    startReminders();
    startAutoImport();
    return () => {
      stopReminders();
      stopAutoImport();
    };
  }, [backend.mode]);

  // Toast für den Auto-Update-Lauf beim Start (der Neustart soll nicht
  // kommentarlos passieren); Fehler zeigt die Settings-Seite.
  const [update, setUpdate] = useState<UpdateState | null>(null);
  // Bei deaktiviertem Auto-Update meldet das Backend nur, dass eine Version
  // bereitsteht · wir zeigen dann unten rechts einen Hinweis mit Aktion.
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
  // Ein Ziel, dessen Elternseite gerade offen ist, wird als Detailebene
  // geöffnet · Zurück führt dann dorthin zurück statt auf den Start.
  const navigate = (id: PageId) => {
    if (NAV_PARENT[id] === page) push(id);
    else goTo(id);
    setNavOpen(false);
  };

  const activeTab = NAV_PARENT[page] ?? page;

  // Auf der App-Bar steht der Seitenname; der Start zeigt stattdessen die
  // Wortmarke, weil "Dashboard" schon in der Leiste darunter steht.
  const pageLabel = [
    ...nav,
    { id: "settings" as PageId, labelKey: "nav.settings" as Key },
    { id: "support" as PageId, labelKey: "nav.support" as Key },
  ].find((n) => n.id === page);
  const barTitle = page === "dashboard" ? null : pageLabel ? t(pageLabel.labelKey) : null;

  // Der Zurück-Pfeil erscheint nur auf Ebenen, die kein Hauptziel sind ·
  // zwischen den Tabs navigiert die Leiste, nicht der Pfeil.
  const showBack = depth > 2 || !BOTTOM_NAV.includes(page);

  // Inhalt der Desktop-Sidebar · auch für den Drawer im schmalen Fenster.
  const sidebarContent = (
    <>
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
            onClick={() => navigate(id)}
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
        {!storeCapture && (
        <div className="mb-3 rounded-lg border border-line bg-panel2 px-3 py-2.5">
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
        )}
        <button
          onClick={() => navigate("settings")}
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
    </>
  );

  const mainContent = (
    <>
      {page === "dashboard" && (
        <Dashboard go={navigate} openAnalysis={openAnalysis} openGames={openGames} />
      )}
      {page === "games" && (
        <Games openAnalysis={openAnalysis} initialFilter={route.filter ?? null} />
      )}
      {page === "analysis" && <Analysis targetGameId={route.gameId ?? null} />}
      {page === "repertoire" && <Repertoire />}
      {page === "endgame" && <Endgame initialCategory={route.endgameCategory} />}
      {page === "puzzles" && (
        <Puzzles
          initialTheme={route.theme ?? ""}
          initialMinRating={route.minRating ?? 0}
          initialMaxRating={route.maxRating ?? 0}
        />
      )}
      {page === "study" && (
        <Study go={navigate} openPuzzles={openPuzzles} openEndgame={openEndgame} />
      )}
      {page === "insights" && (
        <Insights go={navigate} openPuzzles={openPuzzles} openAnalysis={openAnalysis} />
      )}
      {page === "settings" && <SettingsPage openSupport={openSupport} />}
      {page === "support" && <Support initialType={route.reportType ?? "feedback"} />}
    </>
  );

  const overlays = (
    <>
      {onboarding && (
        <Onboarding
          settings={onboarding}
          onDone={(applied) => {
            setOnboarding(null);
            // Neue Konten sofort nutzen (Sprache steckt schon im Provider).
            void applied;
          }}
        />
      )}
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
    </>
  );

  // ── Mobile Shell ───────────────────────────────────────────────────────────
  // App-Bar oben (Titel, Zurück, Einstellungen), Navigation unten bzw. im
  // Querformat als Rail links. Kein Drawer mehr · alle Ziele hängen entweder
  // in der Leiste oder unter dem Training.
  if (isMobile) {
    return (
      <ShellProvider mobile>
      <div className={`flex h-full ${rail ? "flex-row" : "flex-col"}`}>
        {rail && (
          <MobileNav items={bottomNav} activeId={activeTab} onSelect={navigate} rail />
        )}
        {/* min-h-0: sonst wächst die Spalte mit dem Inhalt, statt <main>
            scrollen zu lassen · Flex-Kinder schrumpfen ohne das nicht. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MobileAppBar
            title={barTitle}
            showBack={showBack}
            onBack={back}
            onSettings={() => navigate("settings")}
            settingsActive={page === "settings"}
          />
          <main ref={mobileMainRef} className="min-w-0 flex-1 overflow-y-auto">
            {mainContent}
          </main>
        </div>
        {!rail && (
          <MobileNav items={bottomNav} activeId={activeTab} onSelect={navigate} rail={false} />
        )}
        {overlays}
      </div>
      </ShellProvider>
    );
  }

  // ── Desktop-Shell ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-[228px] shrink-0 flex-col border-r border-line bg-panel md:flex">
        {sidebarContent}
      </aside>

      {/* Topbar im schmalen Fenster (unter md) */}
      <header
        className="flex shrink-0 items-center justify-between border-b border-line bg-panel px-4 pb-2 md:hidden"
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

      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
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
        {mainContent}
      </main>

      {overlays}
    </div>
  );
}
