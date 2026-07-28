/**
 * Mobile App-Shell: obere App-Bar und die Navigation als Bottom-Leiste
 * (Hochformat) bzw. als Rail an der linken Kante (Querformat).
 *
 * Im Querformat bleibt von einem Telefon kaum Höhe übrig · eine liegende
 * Leiste kostet dort genau die Achse, die knapp ist, während Breite reichlich
 * vorhanden ist. Deshalb wandert dieselbe Navigation an die Seite.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Bird, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { useT, type Key } from "../lib/i18n";
import type { PageId } from "../lib/nav";

export interface NavItem {
  id: PageId;
  labelKey: Key;
  icon: LucideIcon;
}

const LANDSCAPE_PHONE = "(orientation: landscape) and (max-height: 600px)";

/** Querformat auf Telefonhöhe · dort tritt die Navigation an die Seite. */
export function useLandscapePhone(): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(LANDSCAPE_PHONE).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(LANDSCAPE_PHONE);
    const onChange = (e: MediaQueryListEvent) => setMatch(e.matches);
    setMatch(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return match;
}

export function MobileAppBar({
  title,
  showBack,
  onBack,
  onSettings,
  settingsActive,
}: {
  /** Seitentitel · null zeigt stattdessen die Wortmarke (auf dem Start). */
  title: string | null;
  showBack: boolean;
  onBack: () => void;
  onSettings: () => void;
  settingsActive: boolean;
}) {
  const t = useT();
  return (
    <header
      className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 pb-2"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
    >
      {showBack ? (
        <button
          onClick={onBack}
          aria-label={t("app.back")}
          className="rounded-lg p-2 text-ink2 transition-colors hover:bg-panel2 hover:text-ink"
        >
          <ArrowLeft size={20} />
        </button>
      ) : (
        // Die Wortmarke steht nur auf dem Start · neben einem Seitentitel
        // wäre sie doppelte Beschriftung.
        title === null && (
          <span className="ml-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Bird size={17} />
          </span>
        )
      )}
      <span className="min-w-0 flex-1 truncate px-3 text-[15px] font-semibold tracking-tight">
        {title ?? "Kiebitz"}
      </span>
      <button
        onClick={onSettings}
        aria-label={t("nav.settings")}
        aria-current={settingsActive ? "page" : undefined}
        className={`rounded-lg p-2 transition-colors hover:bg-panel2 hover:text-ink ${
          settingsActive ? "text-accent" : "text-ink2"
        }`}
      >
        <SettingsIcon size={20} />
      </button>
    </header>
  );
}

export function MobileNav({
  items,
  activeId,
  onSelect,
  rail,
}: {
  items: NavItem[];
  activeId: PageId;
  onSelect: (id: PageId) => void;
  /** Querformat: senkrechte Rail links statt Leiste unten. */
  rail: boolean;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className={
        rail
          ? "mobile-nav-rail flex w-[72px] shrink-0 flex-col justify-center gap-1 border-r border-line bg-panel"
          : "mobile-bottom-nav flex shrink-0 items-stretch border-t border-line bg-panel"
      }
    >
      {items.map(({ id, labelKey, icon: Icon }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center gap-0.5 transition-colors ${
              rail ? "py-1.5" : "flex-1 pt-1.5"
            } ${active ? "text-accent" : "text-ink3"}`}
          >
            <span
              className={`flex h-6 w-12 items-center justify-center rounded-full transition-colors ${
                active ? "bg-accent-soft" : ""
              }`}
            >
              <Icon size={19} />
            </span>
            <span className="max-w-full truncate px-0.5 text-[10.5px]">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
