/**
 * Rückmeldung und Diagnose · das Gegenstück zum Feedback-Formular der Website,
 * nur eben in der App und mit dem, was die App über sich selbst weiß.
 *
 * Der Ablauf ist absichtlich einseitig: Kiebitz sammelt lokal, der Nutzer
 * entscheidet, was rausgeht. Der Diagnosebericht steht deshalb offen einsehbar
 * unter der Meldung, und ohne Häkchen wird er nicht angehängt.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  FileText,
  Lightbulb,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useBackendInfo } from "../lib/backend";
import { useI18n, type Key } from "../lib/i18n";
import { Button, Card, Chip } from "../components/ui";
import { openExternal } from "../lib/ext";
import { dateLocale } from "../lib/format";
import { errorMessage } from "../lib/errors";
import {
  FEEDBACK_ADDRESS,
  diagClear,
  diagLogPath,
  diagLogs,
  diagReport,
  diagSaveReport,
  feedbackBody,
  feedbackMailto,
  sendFeedback,
  type FeedbackDraft,
  type LogEntry,
  type ReportType,
} from "../lib/diag";

const TYPES: { id: ReportType; labelKey: Key; hintKey: Key; icon: typeof MessageSquare }[] = [
  { id: "feedback", labelKey: "sup.typeFeedback", hintKey: "sup.typeFeedbackHint", icon: MessageSquare },
  { id: "crash", labelKey: "sup.typeCrash", hintKey: "sup.typeCrashHint", icon: AlertTriangle },
  { id: "feature", labelKey: "sup.typeFeature", hintKey: "sup.typeFeatureHint", icon: Lightbulb },
];

const LEVEL_COLOR: Record<string, string> = {
  error: "var(--color-loss)",
  warn: "var(--color-gold)",
  info: "var(--color-ink3)",
  debug: "var(--color-ink3)",
};

const inputCls =
  "w-full rounded-lg border border-line bg-panel2 px-3 py-2 text-[13px] text-ink placeholder:text-ink3 focus:border-accent-dim focus:outline-none";

/** Mindestlänge der Beschreibung · dieselbe Schwelle wie im Web-Formular. */
const MIN_DETAILS = 20;

function platformName(platform?: string): string {
  if (platform === "android") return "Android";
  if (platform === "ios") return "iOS";
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  if (platform === "linux") return "Linux";
  return "Other";
}

