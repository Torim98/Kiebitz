import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Cpu,
  Database,
  Download,
  Globe,
  Loader2,
  Puzzle as PuzzleIcon,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Locale } from "../lib/i18n";
import {
  dbInfo,
  formatBytes,
  getSettings,
  moveDatabase,
  setSettings,
  testEngine,
  useDatabase,
  type DbInfo,
  type EngineTest,
  type Settings,
} from "../lib/settings";
import {
  importPuzzles,
  onPuzzleImportDone,
  onPuzzleImportProgress,
  puzzleStats,
  type PuzzleStats,
} from "../lib/puzzles";
import {
  checkUpdate,
  installUpdate,
  onUpdateState,
  type UpdateCheck,
  type UpdateState,
} from "../lib/updater";
import { Button, Card, Chip } from "../components/ui";
import { dateLocale, deInt } from "../lib/util";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-ink3">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none";

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputCls}
      />
    </Field>
  );
}

export default function SettingsPage() {
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
  const [dbBusy, setDbBusy] = useState(false);

  const [updCheck, setUpdCheck] = useState<UpdateCheck | null>(null);
  const [updChecking, setUpdChecking] = useState(false);
  const [updState, setUpdState] = useState<UpdateState | null>(null);
  const [updError, setUpdError] = useState<string | null>(null);

  const [pz, setPz] = useState<PuzzleStats | null>(null);
  const [pzRunning, setPzRunning] = useState(false);
  const [pzProgress, setPzProgress] = useState(0);
  const [pzMsg, setPzMsg] = useState<string | null>(null);
  const [pzPath, setPzPath] = useState("");

  useEffect(() => {
    if (!desktop) return;
    getSettings()
      .then((s) => {
        setSaved(s);
        setDraft(s);
      })
      .catch((e) => setError(String(e)));
    dbInfo().then(setInfo).catch(() => {});
    puzzleStats()
      .then((s) => {
        setPz(s);
        setPzRunning(s.importing);
      })
      .catch(() => {});
  }, [desktop]);

  // Puzzle-Import-Events (Import kann auch von der Puzzle-Seite laufen).
  useEffect(() => {
    if (!desktop) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    onPuzzleImportProgress((p) => {
      setPzRunning(true);
      setPzProgress(p.imported);
    }).then((u) => (disposed ? u() : cleanups.push(u)));
    onPuzzleImportDone((p) => {
      setPzRunning(false);
      setPzMsg(
        p.error
          ? t("set.puzzleImportFailed", { e: p.error })
          : t("set.puzzleImportDone", { n: deInt(p.imported) })
      );
      puzzleStats().then(setPz).catch(() => {});
      dbInfo().then(setInfo).catch(() => {});
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
      setNotice(t("set.saved"));
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(String(e));
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
      // Einstellungen neu laden (db_path hat sich geändert).
      const s = await getSettings();
      setSaved(s);
      setDraft((d) => (d ? { ...d, db_path: s.db_path } : s));
      puzzleStats().then(setPz).catch(() => {});
    } catch (e) {
      setError(String(e));
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

  /** Startet Download + Installation; bei Erfolg startet die App neu. */
  const runUpdateInstall = () => {
    setUpdError(null);
    installUpdate().catch((e) => {
      setUpdState(null);
      setUpdError(String(e));
    });
  };

  const startPuzzleImport = (path?: string) => {
    setPzMsg(null);
    setPzProgress(0);
    setPzRunning(true);
    importPuzzles(path).catch((e) => {
      setPzRunning(false);
      setPzMsg(t("set.puzzleImportFailed", { e: String(e) }));
    });
  };

  return (
    <div className="mx-auto max-w-[860px] px-6 py-6">
      <header className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight">{t("set.title")}</h1>
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
      {dirty && (
        <div className="mb-4 rounded-lg border border-gold/40 bg-[#2a2414] px-4 py-2.5 text-[12.5px] text-gold">
          {t("set.dirtyHint")}
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

      <div className="flex flex-col gap-4">
        {/* Sprache */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-accent" /> {t("set.language")}
            </span>
          }
        >
          <div className="flex gap-2">
            <Chip active={locale === "de"} onClick={() => switchLocale("de")}>
              {t("set.langDe")}
            </Chip>
            <Chip active={locale === "en"} onClick={() => switchLocale("en")}>
              {t("set.langEn")}
            </Chip>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.langNote")}</p>
        </Card>

        {/* Konten & Import */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <UserRound size={14} className="text-accent" /> {t("set.accounts")}
            </span>
          }
        >
          {desktop && draft ? (
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
              <p className="text-[12px] leading-relaxed text-ink3 min-[640px]:col-span-3">
                {t("set.importMonthsNote", { n: draft.import_months })}
              </p>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>

        {/* Engine */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Cpu size={14} className="text-accent" /> {t("set.engine")}
            </span>
          }
        >
          {desktop && draft ? (
            <>
              <Field label={t("set.enginePath")}>
                <div className="flex gap-2">
                  <input
                    value={draft.engine_path ?? ""}
                    onChange={(e) => patch({ engine_path: e.target.value || null })}
                    placeholder="C:\Engines\stockfish.exe"
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
                  max={4096}
                  onChange={(v) => patch({ engine_hash_mb: v })}
                />
                <NumberField
                  label={t("set.multipv")}
                  value={draft.engine_multipv}
                  min={1}
                  max={5}
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
                    placeholder="D:\Schach\syzygy"
                    className={inputCls}
                  />
                </Field>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink3">{t("set.syzygyNote")}</p>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.engineNote")}</p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>

        {/* Datenbank */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Database size={14} className="text-accent" /> {t("set.database")}
            </span>
          }
        >
          {desktop ? (
            <>
              {info && (
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
              )}
              <div className="mt-4 flex flex-col gap-3">
                <Field label={t("set.dbMoveLabel")}>
                  <div className="flex gap-2">
                    <input
                      value={movePath}
                      onChange={(e) => setMovePath(e.target.value)}
                      placeholder="D:\Nextcloud\Schach\kiebitz.db"
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
                      placeholder="D:\Nextcloud\Schach\kiebitz.db"
                      className={inputCls}
                    />
                    <Button onClick={() => !dbBusy && runDbAction("use")}>
                      {dbBusy ? <Loader2 size={14} className="animate-spin" /> : t("set.dbUse")}
                    </Button>
                  </div>
                </Field>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.dbNote")}</p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>

        {/* ChessDB */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <Globe size={14} className="text-accent" /> {t("set.chessdb")}
            </span>
          }
        >
          {desktop && draft ? (
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
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>

        {/* Puzzle-Datenbank */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <PuzzleIcon size={14} className="text-accent" /> {t("set.puzzleDb")}
            </span>
          }
        >
          {desktop ? (
            <>
              <div className="text-[13px] text-ink2">
                {t("set.puzzleCount", { n: deInt(pz?.db_total ?? 0) })}
                <span className="ml-2 text-[12px] text-ink3">
                  ·{" "}
                  {pz?.imported_at
                    ? t("set.puzzleImportedAt", {
                        date: new Date(pz.imported_at * 1000).toLocaleDateString(dateLocale()),
                      })
                    : t("set.puzzleNever")}
                </span>
              </div>
              {pzRunning ? (
                <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink2">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  {pzProgress > 0
                    ? t("set.puzzleImporting", { n: deInt(pzProgress) })
                    : t("pz.downloading")}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  <div>
                    <Button onClick={() => startPuzzleImport()}>
                      <Download size={14} /> {t("set.puzzleReimport")}
                    </Button>
                  </div>
                  <Field label={t("set.puzzleFromFile")}>
                    <div className="flex gap-2">
                      <input
                        value={pzPath}
                        onChange={(e) => setPzPath(e.target.value)}
                        placeholder="C:\Downloads\lichess_db_puzzle.csv.zst"
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
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>

        {/* Updates */}
        <Card
          title={
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className="text-accent" /> {t("set.updates")}
            </span>
          }
        >
          {desktop && draft ? (
            <>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.auto_update}
                  onChange={(e) => patch({ auto_update: e.target.checked })}
                  className="h-4 w-4 accent-[#22c08a]"
                />
                <span className="text-[13px] text-ink">{t("set.autoUpdateToggle")}</span>
              </label>
              <div className="mt-4 flex items-center gap-3">
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
                          <Download size={14} /> {t("set.updateInstall")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    t("set.updateUpToDate", { v: updCheck.current })
                  )}
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed text-ink3">{t("set.autoUpdateNote")}</p>
            </>
          ) : (
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
