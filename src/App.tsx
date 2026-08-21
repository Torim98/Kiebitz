import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
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
import { onDataChange } from "./lib/changes";
import { getSettings, type Settings } from "./lib/settings";
import { syncInfo } from "./lib/sync";
import { configureAutoSync, useSyncStatus } from "./lib/syncManager";
import { startReminders, stopReminders } from "./lib/notify";
import { setBoardSoundEnabled, setBoardSoundVolume } from "./lib/sound";
import { installCrashReporter, logEvent } from "./lib/diag";
import { onDeviceShake } from "./lib/shake";
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
import { SHEET_ROOT_ID } from "./components/MobileSheet";
import type { EndgameCategory } from "./data/endgames";
import AdBanner from "./components/AdBanner";
import PlanBadge from "./components/PlanBadge";
import PlusDialog from "./components/PlusDialog";
import { installDeepLinks } from "./lib/plus/deepLink";
import { startWidgetSnapshots } from "./lib/widgets";
import { usePlus } from "./lib/plus/usePlus";
import { dateLocale, deInt } from "./lib/format";
import type { GamesFilter } from "./lib/gameUi";
import { isMobilePreview, isStoreCapture } from "./lib/storeCapture";

export type { PageId };

const pageLoaders = {
  dashboard: () => import("./pages/Dashboard"),
  games: () => import("./pages/Games"),
  analysis: () => import("./pages/Analysis"),
  repertoire: () => import("./pages/Repertoire"),
  endgame: () => import("./pages/Endgame"),
  puzzles: () => import("./pages/Puzzles"),
  study: () => import("./pages/Study"),
  insights: () => import("./pages/InsightsV2"),
  settings: () => import("./pages/Settings"),
  support: () => import("./pages/Support"),
} satisfies Record<PageId, () => Promise<{ default: ComponentType<any> }>>;

const Dashboard = lazy(pageLoaders.dashboard);
const Games = lazy(pageLoaders.games);
const Analysis = lazy(pageLoaders.analysis);
const Repertoire = lazy(pageLoaders.repertoire);
const Endgame = lazy(pageLoaders.endgame);
const Puzzles = lazy(pageLoaders.puzzles);
const Study = lazy(pageLoaders.study);
const Insights = lazy(pageLoaders.insights);
const SettingsPage = lazy(pageLoaders.settings);
const Support = lazy(pageLoaders.support);
const Onboarding = lazy(() => import("./components/Onboarding"));

const LIKELY_NEXT_PAGES: Record<PageId, PageId[]> = {
  dashboard: ["games", "study"],
  games: ["analysis", "dashboard"],
  analysis: ["games", "insights"],
  repertoire: ["study", "games"],
  endgame: ["study", "puzzles"],
  puzzles: ["study", "analysis"],
  study: ["puzzles", "endgame"],
  insights: ["study", "analysis"],
  settings: ["support", "dashboard"],
  support: ["settings", "dashboard"],
};

