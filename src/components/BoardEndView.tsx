/**
 * Aus dem Partieende wird eine Brettansicht.
 *
 * `lib/boardEnd.ts` beantwortet die Sachfrage (was ist passiert), diese Datei
 * die Darstellungsfrage (wie heißt es hier, welches Zeichen steht auf dem
 * König, welche Farbe). Getrennt, weil das Brett selbst weder Sprache noch
 * Regeln kennen soll · es bekommt einen fertigen Satz und ein Zeichen.
 */
import { useMemo, type ReactNode } from "react";
import { Ban, Clock, Flag, LogOut } from "lucide-react";
import { useI18n, type Key, type TFunc } from "../lib/i18n";
import { isDecisive, type BoardEnd, type Termination } from "../lib/boardEnd";
import type { BoardEndView } from "./Board";

/** Zeichen auf dem Feld des betroffenen Königs. */
function markFor(reason: Termination | null, decisive: boolean): ReactNode {
  switch (reason) {
    case "mate":
      return "#";
    case "timeout":
      return <Clock size="62%" strokeWidth={3} />;
    case "resign":
      return <Flag size="62%" strokeWidth={3} />;
    case "abandoned":
      return <LogOut size="62%" strokeWidth={3} />;
    case "rules":
      return <Ban size="62%" strokeWidth={3} />;
    default:
      // Patt und die übrigen Remis-Gründe · und der Fall, in dem nur der
      // Ausgang bekannt ist.
      return decisive ? "#" : "½";
  }
}

const REASON_KEY: Record<Termination, Key> = {
  mate: "end.reason.mate",
  resign: "end.reason.resign",
  timeout: "end.reason.timeout",
  stalemate: "end.reason.stalemate",
  agreement: "end.reason.agreement",
  repetition: "end.reason.repetition",
  fifty: "end.reason.fifty",
  insufficient: "end.reason.insufficient",
  abandoned: "end.reason.abandoned",
  rules: "end.reason.rules",
};

/**
 * Wie das Ende heißt · „Weiß gewinnt durch Aufgabe", „Remis durch Patt".
 *
 * Der Satz steht nicht nur auf dem Brett: Im Diagramm-Modus trägt ihn auch die
 * Bildunterschrift unter der Schlussstellung. Deshalb steht er hier für sich
 * und nicht in der Brettansicht eingeschlossen.
 */
export function endLabel(
  reason: Termination | null,
  winner: "white" | "black" | null,
  t: TFunc
): string {
  const outcome = winner
    ? t(winner === "white" ? "end.whiteWins" : "end.blackWins")
    : t("end.draw");
  if (!reason) return outcome;
  return winner
    ? t("end.winBy", { side: outcome, reason: t(REASON_KEY[reason]) })
    : t("end.drawBy", { reason: t(REASON_KEY[reason]) });
}

/**
 * Übersetzte Brettansicht eines Partieendes; null, wenn keins vorliegt.
 * Der Rückgabewert ist stabil, solange sich das Ende nicht ändert · das Brett
 * ist memoisiert und soll nicht an einem neuen Objekt hängen bleiben.
 */
export function useBoardEndView(end: BoardEnd | null): BoardEndView | null {
  const { t } = useI18n();
  // Die vier Werte beschreiben das Ende vollständig · `end` selbst ist bei
  // jedem Render ein neues Objekt und taugt nicht als Abhängigkeit. `present`
  // fehlt dabei nicht zufällig: ein Remis ohne bekannten Grund hat dieselben
  // drei null-Felder wie „kein Ende".
  const present = end != null;
  const reason = end?.reason ?? null;
  const winner = end?.winner ?? null;
  const square = end?.square ?? null;

  return useMemo(() => {
    if (!present) return null;
    const decisive = winner != null || (reason != null && isDecisive(reason));
    const label = endLabel(reason, winner, t);

    return {
      square,
      mark: markFor(reason, decisive),
      // Der Marker sitzt auf dem König der Verliererseite · deshalb trägt er
      // deren Farbe, nicht die des Siegers.
      color: decisive ? "var(--color-loss)" : "var(--color-draw)",
      label,
      dismissLabel: t("end.dismiss"),
    };
  }, [present, reason, winner, square, t]);
}
