import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Check,
  ArchiveRestore,
  Bell,
  Compass,
  Cpu,
  Database,
  Download,
  HardDriveDownload,
  Globe,
  FolderOpen,
  LayoutGrid,
  LifeBuoy,
  Loader2,
  ExternalLink,
  Puzzle as PuzzleIcon,
  QrCode,
  RefreshCw,
  ScanLine,
  Scale,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useBackendInfo } from "../lib/backend";
import { useMobileShell } from "../components/MobileShell";
import { LOCALES, LOCALE_NAMES, useI18n, type Locale } from "../lib/i18n";
import {
  dbInfo,
  backupDatabase,
  factoryReset,
  formatBytes,
  getSettings,
  moveDatabase,
  refreshSettings,
  restoreDatabase,
  setSettings,
  testEngine,
  trainingDayList,
  trainingDayMask,
  useDatabase,
  type DbInfo,
  type EngineTest,
  type Settings,
} from "../lib/settings";
import { examplePaths } from "../lib/paths";
import {
  importPuzzles,
  onPuzzleImportDone,
  onPuzzleImportProgress,
  puzzleStats,
  importLabel,
  type PuzzleImportProgress,
  type PuzzleStats,
} from "../lib/puzzles";
import {
  checkUpdate,
  installUpdate,
  onUpdateState,
  type UpdateCheck,
  type UpdateState,
} from "../lib/updater";
import {
  scanPairingQr,
  syncDiscover,
  syncInfo,
  syncNow,
  syncPair,
  syncServerStart,
  type PairInfo,
  type SyncInfo,
} from "../lib/sync";
import { legalDocument, legalDocuments, type LegalDoc } from "../lib/legal";
import { openExternal } from "../lib/ext";
import { configureAutoSync, useSyncStatus } from "../lib/syncManager";
import { applyReminderSchedule, sendTestReminder } from "../lib/notify";
import { indexPositions } from "../lib/analysis";
import { playBoardSound, setBoardSoundEnabled, setBoardSoundVolume } from "../lib/sound";
import AppTour from "../components/AppTour";
import PlusSection from "./settings/PlusSection";
import { PlusBadgeButton } from "../components/PlusLock";
import { usePlus, usePlusGate } from "../lib/plus/usePlus";
import { openPlusDialog } from "../lib/plus/dialog";
import { Button, Chip } from "../components/ui";
import { dateLocale, deInt } from "../lib/format";
import { errorMessage } from "../lib/errors";
import { showAdPrivacyOptions } from "../lib/ads";
import { forgetHeartbeatDay, reportDailyHeartbeat } from "../lib/analytics";
import { publishWidgetSnapshot } from "../lib/widgets";
import {
  Field,
  NumberField,
  SectionNav,
  SettingsSection,
  WEEKDAY_KEYS,
  anchorId,
  inputCls,
  type Section,
  type SectionId,
} from "./settings/SettingsLayout";

