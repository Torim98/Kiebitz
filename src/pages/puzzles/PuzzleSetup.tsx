import { useEffect, useState } from "react";
import { Download, Loader2, Target } from "lucide-react";
import { useBackendInfo } from "../../lib/backend";
import { useT } from "../../lib/i18n";
import {
  importLabel,
  importPuzzles,
  onPuzzleImportDone,
  onPuzzleImportProgress,
  type PuzzleImportProgress,
  type PuzzleStats,
} from "../../lib/puzzles";
import { keepScreenAwake } from "../../lib/wakeLock";
import { useMobileShell } from "../../components/MobileShell";
import { examplePaths } from "../../lib/paths";
import { deInt } from "../../lib/format";
import { Button, Card } from "../../components/ui";

export function DailyGoal({
  attempts,
  solved,
  goal,
}: {
  attempts: number;
  solved: number;
  goal: number;
}) {
  const t = useT();
  const reached = goal > 0 && attempts >= goal;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px]">
      <Target size={15} className={reached ? "text-accent" : "text-gold"} />
      <span className="text-ink3">{t("pz.todayGoal")}</span>
      <span className="font-medium tabular-nums">
        {deInt(attempts)}
        {goal > 0 && <span className="font-normal text-ink3"> / {deInt(goal)}</span>}
      </span>
      {goal > 0 && (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel3">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, (attempts / goal) * 100)}%`,
              background: reached ? "var(--color-accent)" : "var(--color-gold)",
            }}
          />
        </span>
      )}
      <span className="text-ink3">· {t("pz.todaySolved", { n: deInt(solved) })}</span>
    </div>
  );
}

export function PuzzleLoading() {
  const t = useT();
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("pz.preparing")}</p>
      </header>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-5 text-[13px] text-ink2">
        <Loader2 size={17} className="animate-spin text-accent" />
        {t("pz.loadingLibrary")}
      </div>
    </div>
  );
}

// ── Import-Ansicht ───────────────────────────────────────────────────────────

export function ImportView({
  stats,
  onImported,
  onSkip,
}: {
  stats: PuzzleStats;
  onImported: () => void;
  /** Nur gesetzt, wenn es schon Aufgaben aus eigenen Partien gibt. */
  onSkip?: () => void;
}) {
  const t = useT();
  const backend = useBackendInfo();
  // Auf dem Handy führt der Datei-Weg ins Leere: Es gibt keinen Dateimanager
  // im Blickfeld, die Tastatur müsste einen absoluten Pfad tippen, und der
  // Download-Knopf darüber tut dasselbe in einem Schritt. Wer die Datei doch
  // von Hand legen will, findet das Feld weiterhin in den Einstellungen unter
  // „Puzzle-Datenbank" · dort steht auch ein Beispielpfad, der zum Gerät passt.
  const mobile = useMobileShell();
  const [running, setRunning] = useState(stats.importing);
  const [progress, setProgress] = useState<PuzzleImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const examplePath = examplePaths(backend.info?.platform).puzzleDump;

  useEffect(() => {
    const cleanups: (() => void)[] = [];
    let disposed = false;
    onPuzzleImportProgress(setProgress).then((u) => (disposed ? u() : cleanups.push(u)));
    onPuzzleImportDone((p) => {
      setRunning(false);
      if (p.error) setError(p.error);
      // Auch ein Fehlschlag ändert den Stand: teilweise importierte Aufgaben
      // und der Fortsetzungspunkt gehören in die Ansicht.
      onImported();
    }).then((u) => (disposed ? u() : cleanups.push(u)));
    return () => {
      disposed = true;
      cleanups.forEach((u) => u());
    };
  }, [onImported]);

  // Der Import läuft im Backend weiter, wenn das Handy einschläft · nur
  // deutlich langsamer und mit abgerissenem Download. Solange der Nutzer die
  // Seite offen hat, bleibt der Bildschirm deshalb an.
  useEffect(() => (running ? keepScreenAwake() : undefined), [running]);

  const start = (p?: string) => {
    setError(null);
    setProgress(null);
    setRunning(true);
    importPuzzles(p).catch((e) => {
      setRunning(false);
      setError(String(e));
    });
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("pz.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("pz.setupTitle")}</p>
      </header>

      <Card title={t("pz.importCard")}>
        {running ? (
          <div className="py-4">
            <div className="flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-accent" />
              <div>
                <div className="text-[14px] font-medium">{importLabel(progress, t)}</div>
                <div className="mt-0.5 text-[12px] text-ink3">{t("pz.background")}</div>
              </div>
            </div>
            {progress?.phase === "download" && progress.bytes_total > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel3">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${Math.min(100, (progress.bytes / progress.bytes_total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ink2">{t("pz.importIntro")}</p>
            {stats.import_resumable && (
              <p className="mt-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-[12px] leading-relaxed text-ink2">
                {t("pz.resumeNote")}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button primary onClick={() => start()}>
                <Download size={15} />{" "}
                {t(stats.import_resumable ? "pz.resumeImport" : "pz.downloadImport")}
              </Button>
            </div>
            {!mobile && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-2 text-[12px] text-ink3">{t("pz.fromFile")}</div>
                <div className="flex gap-2">
                  <input
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder={examplePath}
                    className="flex-1 rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none"
                  />
                  <Button onClick={() => path.trim() && start(path.trim())}>{t("common.import")}</Button>
                </div>
              </div>
            )}
            {onSkip && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-[12px] leading-relaxed text-ink3">
                  {t("pz.ownOnlyNote", { n: deInt(stats.own_total) })}
                </p>
                <Button onClick={onSkip}>{t("pz.ownOnlyStart")}</Button>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-loss-dim bg-loss-soft px-3 py-2 text-[12px] text-loss">
            {error}
          </div>
        )}
      </Card>
    </div>
  );
}
