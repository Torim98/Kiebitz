/**
 * Fokus-Brett · dieselbe Stellung, nur ohne alles andere.
 *
 * Jede Brettseite der App hat neben dem Brett noch etwas zu sagen:
 * Bewertungsverlauf, Zugliste, Statistik, Trainingsplan. Das ist der Grund,
 * warum man die Seiten benutzt · und genau das, was im Weg steht, wenn man
 * eine Stellung wirklich ansehen will. Der Fokus räumt es für einen Moment
 * weg: Kopfzeile, Brett, Bedienung, sonst nichts.
 *
 * Zwei Erscheinungsformen, eine Bauart:
 *
 * · Auf dem Handy ist es ein eigener Schirm. Er deckt den Inhaltsbereich
 *   vollständig ab, weil dort ohnehin nichts danebenpasst, und die
 *   Zurück-Taste schließt ihn wie eine Seite (siehe `useBackDismiss`).
 * · Auf dem Desktop legt er sich als Karte über die unscharf gestellte Seite ·
 *   dieselbe Form, die die App schon für Bestätigungen und Lizenztexte
 *   benutzt. Der Hintergrund bleibt sichtbar, weil man ihn gleich wieder
 *   braucht.
 *
 * Die Brettmaße rechnet `.board-focus` neu: Im Fokus gilt der ganze Schirm,
 * nicht mehr die Spalte einer Seite (siehe „Brettmaße" in src/index.css).
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { useMobileShell } from "./MobileShell";
import { useBackDismiss } from "../lib/backDismiss";
import { Button } from "./ui";

/**
 * Der Griff, der den Fokus öffnet · gehört auf jeder Seite in die Leiste beim
 * Brett, damit er dort steht, wo man das Brett gerade bedient.
 */
export function FocusButton({ onClick, compact = true }: { onClick: () => void; compact?: boolean }) {
  const t = useT();
  return (
    <Button onClick={onClick} title={t("board.focusOpen")} label={t("board.focusOpen")} compact={compact}>
      <Maximize2 size={15} />
      {!compact && t("board.focus")}
    </Button>
  );
}

export default function FocusBoard({
  open,
  onClose,
  title,
  subtitle,
  above,
  below,
  frameWidth = "var(--board-edge)",
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Woher die Stellung kommt · „Analyse", „Tagesaufgabe", der Drill-Name. */
  title: string;
  /** Eine Zeile Kontext, wenn die Seite eine hat. */
  subtitle?: ReactNode;
  /** Direkt über dem Brett · Aufgabe, Spieler, Status. */
  above?: ReactNode;
  /** Direkt unter dem Brett · die Bedienleiste der Seite. */
  below?: ReactNode;
  /**
   * Breite der Inhaltsspalte. Ohne sie hätte das Brett hier gar keine Grenze:
   * Die Karte richtet sich nach ihrem Inhalt, der Inhalt nach der Karte, und
   * am Ende gilt nur noch `BOARD_MAX` · das Brett würde höher als der Schirm.
   *
   * Voreinstellung ist die Brettkante. Seiten, die neben dem Brett noch etwas
   * stehen haben (die Analyse ihren Bewertungsbalken), reichen stattdessen
   * `var(--board-col)` herein.
   */
  frameWidth?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <FocusLayer
      title={title}
      subtitle={subtitle}
      above={above}
      below={below}
      frameWidth={frameWidth}
      onClose={onClose}
    >
      {children}
    </FocusLayer>
  );
}

/**
 * Eigene Komponente, damit die Haken (History-Eintrag, Escape) erst laufen,
 * wenn der Fokus wirklich offen ist · ein Haken hinter einem `if` gäbe es
 * nicht.
 */
function FocusLayer({
  title,
  subtitle,
  above,
  below,
  frameWidth,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  above?: ReactNode;
  below?: ReactNode;
  frameWidth: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const mobile = useMobileShell();
  const [container] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body
  );

  useBackDismiss(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!container) return null;

  const head = (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold tracking-tight text-ink">{title}</div>
        {subtitle && <div className="truncate text-[12px] text-ink3">{subtitle}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("board.focusClose")}
        title={t("board.focusClose")}
        className="-mr-1 shrink-0 rounded-lg p-2 text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
      >
        {mobile ? <Minimize2 size={19} /> : <X size={18} />}
      </button>
    </header>
  );

  // Der Innenabstand steht hier und nicht an der Karte: Das Brett tritt über
  // `.board-bleed` genau um ihn wieder heraus und erreicht so die Kante,
  // während Beschriftungen und Leisten ihren Rand behalten.
  // `m-auto` statt `justify-center`: Ein zentrierter Flex-Container schneidet
  // den Anfang seines Inhalts ab, sobald der überläuft · genau dann fehlte die
  // achte Reihe. So bleibt die Mitte die Mitte, und was nicht passt, ist
  // erreichbar.
  const body = (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div className="m-auto flex w-full flex-col gap-2" style={{ maxWidth: frameWidth }}>
        {above}
        {children}
        {below}
      </div>
    </div>
  );

  // Auf dem Handy trägt der Schirm die Fläche selbst; auf dem Desktop ist er
  // eine Karte auf einem unscharfen Schleier.
  if (mobile) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="focus-board"
        className="board-focus fixed inset-0 z-50 flex flex-col bg-bg"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {head}
        {body}
      </div>,
      container
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="focus-board"
      className="board-focus fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-auto max-w-full flex-col overflow-hidden rounded-2xl border border-line2 bg-panel pb-1 shadow-2xl shadow-black/50">
        {head}
        {body}
      </div>
    </div>,
    container
  );
}