function preloadLikelyPages(page: PageId): () => void {
  // Unit tests exercise lazy navigation itself; speculative imports would keep
  // resolving after assertions and create unrelated React act warnings.
  if (import.meta.env.MODE === "test") return () => {};
  const preload = () => LIKELY_NEXT_PAGES[page].forEach((target) => void pageLoaders[target]());
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(preload, { timeout: 2_000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(preload, 500);
  return () => globalThis.clearTimeout(id);
}

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
const BOTTOM_NAV: PageId[] = ["dashboard", "games", "analysis", "study", "insights"];
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
  const plus = usePlus();
  // Werbefreiheit ist eine Plus-Funktion · solange der Zustand noch geladen
  // wird, bleibt die Anzeige, wie sie war. Ein kurzes Auf- und Zuklappen des
  // Banners wäre auffälliger als eine halbe Sekunde später zu verschwinden.
  const showAds = !plus.has("no_ads");

  useEffect(() => preloadLikelyPages(page), [page]);

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
    if (backend.mode !== "desktop") return;
    const refresh = () => {
      dbStats().then((s) => setGameCount(s.total)).catch(() => {});
    };
    refresh();
    return onDataChange(refresh, ["games", "database"]);
  }, [backend.mode]);

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
  const mainRef = useRef<HTMLElement>(null);

  // Beide Shells behalten denselben Scroll-Container über alle Seiten hinweg.
  // Ohne Reset übernimmt der nächste Tab die Position des vorherigen und
  // beginnt dadurch irgendwo mitten im Inhalt · auf dem Desktop war das
  // besonders auffällig, weil die Seiten dort länger sind.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    main.scrollLeft = 0;
  }, [page]);

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
    let disposed = false;
    let stopImport = () => {};
    startReminders();
    import("./lib/autoImport")
      .then(({ startAutoImport, stopAutoImport }) => {
        if (disposed) return;
        startAutoImport();
        stopImport = stopAutoImport;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stopReminders();
      stopImport();
    };
  }, [backend.mode]);

  // Deep Links: `kiebitz://auth?code=…` aus dem Magic-Link der E-Mail und
  // `kiebitz://open?page=…` von den Android-Widgets. Die Einlösung der
  // Anmeldung passiert im Hintergrund; sichtbar wird sie dort, wo der
  // Kontostatus steht.
  useEffect(() => {
    if (backend.mode !== "desktop") return;
    return installDeepLinks({
      onSignedIn: () => logEvent("info", "plus", "Anmeldung über Deep-Link abgeschlossen"),
      onError: () => logEvent("warn", "plus", "Anmeldelink konnte nicht eingelöst werden"),
      onOpenPage: (page) => goTo(page),
    });
  }, [backend.mode, goTo]);

  // Datenstand der Android-Widgets · nur dort gibt es welche.
  useEffect(() => {
    if (backend.mode !== "desktop" || backend.info?.platform !== "android") return;
    return startWidgetSnapshots();
  }, [backend.mode, backend.info?.platform]);

  // Lebenszeichen der Nutzungsstatistik · höchstens eines pro Tag, und nur
  // solange sie nicht abgeschaltet ist. Es wartet auf `plus.loading`: Vorher
  // ist der Plus-Stand noch nicht aus der sicheren Ablage gelesen, und die
  // Stufe stünde als "free" in der Statistik, obwohl Plus aktiv ist. Der
  // Tagesriegel im Modul verhindert, dass ein späterer Wechsel ein zweites
  // Lebenszeichen auslöst.
  const info = backend.info;
  useEffect(() => {
    if (backend.mode !== "desktop" || !info || plus.loading) return;
    void import("./lib/analytics")
      .then(({ reportDailyHeartbeat }) =>
        reportDailyHeartbeat({
          platform: info.platform ?? "",
          distribution: info.distribution ?? "",
          version: info.version,
          plus: plus.isPlus,
        })
      )
      .catch(() => {});
  }, [backend.mode, info, plus.loading, plus.isPlus]);

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
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">Kiebitz</span>
            <PlanBadge />
          </div>
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
    <Suspense fallback={
      <div className="flex min-h-[40vh] items-center justify-center text-ink3" aria-busy="true">
        <Loader2 size={22} className="animate-spin text-accent" />
      </div>
    }>
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
    </Suspense>
  );

  const overlays = (
    <>
      <PlusDialog openSettings={() => navigate("settings")} />
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding
            settings={onboarding}
            onDone={(applied) => {
              setOnboarding(null);
              // Neue Konten sofort nutzen (Sprache steckt schon im Provider).
              void applied;
            }}
          />
        </Suspense>
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
          {/* Der Wrapper spannt genau die Fläche von <main> auf · darin legt
              sich das Detailblatt (MobileSheet) über den Inhalt, während
              App-Bar und Navigation scharf und bedienbar bleiben. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
              {mainContent}
            </main>
            <div
              id={SHEET_ROOT_ID}
              className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto"
            />
          </div>
          {showAds && <AdBanner android={backend.info?.platform === "android"} />}
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          <PlanBadge />
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
        ref={mainRef}
        className="min-w-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {mainContent}
      </main>

      {showAds && <AdBanner android={false} />}
      </div>

      {overlays}
    </div>
  );
}
