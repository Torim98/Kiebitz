/**
 * Konto und Kiebitz Plus in den Einstellungen.
 *
 * Der eine Ort, an dem man sich anmeldet, den Status sieht, bucht, verwaltet,
 * abmeldet und löscht. Preise stehen bewusst nirgends im App-Code · sie werden
 * in Stripe beziehungsweise Google Play gepflegt und im Checkout genannt.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui";
import { dateLocale } from "../../lib/format";
import { errorMessage } from "../../lib/errors";
import { useI18n, useT } from "../../lib/i18n";
import { openExternal } from "../../lib/ext";
import { PlusApiError, renewingProvidersOf } from "../../lib/plus/api";
import { PLAY_SUBSCRIPTIONS_URL, PROVIDER_KEY, maskEmail } from "../../lib/plus/labels";
import { billingAvailable } from "../../lib/plus/billing";
import {
  deletePlusAccount,
  pollAfterReturn,
  purchaseWithGooglePlay,
  refreshEntitlement,
  requestSignInLink,
  restoreGooglePlayPurchases,
  signOut,
  startCheckout,
  startPortal,
} from "../../lib/plus/store";
import { usePlus } from "../../lib/plus/usePlus";
import { Field, inputCls } from "./SettingsLayout";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sekunden bis zum nächsten erlaubten Versand · tickt im Sekundentakt. */
function useCountdown(until: number): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    if (until <= Date.now()) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return left;
}

function formatDate(iso: number | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale);
}