export default function SettingsPage({
  openSupport,
}: {
  /** Öffnet die Rückmeldung · auf beiden Plattformen derselbe Weg. */
  openSupport?: (type?: "feedback" | "crash" | "feature") => void;
}) {
  const backend = useBackendInfo();
  const { locale, setLocale, t } = useI18n();
  const desktop = backend.mode === "desktop";

  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [engineResult, setEngineResult] = useState<EngineTest | null>(null);
  const [engineTesting, setEngineTesting] = useState(false);

  const [info, setInfo] = useState<DbInfo | null>(null);
  const [movePath, setMovePath] = useState("");
  const [usePath, setUsePath] = useState("");
  const [backupPath, setBackupPath] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbFeedback, setDbFeedback] = useState<{ error: boolean; text: string } | null>(null);

  const [updCheck, setUpdCheck] = useState<UpdateCheck | null>(null);
  const [updChecking, setUpdChecking] = useState(false);
  const [updState, setUpdState] = useState<UpdateState | null>(null);
  const [updError, setUpdError] = useState<string | null>(null);

  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const syncStatus = useSyncStatus();
  /** Mobile = Sync-Client; Desktop = Sync-Hub. */
  const mobile = backend.info?.platform === "android" || backend.info?.platform === "ios";
  const android = backend.info?.platform === "android";
  // Für das Layout zählt die Shell, nicht die Plattform · so lässt sich die
  // Android-Oberfläche in der Browser-Vorschau (?mobile-preview) ansehen.
  const compact = useMobileShell();
  const playStore = backend.info?.distribution === "play-store";
  const examplePath = useMemo(() => examplePaths(backend.info?.platform), [backend.info?.platform]);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Automatische lokale LAN-Synchronisierung ist eine Plus-Funktion. Das
  // Koppeln, der Hub und „Jetzt synchronisieren" bleiben frei · gesperrt ist
  // nur, dass Kiebitz das im Hintergrund von selbst tut.
  // Für die Stufe im Lebenszeichen der Statistik · dieselbe Quelle, aus der
  // auch die Freischaltungen unten kommen.
  const plus = usePlus();
  const autoSyncGate = usePlusGate("automatic_lan_sync");

  // Homescreen-Widgets · die Einrichtung ist zugleich einer der drei
  // strategischen Einstiege in den kostenlosen Test.
  const widgetGate = usePlusGate("widgets");
  const [widgetBusy, setWidgetBusy] = useState(false);
  const [widgetMsg, setWidgetMsg] = useState<string | null>(null);
  const refreshWidgets = async () => {
    setWidgetBusy(true);
    setWidgetMsg(null);
    try {
      await publishWidgetSnapshot();
      setWidgetMsg(t("set.widgetsRefreshed"));
    } catch (e) {
      setWidgetMsg(errorMessage(e));
    } finally {
      setWidgetBusy(false);
    }
  };

  // Die Tour aus der Ersteinrichtung, hier auf Zuruf. Sie hält keinen Zustand
  // und ändert nichts · deshalb reicht ein Schalter, kein Speichern.
  const [tourOpen, setTourOpen] = useState(false);

  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  const [adPrivacyBusy, setAdPrivacyBusy] = useState(false);
  const [adPrivacyMsg, setAdPrivacyMsg] = useState<string | null>(null);

  const [pz, setPz] = useState<PuzzleStats | null>(null);
  const [pzRunning, setPzRunning] = useState(false);
  const [pzProgress, setPzProgress] = useState<PuzzleImportProgress | null>(null);
  const [pzMsg, setPzMsg] = useState<string | null>(null);
  const [pzPath, setPzPath] = useState("");

  // Rechtstexte: Verzeichnis beim Öffnen des Bereichs, Volltext erst beim
  // Anzeigen · die Lizenzsammlung ist mehrere hundert Kilobyte groß.
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [legalShown, setLegalShown] = useState<LegalDoc | null>(null);
  const [legalText, setLegalText] = useState<string | null>(null);
  const [legalError, setLegalError] = useState<string | null>(null);

  // Welche Bereiche waren schon zu sehen? Nur deren Daten werden geholt: auf
  // dem Handy ist beim Öffnen alles zugeklappt, und die Abfragen dahinter
  // zählen Zeilen in Tabellen mit Millionen Einträgen.
  const [revealed, setRevealed] = useState<Partial<Record<SectionId, boolean>>>({});
  const reveal = useCallback((id: SectionId) => {
    setRevealed((current) => (current[id] ? current : { ...current, [id]: true }));
  }, []);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;

  /** Frischt eine Anzeige nur auf, wenn ihr Bereich überhaupt zu sehen war. */
  const refreshDbInfo = () => {
    if (revealedRef.current.database) dbInfo().then(setInfo).catch(() => {});
  };
  const refreshPuzzleStats = () => {
    if (revealedRef.current.puzzles) puzzleStats().then(setPz).catch(() => {});
  };

  useEffect(() => {
    if (!desktop) return;
    getSettings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((e) => setError(String(e)));
  }, [desktop]);

  useEffect(() => {
    if (!desktop || !revealed.database) return;
    dbInfo().then(setInfo).catch(() => {});
  }, [desktop, revealed.database]);

  useEffect(() => {
    if (!desktop || !revealed.sync) return;
    syncInfo().then(setSync).catch(() => {});
    // QR-Pairing-Infos nur auf dem Desktop-Hub (das Handy scannt sie nur).
    if (!mobile) syncPair().then(setPair).catch(() => {});
  }, [desktop, mobile, revealed.sync]);

  useEffect(() => {
    if (!desktop || !revealed.puzzles) return;
    puzzleStats()
      .then((s) => {
        setPz(s);
        setPzRunning(s.importing);
      })
      .catch(() => {});
  }, [desktop, revealed.puzzles]);

  useEffect(() => {
    if (!desktop || !revealed.about) return;
    legalDocuments().then(setLegalDocs).catch(() => {});
  }, [desktop, revealed.about]);

  // Puzzle-Import-Events (Import kann auch von der Puzzle-Seite laufen).
  useEffect(() => {
    if (!desktop) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    onPuzzleImportProgress((p) => {
      setPzRunning(true);
      setPzProgress(p);
    }).then((u) => (disposed ? u() : cleanups.push(u)));
    onPuzzleImportDone((p) => {
      setPzRunning(false);
      setPzMsg(
        p.error
          ? t("set.puzzleImportFailed", { e: p.error })
          : t("set.puzzleImportDone", { n: deInt(p.imported) })
      );
      refreshPuzzleStats();
      refreshDbInfo();
    }).then((u) => (disposed ? u() : cleanups.push(u)));
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [desktop, t]);

  // Update-Fortschritt (kommt auch vom Hintergrund-Check beim Start).
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | null = null;
    let disposed = false;
    onUpdateState((s) => {
      if (s.phase === "error") {
        setUpdState(null);
        setUpdError(s.error ?? "?");
      } else {
        setUpdState(s);
      }
    }).then((u) => (disposed ? u() : (dispose = u)));
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [desktop]);

  const dirty = useMemo(
    () => draft != null && saved != null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  const patch = (p: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const applied = await setSettings(draft);
      setSaved(applied);
      setDraft(applied);
      setLocale(applied.locale);
      // Die Klänge hängen an einem Modul, nicht an React · nach dem Speichern
      // müssen sie dem gespeicherten Stand entsprechen, auch wenn zwischendurch
      // am Schieber gedreht und dann abgebrochen wurde.
      setBoardSoundEnabled(applied.sound_enabled);
      setBoardSoundVolume(applied.sound_volume / 100);
      // Auto-Sync an die gespeicherten Werte anpassen (Mobile-Client).
      configureAutoSync({
        isMobile: mobile,
        syncAuto: applied.sync_auto,
        syncHost: applied.sync_host,
        lastSync: sync?.last_sync,
      });
      // Erinnerungen laufen über das Betriebssystem · Planung nachziehen.
      await applyReminderSchedule();
      // Der Schalter greift sofort. Der Tagesriegel fällt bei jedem Speichern:
      // Wurde die Statistik ab- und wieder angeschaltet, gilt eine neue
      // Kennung, für die heute noch nichts gemeldet wurde.
      forgetHeartbeatDay();
      if (applied.analytics_enabled && backend.info) {
        void reportDailyHeartbeat({
          platform: backend.info.platform ?? "",
          distribution: backend.info.distribution ?? "",
          version: backend.info.version,
          plus: plus.isPlus,
        }).catch(() => {});
      }
      setNotice(t("set.saved"));
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  /** Sprache wirkt sofort und wird (Desktop) direkt persistiert. */
  const switchLocale = async (l: Locale) => {
    setLocale(l);
    patch({ locale: l });
    if (desktop && saved) {
      try {
        const applied = await setSettings({ ...saved, locale: l });
        setSaved(applied);
      } catch (e) {
        setError(String(e));
      }
    }
  };

  // Der Regler klingt, während man ihn zieht · sonst stellt man eine
  // Lautstärke ein, ohne sie zu hören. Eine Sperre dazwischen hält es bei
  // einem Anschlag pro Bewegung statt einem pro Rasterschritt.
  const lastPreview = useRef(0);
  const previewBoardSound = () => {
    const now = Date.now();
    if (now - lastPreview.current < 180) return;
    lastPreview.current = now;
    playBoardSound("move");
  };

  const runEngineTest = async () => {
    setEngineTesting(true);
    setEngineResult(null);
    try {
      setEngineResult(await testEngine(draft?.engine_path ?? undefined));
    } catch (e) {
      setEngineResult({ ok: false, name: String(e), path: "" });
    } finally {
      setEngineTesting(false);
    }
  };

  const runDbAction = async (action: "move" | "use") => {
    const path = action === "move" ? movePath.trim() : usePath.trim();
    if (!path) return;
    setDbBusy(true);
    setError(null);
    setDbFeedback(null);
    try {
      const next = action === "move" ? await moveDatabase(path) : await useDatabase(path);
      setInfo(next);
      setMovePath("");
      setUsePath("");
      setNotice(
        action === "move"
          ? t("set.dbMoved", { path: next.path })
          : t("set.dbSwitched", { path: next.path })
      );
      setDbFeedback({
        error: false,
        text: action === "move" ? t("set.dbMoved", { path: next.path }) : t("set.dbSwitched", { path: next.path }),
      });
      // Einstellungen neu laden (db_path hat sich geändert).
      const s = await refreshSettings();
      setSaved(s);
      setDraft((d) => (d ? { ...d, db_path: s.db_path } : s));
      refreshPuzzleStats();
    } catch (e) {
      setError(String(e));
      setDbFeedback({ error: true, text: String(e) });
    } finally {
      setDbBusy(false);
    }
  };

  const runBackup = async () => {
    let target = backupPath.trim();
    if (!target) {
      const chosen = await saveDialog({
        defaultPath: "kiebitz-backup.db",
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!chosen) return;
      target = chosen.toLowerCase().endsWith(".db") ? chosen : `${chosen}.db`;
      setBackupPath(target);
    }
    setDbBusy(true);
    setError(null);
    setDbFeedback(null);
    try {
      const path = await backupDatabase(target);
      setBackupPath("");
      setNotice(t("set.dbBackupDone", { path }));
      setDbFeedback({ error: false, text: t("set.dbBackupDone", { path }) });
    } catch (e) {
      setError(String(e));
      setDbFeedback({ error: true, text: String(e) });
    } finally {
      setDbBusy(false);
    }
  };

  const runRestore = async () => {
    let source = restorePath.trim();
    if (!source) {
      const chosen = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (typeof chosen !== "string") return;
      source = chosen;
      setRestorePath(source);
    }
    if (!window.confirm(t("set.dbRestoreConfirm"))) return;
    setDbBusy(true);
    setError(null);
    setDbFeedback(null);
    try {
      const next = await restoreDatabase(source);
      setInfo(next);
      setRestorePath("");
      setNotice(t("set.dbRestoreDone", { path: next.path }));
      setDbFeedback({ error: false, text: t("set.dbRestoreDone", { path: next.path }) });
      refreshPuzzleStats();
    } catch (e) {
      setError(String(e));
      setDbFeedback({ error: true, text: String(e) });
    } finally {
      setDbBusy(false);
    }
  };

  const runUpdateCheck = async () => {
    setUpdChecking(true);
    setUpdError(null);
    setUpdCheck(null);
    try {
      setUpdCheck(await checkUpdate());
    } catch (e) {
      setUpdError(String(e));
    } finally {
      setUpdChecking(false);
    }
  };

  /** Desktop installiert direkt; Android öffnet die signierte APK im Browser. */
  const runUpdateInstall = () => {
    setUpdError(null);
    installUpdate().catch((e) => {
      setUpdState(null);
      setUpdError(String(e));
    });
  };

  /** Desktop: Server sofort starten; dauerhaft aktiv wird er über Speichern. */
  const enableSyncServer = async (on: boolean) => {
    patch({ sync_enabled: on });
    setSyncErr(null);
    if (on) {
      try {
        setSync(await syncServerStart());
      } catch (e) {
        setSyncErr(String(e));
      }
    }
  };

  /** Mobile: QR-Code des Desktops scannen und Adresse + Code übernehmen. */
  const runScan = async () => {
    setScanning(true);
    setSyncMsg(null);
    setSyncErr(null);
    try {
      const paired = await scanPairingQr();
      if (!paired) {
        setSyncErr(t("set.syncScanNoCode"));
        return;
      }
      patch({
        sync_host: paired.host,
        sync_code: paired.code,
        sync_fingerprint: paired.fingerprint,
      });
      setSyncMsg(t("set.syncScanDone"));
    } catch (e) {
      setSyncErr(
        String(e).includes("no-camera-permission")
          ? t("set.syncScanNoPermission")
          : t("set.syncScanFailed", { e: String(e) })
      );
    } finally {
      setScanning(false);
    }
  };

  /** Mobile: Desktop-Hub per UDP-Broadcast suchen und die Adresse eintragen. */
  const runDiscover = async () => {
    setDiscovering(true);
    setSyncErr(null);
    try {
      const addr = await syncDiscover();
      if (addr) patch({ sync_host: addr });
      else setSyncErr(t("set.syncDiscoverNone"));
    } catch (e) {
      setSyncErr(String(e));
    } finally {
      setDiscovering(false);
    }
  };

  /** Mobile: erst ungespeicherte Adresse/Code sichern, dann Sync-Roundtrip. */
  const runSync = async () => {
    setSyncBusy(true);
    setSyncMsg(null);
    setSyncErr(null);
    try {
      if (dirty && draft) {
        const applied = await setSettings(draft);
        setSaved(applied);
        setDraft(applied);
      }
      const s = await syncNow();
      setSyncMsg(
        t("set.syncDone", {
          g: deInt(s.games_pulled),
          r: deInt(s.rep_merged),
          o: deInt(s.own_puzzles_pulled),
          p: deInt(s.puzzle_attempts_pulled),
          e: deInt(s.endgame_attempts_pulled),
          s: deInt(s.study_merged),
        })
      );
      // Stellungsindex und Anzeigen im Hintergrund auffrischen.
      indexPositions().catch(() => {});
      syncInfo().then(setSync).catch(() => {});
      refreshDbInfo();
    } catch (e) {
      setSyncErr(String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  /** Alles zurücksetzen und die Oberfläche mit den Werkswerten neu laden. */
  const runFactoryReset = async () => {
    setResetBusy(true);
    setError(null);
    try {
      await factoryReset();
      const fresh = await refreshSettings();
      setSaved(fresh);
      setDraft(fresh);
      setLocale(fresh.locale);
      setResetOpen(false);
      refreshDbInfo();
      refreshPuzzleStats();
      setNotice(t("set.resetDone"));
    } catch (e) {
      setError(String(e));
    } finally {
      setResetBusy(false);
    }
  };

  /** Öffnet einen Rechtstext und lädt ihn erst dabei nach. */
  const showLegal = async (doc: LegalDoc) => {
    setLegalShown(doc);
    setLegalText(null);
    setLegalError(null);
    try {
      setLegalText(await legalDocument(doc.id));
    } catch (e) {
      setLegalError(String(e));
    }
  };

  /** Testerinnerung · holt bei Bedarf auch die Android-Systemberechtigung. */
  const runNotifyTest = async () => {
    setNotifyBusy(true);
    setNotifyMsg(null);
    try {
      await sendTestReminder();
      setNotifyMsg(t("set.notifySent"));
    } catch (e) {
      const message = errorMessage(e);
      setNotifyMsg(
        message.includes("permission-denied") ? t("set.notifyDenied") : message
      );
    } finally {
      setNotifyBusy(false);
    }
  };

  /** Android: den von Google UMP bereitgestellten Datenschutzdialog erneut öffnen. */
  const runAdPrivacyOptions = async () => {
    setAdPrivacyBusy(true);
    setAdPrivacyMsg(null);
    try {
      const result = await showAdPrivacyOptions();
      setAdPrivacyMsg(
        t(result.shown ? "set.adsPrivacyOpened" : "set.adsPrivacyUnavailable")
      );
    } catch (e) {
      setAdPrivacyMsg(errorMessage(e));
    } finally {
      setAdPrivacyBusy(false);
    }
  };

  const startPuzzleImport = (path?: string) => {
    setPzMsg(null);
    setPzProgress(null);
    setPzRunning(true);
    importPuzzles(path).catch((e) => {
      setPzRunning(false);
      setPzMsg(t("set.puzzleImportFailed", { e: String(e) }));
    });
  };

  // "pending" ist kein Web-Modus. Ebenso sind fehlende Settings in einer
  // erkannten Tauri-App kein Desktop-only-Fallback, sondern ein Ladezustand.
  const loading = backend.mode === "pending" || (desktop && !draft);

  // Sprungleiste: der Eintrag des Bereichs, der oben steht, ist hervorgehoben.
  // Scroll-Ereignisse steigen nicht auf, in der Capture-Phase am Dokument
  // erreichen sie uns trotzdem · egal welcher Container gerade scrollt.
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);
  useEffect(() => {
    if (compact || loading) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-settings-section]")
      );
      let current: SectionId | null = null;
      for (const node of nodes) {
        const id = node.dataset.settingsSection as SectionId | undefined;
        if (!id) continue;
        if (current === null || node.getBoundingClientRect().top <= 88) current = id;
      }
      setActiveSection(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [compact, loading]);

  const jumpTo = (id: SectionId) => {
    document.getElementById(anchorId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const desktopOnly = <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>;
  const sectionLoading = (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2.5 text-[12.5px] text-ink3">
      <Loader2 size={14} className="animate-spin text-accent" /> {t("common.loading")}
    </div>
  );

  // Die Reihenfolge dieser Liste ist die Reihenfolge auf beiden Plattformen:
  // oben, was man im Alltag anfasst, dahinter die Expertenbereiche. Sie füllt
  // auch die Sprungleiste, damit Verzeichnis und Seite nicht auseinanderlaufen.
  const sections: Section[] = [
    {
      id: "language",
      icon: Globe,
      title: t("set.language"),
      summary: t("set.languageSummary"),
      content: (
        <>
          {/* Jede Sprache steht in sich selbst · wer die App versehentlich auf
              Hindi gestellt hat, findet „Deutsch" auch dann noch. */}
          <div className="flex flex-wrap gap-2">
            {LOCALES.map((l) => (
              <Chip key={l} active={locale === l} onClick={() => switchLocale(l)}>
                <span lang={l}>{LOCALE_NAMES[l]}</span>
              </Chip>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">
            {t(desktop ? "set.langNoteApp" : "set.langNote")}
          </p>
        </>
      ),
    },
    {
      // Direkt hinter der Sprache: Beides ist "ich bin hier neu" und nicht der
      // tägliche Griff. Wer die Ersteinrichtung weggeklickt hat, findet die
      // Erklärung damit an der ersten Stelle, an der er nachsieht.
      id: "tour",
      icon: Compass,
      title: t("set.tour"),
      summary: t("set.tourSummary"),
      content: (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.tourNote")}</p>
          <div className="mt-3">
            <Button primary onClick={() => setTourOpen(true)}>
              <Compass size={14} /> {t("set.tourOpen")}
            </Button>
          </div>
        </>
      ),
    },
    {
      // Konto und Freischaltung stehen vor den Schachkonten: Wer nach „Plus"
      // sucht, sucht hier, und der Trial-Einstieg gehört an eine Stelle, die
      // man ohne Suchen findet.
      id: "plus",
      icon: Sparkles,
      title: t("plus.title"),
      summary: t("plus.summary"),
      content: <PlusSection />,
    },
    {
      id: "accounts",
      icon: UserRound,
      title: t("set.accounts"),
      summary: t("set.accountsSummary"),
      content:
        desktop && draft ? (
          <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-3">
            <Field label={t("set.displayName")}>
              <input
                value={draft.display_name}
                onChange={(e) => patch({ display_name: e.target.value })}
                placeholder={draft.cc_user || draft.li_user}
                className={inputCls}
              />
            </Field>
            <Field label={t("set.ccUser")}>
              <input
                value={draft.cc_user}
                onChange={(e) => patch({ cc_user: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label={t("set.liUser")}>
              <input
                value={draft.li_user}
                onChange={(e) => patch({ li_user: e.target.value })}
                className={inputCls}
              />
            </Field>
            <NumberField
              label={t("set.importMonths")}
              value={draft.import_months}
              min={1}
              max={240}
              onChange={(v) => patch({ import_months: v })}
            />
            <NumberField
              label={t("set.puzzleGoal")}
              value={draft.puzzle_goal}
              min={1}
              max={200}
              onChange={(v) => patch({ puzzle_goal: v })}
            />
            <NumberField
              label={t("set.repDueLimit")}
              value={draft.rep_due_limit}
              min={0}
              max={500}
              onChange={(v) => patch({ rep_due_limit: v })}
            />
            <NumberField
              label={t("set.repNewLimit")}
              value={draft.rep_new_limit}
              min={0}
              max={500}
              onChange={(v) => patch({ rep_new_limit: v })}
            />
            <p className="text-[12px] leading-relaxed text-ink3 min-[640px]:col-span-3">
              {t("set.repLimitNote")}
            </p>

            {/* Trainingsprogramm · drei Felder, kein Fragebogen. Alles Weitere
                leitet der Lernplan aus der tatsächlichen Aktivität ab. */}
            {/* Ein leeres Zahlenfeld ist für neue Nutzer keine Frage, sondern
                eine Zumutung · die drei Vorgaben decken den üblichen Bereich
                ab und lassen sich weiter frei überschreiben. */}
            <Field label={t("set.weeklyMinutes")}>
              <div className="flex flex-wrap gap-1.5">
                {[90, 180, 300].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => patch({ weekly_minutes: minutes })}
                    className={`rounded-md border px-2.5 py-1 text-[12px] tabular-nums transition-colors ${
                      draft.weekly_minutes === minutes
                        ? "border-accent-dim bg-accent-soft text-accent"
                        : "border-line text-ink3 hover:text-ink"
                    }`}
                  >
                    {t("plan.minutes", { m: minutes })}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={0}
                max={3000}
                value={draft.weekly_minutes}
                aria-label={t("set.budgetCustom")}
                onChange={(e) =>
                  patch({ weekly_minutes: Math.max(0, Math.min(3000, Number(e.target.value))) })
                }
                className={`mt-2 ${inputCls}`}
              />
            </Field>
            <Field label={t("set.focusCycle")}>
              <select
                value={draft.focus_cycle_days}
                onChange={(e) => patch({ focus_cycle_days: Number(e.target.value) })}
                className={inputCls}
              >
                {[7, 14, 28].map((days) => (
                  <option key={days} value={days}>
                    {t("set.focusCycleDays", { n: days })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("set.goalDate")}>
              <input
                type="date"
                value={draft.goal_date}
                onChange={(e) => patch({ goal_date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label={t("set.trainingDays")} className="min-[640px]:col-span-3">
              <div className="flex flex-wrap gap-1.5">
                {trainingDayList(draft.training_days).map((active, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      const days = trainingDayList(draft.training_days);
                      days[index] = !days[index];
                      patch({ training_days: trainingDayMask(days) });
                    }}
                    className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                      active
                        ? "border-accent-dim bg-accent-soft text-accent"
                        : "border-line text-ink3 hover:text-ink"
                    }`}
                  >
                    {t(WEEKDAY_KEYS[index])}
                  </button>
                ))}
              </div>
            </Field>
            <p className="text-[12px] leading-relaxed text-ink3 min-[640px]:col-span-3">
              {t("set.trainingNote")}
            </p>
            <label className="flex cursor-pointer items-start gap-3 min-[640px]:col-span-3">
              <input
                type="checkbox"
                checked={draft.auto_import}
                onChange={(e) => patch({ auto_import: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[#22c08a]"
              />
              <span>
                <span className="block text-[13px] text-ink">{t("set.autoImportToggle")}</span>
                <span className="block text-[12px] leading-relaxed text-ink3">{t("set.autoImportNote")}</span>
              </span>
            </label>
            <p className="text-[12px] leading-relaxed text-ink3 min-[640px]:col-span-3">
              {t("set.importMonthsNote", { n: draft.import_months })}
            </p>
          </div>
        ) : (
          desktopOnly
        ),
    },
    {
      // Brett & Ton · Zug- und Schlagklänge auf allen Brettern.
      id: "sound",
      icon: Volume2,
      title: t("set.sound"),
      summary: t("set.soundSummary"),
      content:
        desktop && draft ? (
          <>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={draft.sound_enabled}
                onChange={(e) => {
                  patch({ sound_enabled: e.target.checked });
                  setBoardSoundEnabled(e.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-[#22c08a]"
              />
              <span>
                <span className="block text-[13px] text-ink">{t("set.soundToggle")}</span>
                <span className="block text-[12px] leading-relaxed text-ink3">
                  {t("set.soundNote")}
                </span>
              </span>
            </label>
            <div className="mt-4">
              <label className="flex items-center gap-3">
                <span className="shrink-0 text-[12px] text-ink3">{t("set.soundVolume")}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draft.sound_volume}
                  disabled={!draft.sound_enabled}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    patch({ sound_volume: value });
                    setBoardSoundVolume(value / 100);
                    previewBoardSound();
                  }}
                  className="min-w-0 flex-1 accent-[#22c08a] disabled:opacity-40"
                />
                <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-ink2">
                  {draft.sound_volume} %
                </span>
              </label>
              <p className="mt-2 text-[12px] leading-relaxed text-ink3">
                {t("set.soundVolumeNote")}
              </p>
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-line pt-4">
              <input
                type="checkbox"
                checked={draft.puzzle_hide_theme}
                onChange={(e) => patch({ puzzle_hide_theme: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-[#22c08a]"
              />
              <span>
                <span className="block text-[13px] text-ink">{t("set.puzzleHideTheme")}</span>
                <span className="block text-[12px] leading-relaxed text-ink3">
                  {t("set.puzzleHideThemeNote")}
                </span>
              </span>
            </label>
          </>
        ) : (
          desktopOnly
        ),
    },
    {
      id: "notify",
      icon: Bell,
      title: t("set.notify"),
      summary: t("set.notifySummary"),
      content:
        desktop && draft ? (
          <>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={draft.notify_enabled}
                onChange={(e) => patch({ notify_enabled: e.target.checked })}
                className="h-4 w-4 accent-[#22c08a]"
              />
              <span className="text-[13px] text-ink">{t("set.notifyToggle")}</span>
            </label>
            <div className="mt-4 grid grid-cols-1 gap-3 min-[640px]:grid-cols-[160px_minmax(0,1fr)] min-[640px]:items-end">
              <Field label={t("set.notifyTime")}>
                <input
                  type="time"
                  value={draft.notify_time}
                  onChange={(e) => patch({ notify_time: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => !notifyBusy && runNotifyTest()}>
                  {notifyBusy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                  {t("set.notifyTest")}
                </Button>
                {notifyMsg && <span className="text-[12px] text-ink3">{notifyMsg}</span>}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 min-[640px]:grid-cols-2">
              {(
                [
                  ["notify_study", t("set.notifyStudy")],
                  ["notify_repertoire", t("set.notifyRepertoire")],
                  ["notify_puzzles", t("set.notifyPuzzles")],
                  ["notify_endgame", t("set.notifyEndgame")],
                  ["notify_analysis", t("set.notifyAnalysis")],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    disabled={!draft.notify_enabled}
                    onChange={(e) => patch({ [key]: e.target.checked })}
                    className="h-4 w-4 accent-[#22c08a] disabled:opacity-40"
                  />
                  <span className={`text-[13px] ${draft.notify_enabled ? "text-ink" : "text-ink3"}`}>{label}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.notifyNote")}</p>
          </>
        ) : (
          desktopOnly
        ),
    },
    {
      // Homescreen-Widgets · ausdrücklich nur Android. Für den Desktop sind
      // keine geplant, und das steht hier auch so.
      id: "widgets",
      icon: LayoutGrid,
      title: t("set.widgets"),
      summary: t("set.widgetsSummary"),
      content: android ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.widgetsNote")}</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] text-ink2">
            {(["set.widgetToday", "set.widgetWeek", "set.widgetQuick"] as const).map((key) => (
              <li key={key} className="flex items-baseline gap-2">
                <span className="text-accent">·</span>
                {t(key)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.widgetsHowTo")}</p>
          {!widgetGate.unlocked && !widgetGate.pending && (
            <div className="mt-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-accent">
              {t("plus.previewHint")}
              <div className="mt-2">
                <Button primary onClick={() => openPlusDialog("widgets")}>
                  <Sparkles size={14} /> {t("plus.startTrial")}
                </Button>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={refreshWidgets} disabled={widgetBusy}>
              {widgetBusy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("set.widgetsRefresh")}
            </Button>
            {widgetMsg && <span className="text-[12px] text-ink3">{widgetMsg}</span>}
          </div>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-ink3">{t("set.widgetsDesktop")}</p>
      ),
    },
    {
      id: "sync",
      icon: Smartphone,
      title: t("set.sync"),
      summary: t("set.syncSummary"),
      content:
        desktop && draft ? (
          !mobile ? (
            <>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.sync_enabled}
                  onChange={(e) => enableSyncServer(e.target.checked)}
                  className="h-4 w-4 accent-[#22c08a]"
                />
                <span className="text-[13px] text-ink">{t("set.syncEnableToggle")}</span>
              </label>
              {sync ? (
                <div className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2.5 text-[12.5px]">
                  <div className="flex items-center gap-2 text-ink2">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: sync.running ? "var(--color-win)" : "var(--color-draw)" }}
                    />
                    {sync.running && sync.addr
                      ? t("set.syncServerRunning", { addr: sync.addr })
                      : t("set.syncServerStopped")}
                  </div>
                  <div className="mt-1.5 text-ink3">
                    {t("set.syncCode")}:{" "}
                    <span className="font-mono text-[14px] font-semibold tracking-[0.2em] text-ink">
                      {sync.code}
                    </span>
                  </div>
                  <div className="mt-1.5 break-all font-mono text-[10.5px] text-ink3">
                    {t("set.syncFingerprint")}: {sync.fingerprint}
                  </div>
                </div>
              ) : (
                <div className="mt-3">{sectionLoading}</div>
              )}
              {pair && (
                <div className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-3">
                  <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink2">
                    <QrCode size={14} className="text-accent" /> {t("set.syncPairTitle")}
                  </div>
                  <div className="flex flex-col items-start gap-3 min-[420px]:flex-row min-[420px]:items-center">
                    <img
                      src={`data:image/svg+xml;utf8,${encodeURIComponent(pair.qr_svg)}`}
                      alt="Kiebitz Sync QR"
                      width={148}
                      height={148}
                      className="h-[148px] w-[148px] shrink-0 rounded-md bg-white p-1.5"
                    />
                    <p className="text-[12px] leading-relaxed text-ink3">{t("set.syncQrHint")}</p>
                  </div>
                </div>
              )}
              {syncErr && (
                <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12.5px] text-loss">
                  {t("set.syncFailed", { e: syncErr })}
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.syncDesktopNote")}</p>
            </>
          ) : (
            <>
              <Button primary onClick={() => !scanning && runScan()}>
                {scanning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> {t("set.syncScanning")}
                  </>
                ) : (
                  <>
                    <ScanLine size={14} /> {t("set.syncScanQr")}
                  </>
                )}
              </Button>
              <div className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink3">
                <span className="h-px flex-1 bg-line" />
                {t("set.syncOr")}
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
                <Field label={t("set.syncHostLabel")}>
                  <div className="flex gap-2">
                    <input
                      value={draft.sync_host}
                      onChange={(e) => patch({ sync_host: e.target.value })}
                      placeholder="192.168.1.5:47323"
                      className={inputCls}
                    />
                    <Button onClick={() => !discovering && runDiscover()}>
                      {discovering ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        t("set.syncDiscover")
                      )}
                    </Button>
                  </div>
                </Field>
                <Field label={t("set.syncCodeLabel")}>
                  <input
                    value={draft.sync_code}
                    onChange={(e) => patch({ sync_code: e.target.value })}
                    placeholder="123456"
                    className={inputCls}
                  />
                </Field>
                <Field label={t("set.syncFingerprintLabel")}>
                  <input
                    value={draft.sync_fingerprint}
                    onChange={(e) => patch({ sync_fingerprint: e.target.value })}
                    placeholder="SHA-256"
                    className={inputCls}
                  />
                </Field>
              </div>
              {/* Der Sync selbst bleibt frei · nur das automatische Anstoßen
                  im Hintergrund gehört zu Plus. Von Hand synchronisieren kann
                  jede Installation weiterhin. */}
              {/* Der Hinweis steht neben dem Schalter, nicht in seiner
                  Beschriftung: In einem `label` würde jeder Klick auf den
                  Hinweis zusätzlich den Schalter treffen. */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label
                  className={`flex items-center gap-3 ${
                    autoSyncGate.unlocked ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={draft.sync_auto && autoSyncGate.unlocked}
                    disabled={!autoSyncGate.unlocked && !autoSyncGate.pending}
                    onChange={(e) => patch({ sync_auto: e.target.checked })}
                    className="h-4 w-4 accent-[#22c08a] disabled:opacity-45"
                  />
                  <span className="text-[13px] text-ink">{t("set.syncAutoToggle")}</span>
                </label>
                {!autoSyncGate.unlocked && !autoSyncGate.pending && (
                  <PlusBadgeButton feature="automatic_lan_sync" />
                )}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink3">
                {t("set.syncAutoNote")}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button primary onClick={() => !syncBusy && runSync()}>
                  {syncBusy ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> {t("set.syncing")}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={14} /> {t("set.syncNow")}
                    </>
                  )}
                </Button>
                <span className="text-[12px] text-ink3">
                  {sync && sync.last_sync > 0
                    ? t("set.syncLast", {
                        d: new Date(sync.last_sync * 1000).toLocaleString(dateLocale()),
                      })
                    : t("set.syncNever")}
                </span>
              </div>
              {syncMsg && (
                <div className="mt-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
                  {syncMsg}
                </div>
              )}
              {syncErr && (
                <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12.5px] text-loss">
                  {t("set.syncFailed", { e: syncErr })}
                </div>
              )}
              {/* Der laufende Zustand des Auto-Sync · früher hing er in der
                  mobilen Navigation, die es nicht mehr gibt. */}
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink2">
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
                {!syncStatus.active
                  ? t("set.syncAutoOff")
                  : syncStatus.phase === "syncing"
                    ? t("app.syncing")
                    : syncStatus.phase === "error"
                      ? t("app.syncOffline")
                      : syncStatus.lastSync > 0
                        ? t("app.syncedAt", {
                            t: new Date(syncStatus.lastSync * 1000).toLocaleTimeString(
                              dateLocale()
                            ),
                          })
                        : t("app.synced")}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.syncMobileNote")}</p>
            </>
          )
        ) : (
          desktopOnly
        ),
    },
    {
      id: "updates",
      icon: RefreshCw,
      title: t("set.updates"),
      summary: t("set.updatesSummary"),
      content:
        desktop && draft ? (
          playStore ? (
            <>
              <span className="text-[12px] text-ink3">
                {t("set.updateCurrent", { v: backend.info?.version ?? "?" })}
              </span>
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">
                {t("set.updatePlayNote")}
              </p>
            </>
          ) : (
            <>
              {!mobile && (
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.auto_update}
                    onChange={(e) => patch({ auto_update: e.target.checked })}
                    className="h-4 w-4 accent-[#22c08a]"
                  />
                  <span className="text-[13px] text-ink">{t("set.autoUpdateToggle")}</span>
                </label>
              )}
              <div className={`${mobile ? "" : "mt-4"} flex items-center gap-3`}>
                <Button onClick={() => !updChecking && !updState && runUpdateCheck()}>
                  {updChecking ? <Loader2 size={14} className="animate-spin" /> : t("set.updateCheck")}
                </Button>
                <span className="text-[12px] text-ink3">
                  {t("set.updateCurrent", { v: backend.info?.version ?? "?" })}
                </span>
              </div>
              {updState && (
                <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink2">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  {updState.phase === "installing"
                    ? t("set.updateInstalling")
                    : t("set.updateDownloading", {
                        v: updState.version,
                        p: updState.total
                          ? `${Math.round((updState.received / updState.total) * 100)} %`
                          : formatBytes(updState.received),
                      })}
                </div>
              )}
              {!updState && updError && (
                <div className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12.5px] text-loss">
                  {t("set.updateFailed", { e: updError })}
                </div>
              )}
              {!updState && !updError && updCheck && (
                <div
                  className={`mt-3 rounded-lg px-3 py-2 text-[12.5px] ${
                    updCheck.available
                      ? "border border-gold/40 bg-[#2a2414] text-gold"
                      : "border border-accent-dim bg-accent-soft text-accent"
                  }`}
                >
                  {updCheck.available ? (
                    <div className="flex flex-col gap-2">
                      <span>{t("set.updateAvailable", { v: updCheck.available })}</span>
                      {updCheck.notes && (
                        <span className="whitespace-pre-wrap text-[12px] text-ink2">{updCheck.notes}</span>
                      )}
                      <div>
                        <Button primary onClick={runUpdateInstall}>
                          <Download size={14} /> {t(mobile ? "set.updateInstallMobile" : "set.updateInstall")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    t("set.updateUpToDate", { v: updCheck.current })
                  )}
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">
                {t(mobile ? "set.updateMobileNote" : "set.autoUpdateNote")}
              </p>
            </>
          )
        ) : (
          desktopOnly
        ),
    },
    {
      id: "privacy",
      icon: ShieldCheck,
      title: t("set.adsPrivacy"),
      summary: t("set.adsPrivacySummary"),
      content: (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink2">
            {t(android ? "set.adsPrivacyNote" : "set.adsPrivacyDesktopNote")}
          </p>
          {android && (
            <div className="mt-3">
              <Button onClick={() => !adPrivacyBusy && runAdPrivacyOptions()}>
                {adPrivacyBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                {t("set.adsPrivacyOpen")}
              </Button>
              {adPrivacyMsg && (
                <p className="mt-2 text-[12px] leading-relaxed text-ink3">{adPrivacyMsg}</p>
              )}
            </div>
          )}
          {draft && (
            <div className="mt-5 border-t border-line pt-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.analytics_enabled}
                  onChange={(e) => patch({ analytics_enabled: e.target.checked })}
                  className="h-4 w-4 accent-[#22c08a]"
                />
                <span className="text-[13px] text-ink">{t("set.analyticsToggle")}</span>
              </label>
            </div>
          )}
        </>
      ),
    },
    {
      // Rückmeldung · eigene Seite, hier nur der Einstieg.
      id: "support",
      icon: LifeBuoy,
      title: t("set.support"),
      summary: t("set.supportSummary"),
      content: (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.supportNote")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button primary onClick={() => openSupport?.("feedback")}>
              <LifeBuoy size={14} /> {t("set.supportOpen")}
            </Button>
            <Button onClick={() => openSupport?.("crash")}>
              <AlertTriangle size={14} /> {t("set.supportCrash")}
            </Button>
          </div>
          {mobile && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.supportShake")}</p>
          )}
        </>
      ),
    },
    {
      id: "engine",
      icon: Cpu,
      title: t("set.engine"),
      summary: t("set.engineSummary"),
      advanced: true,
      content:
        desktop && draft ? (
          <>
            <Field label={t("set.enginePath")}>
              <div className="flex gap-2">
                <input
                  value={draft.engine_path ?? ""}
                  onChange={(e) => patch({ engine_path: e.target.value || null })}
                  placeholder={examplePath.engine}
                  className={inputCls}
                />
                <Button onClick={runEngineTest}>
                  {engineTesting ? <Loader2 size={14} className="animate-spin" /> : t("set.engineTest")}
                </Button>
              </div>
            </Field>
            {engineResult && (
              <div
                className={`mt-2 rounded-lg px-3 py-2 text-[12.5px] ${
                  engineResult.ok
                    ? "border border-accent-dim bg-accent-soft text-accent"
                    : "border border-[#8a3535] bg-[#2a1414] text-loss"
                }`}
              >
                {engineResult.ok
                  ? t("set.engineOk", { name: engineResult.name })
                  : t("set.engineFail", { name: engineResult.name })}
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 min-[640px]:grid-cols-5">
              <NumberField
                label={t("set.threads")}
                value={draft.engine_threads}
                min={0}
                max={128}
                onChange={(v) => patch({ engine_threads: v })}
              />
              <NumberField
                label={t("set.hash")}
                value={draft.engine_hash_mb}
                min={16}
                max={512}
                onChange={(v) => patch({ engine_hash_mb: v })}
              />
              <NumberField
                label={t("set.multipv")}
                value={draft.engine_multipv}
                min={1}
                max={3}
                onChange={(v) => patch({ engine_multipv: v })}
              />
              <NumberField
                label={t("set.liveDepth")}
                value={draft.live_depth}
                min={8}
                max={40}
                onChange={(v) => patch({ live_depth: v })}
              />
              <NumberField
                label={t("set.batchDepth")}
                value={draft.batch_depth}
                min={6}
                max={30}
                onChange={(v) => patch({ batch_depth: v })}
              />
            </div>
            <div className="mt-4">
              <Field label={t("set.syzygyPath")}>
                <input
                  value={draft.syzygy_path ?? ""}
                  onChange={(e) => patch({ syzygy_path: e.target.value || null })}
                  placeholder={examplePath.syzygy}
                  className={inputCls}
                />
              </Field>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink3">{t("set.syzygyNote")}</p>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.engineNote")}</p>
          </>
        ) : (
          desktopOnly
        ),
    },
    {
      id: "database",
      icon: Database,
      title: t("set.database"),
      summary: t("set.databaseSummary"),
      advanced: true,
      content: desktop ? (
        <>
          {info ? (
            <div className="rounded-lg border border-line bg-panel2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[12px] text-ink2">{info.path}</span>
                {info.is_default && (
                  <span className="shrink-0 rounded-full bg-panel3 px-2 py-0.5 text-[10.5px] text-ink3">
                    {t("set.dbDefaultTag")}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] text-ink3">
                {t("set.dbSize", {
                  size: formatBytes(info.size_bytes),
                  games: deInt(info.games),
                  puzzles: deInt(info.puzzles),
                })}
              </div>
            </div>
          ) : (
            sectionLoading
          )}
          <div className="mt-4 flex flex-col gap-3">
            <Field label={t("set.dbMoveLabel")}>
              <div className="flex gap-2">
                <input
                  value={movePath}
                  onChange={(e) => setMovePath(e.target.value)}
                  placeholder={examplePath.db}
                  className={inputCls}
                />
                <Button onClick={() => !dbBusy && runDbAction("move")}>
                  {dbBusy ? <Loader2 size={14} className="animate-spin" /> : t("set.dbMove")}
                </Button>
              </div>
            </Field>
            <Field label={t("set.dbUseLabel")}>
              <div className="flex gap-2">
                <input
                  value={usePath}
                  onChange={(e) => setUsePath(e.target.value)}
                  placeholder={examplePath.db}
                  className={inputCls}
                />
                <Button onClick={() => !dbBusy && runDbAction("use")}>
                  {dbBusy ? <Loader2 size={14} className="animate-spin" /> : t("set.dbUse")}
                </Button>
              </div>
            </Field>
            <div className="my-1 border-t border-line" />
            <Field label={t("set.dbBackupLabel")}>
              <div className="flex gap-2">
                <input value={backupPath} onChange={(e) => setBackupPath(e.target.value)} placeholder={examplePath.backup} className={inputCls} />
                <Button onClick={async () => {
                  const chosen = await saveDialog({ defaultPath: "kiebitz-backup.db", filters: [{ name: "SQLite database", extensions: ["db"] }] });
                  if (chosen) setBackupPath(chosen.toLowerCase().endsWith(".db") ? chosen : `${chosen}.db`);
                }}>
                  <FolderOpen size={14} /> {t("set.dbChooseTarget")}
                </Button>
                <Button onClick={() => !dbBusy && runBackup()}>
                  {dbBusy ? <Loader2 size={14} className="animate-spin" /> : <HardDriveDownload size={14} />} {t("set.dbBackup")}
                </Button>
              </div>
            </Field>
            <Field label={t("set.dbRestoreLabel")}>
              <div className="flex gap-2">
                <input value={restorePath} onChange={(e) => setRestorePath(e.target.value)} placeholder={examplePath.backup} className={inputCls} />
                <Button onClick={async () => {
                  const chosen = await openDialog({ multiple: false, directory: false, filters: [{ name: "SQLite database", extensions: ["db"] }] });
                  if (typeof chosen === "string") setRestorePath(chosen);
                }}>
                  <FolderOpen size={14} /> {t("set.dbChooseFile")}
                </Button>
                <Button onClick={() => !dbBusy && runRestore()}>
                  {dbBusy ? <Loader2 size={14} className="animate-spin" /> : <ArchiveRestore size={14} />} {t("set.dbRestore")}
                </Button>
              </div>
            </Field>
            {dbFeedback && (
              <div className={`rounded-lg border px-3 py-2 text-[12.5px] ${dbFeedback.error ? "border-[#8a3535] bg-[#2a1414] text-loss" : "border-accent-dim bg-accent-soft text-accent"}`}>
                {dbFeedback.text}
              </div>
            )}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.dbNote")}</p>
        </>
      ) : (
        desktopOnly
      ),
    },
    {
      id: "chessdb",
      icon: Globe,
      title: t("set.chessdb"),
      summary: t("set.chessdbSummary"),
      advanced: true,
      content:
        desktop && draft ? (
          <>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={draft.chessdb_enabled}
                onChange={(e) => patch({ chessdb_enabled: e.target.checked })}
                className="h-4 w-4 accent-[#22c08a]"
              />
              <span className="text-[13px] text-ink">{t("set.chessdbToggle")}</span>
            </label>
            <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.chessdbNote")}</p>
          </>
        ) : (
          desktopOnly
        ),
    },
    {
      id: "puzzles",
      icon: PuzzleIcon,
      title: t("set.puzzleDb"),
      summary: t("set.puzzleDbSummary"),
      advanced: true,
      content: desktop ? (
        <>
          {pz ? (
            <div className="text-[13px] text-ink2">
              {t("set.puzzleCount", { n: deInt(pz.db_total) })}
              <span className="ml-2 text-[12px] text-ink3">
                ·{" "}
                {pz.imported_at
                  ? t("set.puzzleImportedAt", {
                      date: new Date(pz.imported_at * 1000).toLocaleDateString(dateLocale()),
                    })
                  : t("set.puzzleNever")}
              </span>
            </div>
          ) : (
            sectionLoading
          )}
          {pzRunning ? (
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink2">
              <Loader2 size={14} className="animate-spin text-accent" />
              {importLabel(pzProgress, t)}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {pz?.import_resumable && (
                <p className="text-[12px] leading-relaxed text-ink3">{t("pz.resumeNote")}</p>
              )}
              <div>
                <Button onClick={() => startPuzzleImport()}>
                  <Download size={14} />{" "}
                  {t(pz?.import_resumable ? "pz.resumeImport" : "set.puzzleReimport")}
                </Button>
              </div>
              <Field label={t("set.puzzleFromFile")}>
                <div className="flex gap-2">
                  <input
                    value={pzPath}
                    onChange={(e) => setPzPath(e.target.value)}
                    placeholder={examplePath.puzzleDump}
                    className={inputCls}
                  />
                  <Button onClick={() => pzPath.trim() && startPuzzleImport(pzPath.trim())}>
                    {t("common.import")}
                  </Button>
                </div>
              </Field>
            </div>
          )}
          {pzMsg && (
            <div className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12.5px] text-ink2">
              {pzMsg}
            </div>
          )}
        </>
      ) : (
        desktopOnly
      ),
    },
    {
      // Über Kiebitz · Lizenz der App und die mitgelieferten Rechtstexte.
      // Die Bibliothekslizenzen verlangen, dass ihr Text das Binary
      // begleitet; hier ist die Stelle, an der er erreichbar ist.
      id: "about",
      icon: Scale,
      title: t("set.about"),
      summary: t("set.aboutSummary"),
      advanced: true,
      content: (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink2">
            <span className="font-medium text-ink">
              {t("set.aboutVersion", {
                v: backend.info?.version ?? "?",
                p: backend.info?.platform ?? "web",
              })}
            </span>
            <button
              type="button"
              onClick={() => openExternal("https://kiebitz.dev/")}
              className="inline-flex items-center gap-1 text-accent transition-colors hover:text-ink"
            >
              <ExternalLink size={12} /> {t("set.aboutWebsite")}
            </button>
            <button
              type="button"
              onClick={() => openExternal("https://github.com/Torim98/Kiebitz")}
              className="inline-flex items-center gap-1 text-accent transition-colors hover:text-ink"
            >
              <ExternalLink size={12} /> {t("set.aboutRepo")}
            </button>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.aboutNote")}</p>

          <div className="mt-4 border-t border-line pt-3">
            <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink3">
              {t("set.aboutSupport")}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink3">
              {t("set.aboutSupportNote")}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => openExternal("https://github.com/sponsors/Torim98")}
                className="inline-flex items-center gap-1 text-[12.5px] text-accent transition-colors hover:text-ink"
              >
                <ExternalLink size={12} /> {t("set.aboutSupportGithub")}
              </button>
              <button
                type="button"
                onClick={() => openExternal("https://ko-fi.com/kiebitzchess")}
                className="inline-flex items-center gap-1 text-[12.5px] text-accent transition-colors hover:text-ink"
              >
                <ExternalLink size={12} /> {t("set.aboutSupportKofi")}
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-ink3">
              {t("set.legal")}
            </div>
            {legalDocs.length ? (
              <>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {legalDocs.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2 px-3 py-2"
                    >
                      <span className="min-w-0 text-[12.5px] text-ink2">
                        <span className="block truncate">{doc.title}</span>
                        <span className="text-[11px] text-ink3">
                          {t("set.legalSize", { n: Math.max(1, Math.round(doc.bytes / 1024)) })}
                        </span>
                      </span>
                      <Button onClick={() => showLegal(doc)}>{t("set.legalOpen")}</Button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.legalNote")}</p>
              </>
            ) : (
              <p className="mt-2 text-[12.5px] text-ink3">{t("set.legalMissing")}</p>
            )}
          </div>
        </>
      ),
    },
    {
      // Zurücksetzen · bewusst ganz unten und in Warnfarbe.
      id: "reset",
      icon: AlertTriangle,
      title: t("set.reset"),
      summary: t("set.resetSummary"),
      tone: "loss",
      advanced: true,
      content: desktop ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink2">{t("set.resetNote")}</p>
          <button
            type="button"
            disabled={resetBusy}
            onClick={() => setResetOpen(true)}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#713636] bg-[#251515] px-3.5 py-2 text-[12.5px] font-medium text-loss transition-colors hover:border-[#a64b4b] hover:bg-[#321919] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {resetBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {t("set.resetAction")}
          </button>
        </>
      ) : (
        desktopOnly
      ),
    },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">
        <header className="mb-5">
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("set.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("set.subtitle")}</p>
        </header>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-5 text-[13px] text-ink2">
          {error ? (
            <span className="text-loss">{error}</span>
          ) : (
            <>
              <Loader2 size={17} className="animate-spin text-accent" />
              {t("set.loading")}
            </>
          )}
        </div>
      </div>
    );
  }

  const sectionList = (
    <div className="flex min-w-0 flex-col gap-4">
      {dirty && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-gold/40 bg-[#2a2414] px-4 py-2.5 text-[12.5px] text-gold">
          {t("set.dirtyHint")}
          {desktop && draft && (
            <Button primary onClick={save}>
              <Check size={15} /> {t("common.save")}
            </Button>
          )}
        </div>
      )}
      {sections.map((section, index) => (
        <Fragment key={section.id}>
          {/* Ab hier kommt, was man selten anfasst · eine Zwischenüberschrift
              trennt die Expertenbereiche vom Alltag. */}
          {section.advanced && !sections[index - 1]?.advanced && (
            <div className="px-1 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink3">
              {t("set.advanced")}
            </div>
          )}
          <SettingsSection
            mobile={compact}
            id={section.id}
            icon={section.icon}
            title={section.title}
            summary={section.summary}
            tone={section.tone}
            onReveal={reveal}
          >
            {section.content}
          </SettingsSection>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-6 min-[1160px]:max-w-[1096px]">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("set.title")}</h1>
          <p className="mt-0.5 text-[13px] text-ink3">{t("set.subtitle")}</p>
        </div>
        {desktop && draft && (
          <Button primary onClick={save} className={dirty ? "" : "opacity-50"}>
            <Check size={15} /> {t("common.save")}
          </Button>
        )}
      </header>

      {!desktop && (
        <div className="mb-4 rounded-lg border border-dashed border-line2 px-4 py-2.5 text-[12.5px] text-ink3">
          {t("set.webNote")}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-accent-dim bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-[#8a3535] bg-[#2a1414] px-4 py-2.5 text-[12.5px] text-loss">
          {error}
        </div>
      )}

      {compact ? (
        sectionList
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 min-[1160px]:grid-cols-[188px_minmax(0,1fr)]">
          <SectionNav
            sections={sections}
            active={activeSection}
            advancedLabel={t("set.advanced")}
            label={t("set.sections")}
            onJump={jumpTo}
          />
          {sectionList}
        </div>
      )}

      {tourOpen && <AppTour overlay onDone={() => setTourOpen(false)} />}

      {legalShown && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLegalShown(null);
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">
                  {t("set.legal")}
                </div>
                <h2 id="legal-title" className="truncate text-[15px] font-semibold">
                  {legalShown.title}
                </h2>
              </div>
              <Button onClick={() => setLegalShown(null)}>{t("set.legalClose")}</Button>
            </div>
            {/* Lizenztexte sind bewusst unformatiert: Zeilenumbrüche und
                Einrückung gehören zum Text, den sie mitliefern. */}
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {legalError ? (
                <p className="text-[12.5px] text-loss">{t("set.legalFailed", { e: legalError })}</p>
              ) : legalText === null ? (
                <p className="flex items-center gap-2 text-[12.5px] text-ink3">
                  <Loader2 size={14} className="animate-spin text-accent" /> {t("set.legalLoading")}
                </p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink2">
                  {legalText}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {resetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resetBusy) setResetOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#2a1717] text-loss">
                <AlertTriangle size={18} />
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">Kiebitz</div>
                <h2 id="reset-title" className="text-[16px] font-semibold">{t("set.resetConfirmTitle")}</h2>
              </div>
            </div>
            <p className="px-5 py-4 text-[13px] leading-relaxed text-ink2">{t("set.resetConfirm")}</p>
            <div className="flex justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
              <Button onClick={() => setResetOpen(false)} disabled={resetBusy}>{t("common.cancel")}</Button>
              <button
                type="button"
                disabled={resetBusy}
                onClick={runFactoryReset}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#8a3535] bg-[#351919] px-3.5 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:bg-[#441d1d] disabled:opacity-45"
              >
                {resetBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t("set.resetAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