export default function Support({ initialType = "feedback" }: { initialType?: ReportType }) {
  const backend = useBackendInfo();
  const { locale, t } = useI18n();
  const desktop = backend.mode === "desktop";

  const [type, setType] = useState<ReportType>(initialType);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [attach, setAttach] = useState(true);
  const [report, setReport] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [logPath, setLogPath] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);

  const version = backend.info?.version ?? "";
  const platform = platformName(backend.info?.platform);

  const loadLogs = () => {
    diagLogs(200).then(setLogs).catch(() => setLogs([]));
  };

  // Der Diagnosebericht wird beim Öffnen erzeugt, damit unter der Meldung
  // wirklich das steht, was mitgeschickt würde.
  useEffect(() => {
    if (!desktop) return;
    diagReport().then(setReport).catch(() => setReport(""));
    diagLogPath().then(setLogPath).catch(() => {});
    loadLogs();
  }, [desktop]);

  const draft: FeedbackDraft = useMemo(
    () => ({
      type,
      summary,
      details,
      email,
      platform,
      version,
      diagnostics: attach ? report : "",
    }),
    [type, summary, details, email, platform, version, attach, report]
  );

  const ready = summary.trim().length > 0 && details.trim().length >= MIN_DETAILS;

  const copyBody = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(feedbackBody(draft));
      setNotice(t("sup.copied"));
      setTimeout(() => setNotice(null), 2500);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await sendFeedback(draft);
      setSent(true);
      setSummary("");
      setDetails("");
    } catch (reason) {
      setError(t("sup.sendFailed", { e: errorMessage(reason) }));
    } finally {
      setSending(false);
    }
  };

  const saveReport = async () => {
    setError(null);
    try {
      const chosen = await saveDialog({
        defaultPath: "kiebitz-diagnose.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (!chosen) return;
      const path = await diagSaveReport(chosen, feedbackBody({ ...draft, diagnostics: report }));
      setNotice(t("sup.reportSaved", { path }));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="page-title text-[21px] font-semibold tracking-tight">{t("sup.title")}</h1>
        <p className="mt-0.5 text-[13px] text-ink3">{t("sup.subtitle")}</p>
      </header>

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
        <Card
          title={
            <span className="flex items-center gap-2">
              <Send size={14} className="text-accent" /> {t("sup.formTitle")}
            </span>
          }
        >
          {sent ? (
            <div className="flex flex-col items-start gap-3">
              <div className="flex items-center gap-2 text-[13.5px] font-medium text-accent">
                <Check size={17} /> {t("sup.sentTitle")}
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink2">{t("sup.sentNote")}</p>
              <Button onClick={() => setSent(false)}>{t("sup.sendAnother")}</Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {TYPES.map(({ id, labelKey, icon: Icon }) => (
                  <Chip key={id} active={type === id} onClick={() => setType(id)}>
                    <span className="flex items-center gap-1.5">
                      <Icon size={13} /> {t(labelKey)}
                    </span>
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink3">
                {t(TYPES.find((entry) => entry.id === type)!.hintKey)}
              </p>

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-[12px] text-ink3">{t("sup.summary")}</span>
                <input
                  value={summary}
                  maxLength={120}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder={t("sup.summaryPlaceholder")}
                  className={inputCls}
                />
              </label>

              <label className="mt-3 flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between text-[12px] text-ink3">
                  <span>{t("sup.details")}</span>
                  <span className="tabular-nums">{details.length} / 4000</span>
                </span>
                <textarea
                  value={details}
                  maxLength={4000}
                  rows={6}
                  onChange={(event) => setDetails(event.target.value)}
                  placeholder={t("sup.detailsPlaceholder")}
                  className={`${inputCls} resize-y leading-relaxed`}
                />
              </label>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">{t("sup.detailsHint")}</p>

              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-[12px] text-ink3">{t("sup.email")}</span>
                <input
                  type="email"
                  value={email}
                  maxLength={160}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className={inputCls}
                />
              </label>

              <div className="mt-4 rounded-lg border border-line bg-panel2 px-3 py-2.5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={attach}
                    onChange={(event) => setAttach(event.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#22c08a]"
                  />
                  <span>
                    <span className="block text-[13px] text-ink">{t("sup.attach")}</span>
                    <span className="block text-[12px] leading-relaxed text-ink3">
                      {t("sup.attachNote", { p: platform, v: version || "?" })}
                    </span>
                  </span>
                </label>
                {report && (
                  <>
                    <button
                      type="button"
                      onClick={() => setReportOpen((value) => !value)}
                      className="mt-2 text-[12px] text-accent transition-colors hover:text-ink"
                    >
                      {t(reportOpen ? "sup.reportHide" : "sup.reportShow")}
                    </button>
                    {reportOpen && (
                      <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink2">
                        {report}
                      </pre>
                    )}
                  </>
                )}
              </div>

              <p className="mt-3 text-[12px] leading-relaxed text-ink3">
                {t("sup.sendNote", { address: FEEDBACK_ADDRESS })}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button primary disabled={!ready || sending} onClick={send}>
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t("sup.send")}
                </Button>
                <Button disabled={!ready} onClick={() => openExternal(feedbackMailto(draft))}>
                  <Mail size={14} /> {t("sup.sendByMail")}
                </Button>
                <Button disabled={!ready} onClick={copyBody}>
                  <ClipboardCopy size={14} /> {t("sup.copy")}
                </Button>
                {desktop && (
                  <Button onClick={saveReport}>
                    <Save size={14} /> {t("sup.saveReport")}
                  </Button>
                )}
              </div>
              {!ready && (summary || details) && (
                <p className="mt-2 text-[11.5px] text-ink3">{t("sup.needMore", { n: MIN_DETAILS })}</p>
              )}
            </>
          )}
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <FileText size={14} className="text-accent" /> {t("sup.logTitle")}
            </span>
          }
          action={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setLogsOpen((value) => !value);
                  loadLogs();
                }}
                aria-expanded={logsOpen}
                className="rounded-lg px-2 py-1 text-[12px] text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
              >
                {t(logsOpen ? "sup.logHide" : "sup.logShow")}
              </button>
              {logsOpen && (
                <>
                  <button
                    type="button"
                    onClick={loadLogs}
                    aria-label={t("sup.logRefresh")}
                    title={t("sup.logRefresh")}
                    className="rounded-lg p-1.5 text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void diagClear()
                        .then(() => {
                          loadLogs();
                          diagReport().then(setReport).catch(() => {});
                        })
                        .catch((reason) => setError(errorMessage(reason)))
                    }
                    aria-label={t("sup.logClear")}
                    title={t("sup.logClear")}
                    className="rounded-lg p-1.5 text-ink3 transition-colors hover:bg-panel2 hover:text-loss"
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          }
        >
          {!desktop ? (
            <p className="text-[12.5px] text-ink3">{t("set.desktopOnly")}</p>
          ) : !logsOpen ? (
            <p className="text-[12px] leading-relaxed text-ink3">{t("sup.logHint")}</p>
          ) : logs == null ? (
            <div className="flex items-center gap-2 text-[12px] text-ink3">
              <Loader2 size={14} className="animate-spin text-accent" /> {t("common.loading")}
            </div>
          ) : logs.length === 0 ? (
            <p className="text-[12px] text-ink3">{t("sup.logEmpty")}</p>
          ) : (
            <ul className="flex max-h-[340px] flex-col gap-1 overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed">
              {[...logs].reverse().map((entry, index) => (
                <li
                  key={`${entry.ts}-${index}`}
                  className="flex gap-2 border-b border-line/60 pb-1 last:border-0"
                >
                  <span className="shrink-0 text-ink3">
                    {new Date(entry.ts * 1000).toLocaleTimeString(dateLocale())}
                  </span>
                  <span className="w-10 shrink-0 uppercase" style={{ color: LEVEL_COLOR[entry.level] }}>
                    {entry.level}
                  </span>
                  <span className="w-16 shrink-0 truncate text-ink3">{entry.source}</span>
                  <span className="min-w-0 break-words text-ink2">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
          {desktop && logPath && (
            <p className="mt-3 break-all border-t border-line pt-2.5 text-[11.5px] text-ink3">
              {t("sup.logFile")}: <span className="font-mono">{logPath}</span>
            </p>
          )}
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink3">
            {locale === "de"
              ? "Das Logbuch bleibt auf diesem Gerät. Es geht nur mit, wenn du oben den Diagnosebericht anhängst."
              : "The log stays on this device. It only travels with a report if you attach the diagnostics above."}
          </p>
        </Card>
      </div>
    </div>
  );
}
