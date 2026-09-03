/**
 * Die Hülle des Diagramm-Modus · das Register statt der Navigationsleiste.
 *
 * Ein Buch führt vorne sein Inhaltsverzeichnis: Kapitel links, Punktlinie,
 * Zahl rechts. Dieselbe Zeile beantwortet damit zwei Fragen auf einmal — wohin
 * es geht und was dort offen ist. Der laufende Abschnitt bekommt kein
 * gefülltes Feld, sondern eine Marke am Bund, wie ein eingelegtes Lesezeichen.
 *
 * Das ist Hülle und nicht Seiteninhalt: Sie steht auf jedem Tab gleich, sonst
 * verwandelte sie sich beim Blättern. Sie erscheint nur, solange der Modus an
 * ist; App.tsx entscheidet das an einer Stelle.
 *
 * Die Zahlen unterscheiden Bestand und offenen Posten: 1.519 Partien sind ein
 * Bestand und stehen blass, 14 fällige Wiederholungen sind ein Grund
 * hinzugehen und stehen kräftig.
 */
import type { ReactNode } from "react";
import { Bird, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import type { PageId } from "../../lib/nav";
import { useT, type Key } from "../../lib/i18n";
import PlanBadge from "../PlanBadge";
import "./blatt.css";

export interface RegisterItem {
  id: PageId;
  labelKey: Key;
  icon: LucideIcon;
}

/** Was rechts in der Zeile steht · `offen` macht daraus einen Grund, nicht nur eine Zahl. */
export interface RegisterZahl {
  text: string;
  offen: boolean;
}

export type RegisterZahlen = Partial<Record<PageId, RegisterZahl>>;

/** Die Marke · dieselbe wie in der heutigen Leiste, nur anders gesetzt. */
function Marke() {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
      {/* Kein Rund, kein Farbfeld · ein Kasten aus einer Haarlinie. */}
      <span className="flex h-9 w-9 flex-none items-center justify-center border border-ink text-ink">
        <Bird size={20} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold uppercase tracking-[0.14em]">Kiebitz</span>
          <PlanBadge />
        </div>
        <div className="mt-0.5 text-[11px] text-ink3">{t("app.tagline")}</div>
      </div>
    </div>
  );
}

export function RegisterSidebar({
  items,
  page,
  zahlen,
  onSelect,
  foot,
}: {
  items: readonly RegisterItem[];
  page: PageId;
  zahlen: RegisterZahlen;
  onSelect: (id: PageId) => void;
  /** Der Stand der Datenbank · zwei Zeilen Kleinsatz. */
  foot: ReactNode;
}) {
  const t = useT();
  const settingsActive = page === "settings";
  return (
    <>
      <Marke />
      <div className="px-5 pb-2">
        <div className="blatt-feld border-b border-ink pb-1.5 text-ink3">{t("blatt.contents")}</div>
      </div>
      <nav aria-label={t("nav.main")} className="flex flex-col">
        {items.map(({ id, labelKey }) => {
          const active = page === id;
          const zahl = zahlen[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              data-tour={`nav-${id}`}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-11 items-baseline gap-2 px-5 text-start"
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-y-[9px] start-0 w-[3px] bg-ink"
                />
              )}
              <span
                className={`text-[14.5px] ${active ? "font-semibold text-ink" : "text-ink2"}`}
              >
                {t(labelKey)}
              </span>
              <span aria-hidden className="blatt-punktlinie" />
              <span
                className={`blatt-zahl text-[11.5px] ${
                  zahl?.offen ? "font-medium text-ink" : "text-ink3"
                }`}
              >
                {zahl?.text ?? ""}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="flex-1" />
      <div className="px-5 pb-5">
        <div className="mb-[9px] h-px bg-line2" />
        <div className="blatt-zahl text-[11px] leading-[1.6] text-ink3">{foot}</div>
        <button
          type="button"
          onClick={() => onSelect("settings")}
          data-tour="nav-settings"
          aria-current={settingsActive ? "page" : undefined}
          className={`mt-1 flex min-h-11 w-full items-center gap-[9px] text-start text-[14px] ${
            settingsActive ? "font-medium text-ink" : "text-ink2"
          }`}
        >
          <SettingsIcon size={15} className="text-ink3" />
          {t("nav.settings")}
        </button>
      </div>
    </>
  );
}

/**
 * Die Reiterleiste des Telefons im Register-Satz.
 *
 * Kein gefülltes Feld hinter dem Symbol, sondern ein Strich an der oberen
 * Kante — dort, wo die Leiste ansetzt, wie die Marke am Bund des Registers.
 * Höhe 56 px, damit die Trefferfläche über den 44 px bleibt; der Gestenbereich
 * unten kommt wie heute aus `mobile-bottom-nav`.
 */
export function RegisterNav({
  items,
  activeId,
  onSelect,
  rail,
}: {
  items: readonly RegisterItem[];
  activeId: PageId;
  onSelect: (id: PageId) => void;
  rail: boolean;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("nav.main")}
      className={
        rail
          ? "mobile-nav-rail flex w-[72px] shrink-0 flex-col justify-center gap-1 border-e border-line bg-panel"
          : "mobile-bottom-nav flex shrink-0 items-stretch border-t border-line bg-panel"
      }
    >
      {items.map(({ id, labelKey, icon: Icon }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            data-tour={`nav-${id}`}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-[3px] ${
              rail ? "py-2" : "h-14 flex-1"
            } ${active ? "text-ink" : "text-ink3"}`}
          >
            {active && (
              <span
                aria-hidden
                className={
                  rail
                    ? "absolute inset-y-2 start-0 w-[2px] bg-ink"
                    : "absolute inset-x-[14px] top-0 h-[2px] bg-ink"
                }
              />
            )}
            <Icon size={19} />
            <span
              className={`blatt-feld max-w-full truncate px-0.5 ${active ? "font-semibold" : "font-normal"}`}
            >
              {t(labelKey)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