export default function PlusSection() {
  const t = useT();
  const plus = usePlus();
  // Zwei verschiedene Dinge: `locale` formatiert Datum und Uhrzeit, `uiLocale`
  // ist die in Kiebitz gewählte Sprache und bestimmt, worin Anmeldemail,
  // Stripe-Seite und Vertragsbestätigung verfasst werden.
  const locale = dateLocale();
  const { locale: uiLocale } = useI18n();

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "checkout" | "portal" | "logout" | "delete" | "restore" | null
  >(null);
  /**
   * Steht Google Play Billing bereit? `null`, solange das noch offen ist.
   *
   * Google verlangt für digitale Inhalte innerhalb der App seinen eigenen
   * Bezahlweg. Wo Play antwortet, verschwindet der Stripe-Checkout deshalb
   * vollständig · beide nebeneinander anzubieten wäre der klassische
   * Ablehnungsgrund im Review.
   */
  const [playBilling, setPlayBilling] = useState<boolean | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockedProviders, setBlockedProviders] = useState<string[]>([]);
  const resendIn = useCountdown(plus.resendAllowedAt);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    void billingAvailable().then((available) => {
      if (mounted.current) setPlayBilling(available);
    });
  }, []);

  const trialUntil = useMemo(
    () => formatDate(plus.claims?.trial_until ?? null, locale),
    [plus.claims?.trial_until, locale]
  );
  const validUntil = useMemo(
    () => formatDate(plus.claims?.entitlement_valid_until ?? null, locale),
    [plus.claims?.entitlement_valid_until, locale]
  );
  const providers = plus.claims?.providers ?? plus.account?.providers ?? [];

  const sendLink = async () => {
    const address = email.trim();
    if (!EMAIL_PATTERN.test(address)) {
      setError(t("plus.emailInvalid"));
      return;
    }
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await requestSignInLink(address, uiLocale);
      if (!mounted.current) return;
      setSentTo(address);
    } catch (e) {
      if (!mounted.current) return;
      setError(
        e instanceof PlusApiError && e.code === "rate_limited"
          ? t("plus.rateLimited")
          : errorMessage(e)
      );
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  /**
   * Kaufen · über Google Play, wo es Google Play gibt, sonst über Stripe.
   *
   * Die Play-Seite nennt Preis, Testzeitraum und Kündigung selbst. Kiebitz
   * verspricht deshalb vorher keinen Testzeitraum: Ob dieses Play-Konto ihn
   * noch bekommt, weiß nur Google.
   */
  const openCheckout = async () => {
    setBusy("checkout");
    setError(null);
    setMessage(null);
    try {
      if (playBilling) {
        const outcome = await purchaseWithGooglePlay();
        if (!mounted.current) return;
        if (outcome === "pending") setMessage(t("plus.purchasePending"));
      } else {
        const session = await startCheckout(uiLocale);
        openExternal(session.checkout_url);
        pollAfterReturn();
        setMessage(
          session.trial_days > 0
            ? t("plus.checkoutTrial", { n: session.trial_days })
            : t("plus.checkoutOpened")
        );
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  /** Der Weg zurück nach Gerätewechsel, Neuinstallation oder Abbruch. */
  const restorePurchases = async () => {
    setBusy("restore");
    setError(null);
    setMessage(null);
    try {
      const restored = await restoreGooglePlayPurchases();
      if (!mounted.current) return;
      setMessage(restored > 0 ? t("plus.restored") : t("plus.restoreNone"));
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setError(null);
    setMessage(null);
    try {
      const session = await startPortal();
      openExternal(session.portal_url);
      pollAfterReturn();
      setMessage(t("plus.portalOpened"));
    } catch (e) {
      setError(
        e instanceof PlusApiError && e.code === "stripe_customer_missing"
          ? t("plus.portalMissing")
          : errorMessage(e)
      );
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const doSignOut = async () => {
    setBusy("logout");
    setError(null);
    try {
      await signOut();
      if (!mounted.current) return;
      setSentTo(null);
      setEmail("");
      setMessage(t("plus.signedOut"));
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    setError(null);
    setBlockedProviders([]);
    try {
      await deletePlusAccount();
      if (!mounted.current) return;
      setDeleteOpen(false);
      setSentTo(null);
      setEmail("");
      setMessage(t("plus.deleted"));
    } catch (e) {
      if (!mounted.current) return;
      const renewing = renewingProvidersOf(e);
      if (renewing.length > 0) setBlockedProviders(renewing);
      else setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const planLabel = plus.isPlus
    ? plus.isTrial
      ? t("plus.planTrial")
      : t("plus.planPlus")
    : t("plus.planFree");

  if (plus.loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2.5 text-[12.5px] text-ink3">
        <Loader2 size={14} className="animate-spin text-accent" /> {t("common.loading")}
      </div>
    );
  }

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-ink2">{t("plus.localFirst")}</p>

      {!plus.signedIn ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[12.5px] leading-relaxed text-ink3">{t("plus.signedOutLead")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("plus.emailLabel")} className="min-w-[240px] flex-1">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sending && resendIn === 0) void sendLink();
                }}
                placeholder="name@example.com"
                className={inputCls}
              />
            </Field>
            <Button primary onClick={sendLink} disabled={sending || resendIn > 0}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              {sentTo ? t("plus.resend") : t("plus.sendLink")}
            </Button>
          </div>
          {sentTo && (
            <div className="rounded-lg border border-accent-dim bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-accent">
              {t("plus.linkSent", { e: sentTo })}
              <span className="mt-1 block text-ink2">{t("plus.linkHint")}</span>
              {resendIn > 0 && (
                <span className="mt-1 block text-ink3">{t("plus.resendIn", { s: resendIn })}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {/* Kopfzeile: wer ist angemeldet, was ist freigeschaltet, wie frisch. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-panel2 px-3 py-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                plus.isPlus
                  ? "border border-accent-dim bg-accent-soft text-accent"
                  : "border border-line2 text-ink2"
              }`}
            >
              {plus.isPlus && <Sparkles size={11} />}
              {planLabel}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink2">
              {plus.account
                ? showEmail
                  ? plus.account.email
                  : maskEmail(plus.account.email)
                : t("plus.accountUnknown")}
            </span>
            {plus.account && (
              <button
                type="button"
                onClick={() => setShowEmail((value) => !value)}
                aria-label={showEmail ? t("plus.hideEmail") : t("plus.showEmail")}
                className="rounded p-1 text-ink3 transition-colors hover:text-ink"
              >
                {showEmail ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
            <Button
              onClick={() => void refreshEntitlement({ force: true })}
              disabled={plus.refreshing}
            >
              <RefreshCw size={13} className={plus.refreshing ? "animate-spin" : ""} />
              {t("plus.refresh")}
            </Button>
          </div>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[12.5px] min-[560px]:grid-cols-2">
            {plus.claims?.status === "grace" && (
              <div className="min-[560px]:col-span-2">
                <dt className="text-ink3">{t("plus.statusLabel")}</dt>
                <dd className="text-gold">{t("plus.statusGrace")}</dd>
              </div>
            )}
            {plus.isTrial && trialUntil && (
              <div>
                <dt className="text-ink3">{t("plus.trialUntilLabel")}</dt>
                <dd className="text-ink2 tabular-nums">{trialUntil}</dd>
              </div>
            )}
            {validUntil && (
              <div>
                <dt className="text-ink3">{t("plus.validUntilLabel")}</dt>
                <dd className="text-ink2 tabular-nums">{validUntil}</dd>
              </div>
            )}
            {providers.length > 0 && (
              <div>
                <dt className="text-ink3">{t("plus.providersLabel")}</dt>
                <dd className="text-ink2">
                  {providers.map((provider) => t(PROVIDER_KEY[provider])).join(" · ")}
                </dd>
              </div>
            )}
            {plus.fetchedAt && (
              <div>
                <dt className="text-ink3">{t("plus.checkedLabel")}</dt>
                <dd className="text-ink2 tabular-nums">
                  {new Date(plus.fetchedAt).toLocaleString(locale)}
                </dd>
              </div>
            )}
          </dl>

          {/* Ein Providerausfall darf Free nie blockieren · deshalb nur ein
              Hinweis, kein Sperrzustand. */}
          {plus.error && (
            <p className="rounded-lg border border-line2 bg-panel2 px-3 py-2 text-[12.5px] text-ink3">
              {plus.error.offline ? t("plus.errorOffline") : t("plus.errorRefresh")}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Solange offen ist, welcher Bezahlweg gilt, erscheint keiner ·
                ein Knopf, der gleich seine Beschriftung wechselt, ist
                schlimmer als ein Knopf, der einen Moment später kommt. */}
            {!plus.isPlus && playBilling !== null && (
              <Button primary onClick={openCheckout} disabled={busy === "checkout"}>
                {busy === "checkout" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {/* Über Google Play nennt die Play-Seite den Testzeitraum ·
                    was Kiebitz über die Berechtigung weiß, gilt nur für Stripe. */}
                {!playBilling && plus.trialEligible ? t("plus.startTrial") : t("plus.subscribe")}
              </Button>
            )}
            {playBilling && (
              <Button onClick={restorePurchases} disabled={busy === "restore"}>
                {busy === "restore" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                {t("plus.restore")}
              </Button>
            )}
            {providers.includes("stripe") && (
              <Button onClick={openPortal} disabled={busy === "portal"}>
                {busy === "portal" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CreditCard size={14} />
                )}
                {t("plus.manage")}
              </Button>
            )}
            {providers.includes("google_play") && (
              <Button onClick={() => openExternal(PLAY_SUBSCRIPTIONS_URL)}>
                <CreditCard size={14} /> {t("plus.managePlay")}
              </Button>
            )}
            <Button onClick={doSignOut} disabled={busy === "logout"}>
              {busy === "logout" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <LogOut size={14} />
              )}
              {t("plus.signOut")}
            </Button>
          </div>

          <div className="border-t border-line pt-3">
            <p className="text-[12px] leading-relaxed text-ink3">{t("plus.deleteNote")}</p>
            <button
              type="button"
              onClick={() => {
                setBlockedProviders([]);
                setDeleteOpen(true);
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:bg-[#351919]"
            >
              <Trash2 size={13} /> {t("plus.delete")}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-3 rounded-lg border border-accent-dim bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-[#8a3535] bg-[#2a1414] px-3 py-2 text-[12.5px] text-loss">
          {error}
        </p>
      )}

      {/* Zweite Stufe der Löschung · der Klick oben öffnet nur diese Nachfrage. */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plus-delete-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && busy !== "delete") setDeleteOpen(false);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl shadow-black/50">
            <div className="flex items-center gap-3 border-b border-line px-5 py-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#2a1717] text-loss">
                <AlertTriangle size={18} />
              </div>
              <h2 id="plus-delete-title" className="text-[16px] font-semibold">
                {t("plus.deleteConfirmTitle")}
              </h2>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] leading-relaxed text-ink2">{t("plus.deleteConfirm")}</p>
              {blockedProviders.length > 0 && (
                <div className="mt-3 rounded-lg border border-gold/40 bg-[#2a2414] px-3 py-2.5 text-[12.5px] leading-relaxed text-gold">
                  {t("plus.deleteBlocked")}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {blockedProviders.includes("stripe") && (
                      <Button onClick={openPortal}>
                        <CreditCard size={13} /> {t("plus.manage")}
                      </Button>
                    )}
                    {blockedProviders.includes("google_play") && (
                      <Button onClick={() => openExternal(PLAY_SUBSCRIPTIONS_URL)}>
                        <CreditCard size={13} /> {t("plus.managePlay")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-panel2/40 px-5 py-3.5">
              <Button onClick={() => setDeleteOpen(false)} disabled={busy === "delete"}>
                {t("common.cancel")}
              </Button>
              <button
                type="button"
                disabled={busy === "delete"}
                onClick={doDelete}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#8a3535] bg-[#351919] px-3.5 py-1.5 text-[12.5px] font-medium text-loss transition-colors hover:bg-[#441d1d] disabled:opacity-45"
              >
                {busy === "delete" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                {t("plus.deleteAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
