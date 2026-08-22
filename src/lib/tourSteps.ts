/**
 * Die Stationen des geführten Rundgangs.
 *
 * Ein Schritt sagt drei Dinge: auf welcher Seite er spielt, welches echte
 * Bedienelement er ausleuchtet und was dazu zu sagen ist. Der Text ist auf
 * beiden Plattformen derselbe · was sich unterscheidet, ist die Stelle, an der
 * die Funktion sitzt, und genau die zeigt der Rundgang. Deshalb steht hier
 * nicht zweimal derselbe Satz, sondern nur zweimal ein anderer Anker.
 *
 * Die Anker sind `data-tour`-Marken im Markup. Fehlt eine (Seite noch nicht
 * geladen, Element in dieser Ansicht nicht vorhanden), zeigt der Rundgang den
 * Schritt mittig ohne Ausleuchtung · er bricht nie ab.
 */
import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  GraduationCap,
  LayoutDashboard,
  Search,
  ShieldCheck,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { Key } from "./i18n";
import type { PageId } from "./nav";

/** Bevorzugte Seite der Sprechblase relativ zum ausgeleuchteten Bereich. */
export type TourSide = "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: string;
  icon: LucideIcon;
  title: Key;
  body: Key;
  /** Seite, auf die der Rundgang wechselt, bevor der Schritt erscheint. */
  page?: PageId;
  /**
   * `data-tour`-Marken. Mehrere ergeben zusammen einen Bereich · so lassen
   * sich die vier Trainingseinträge der Seitenleiste als eine Gruppe zeigen.
   */
  anchors: string[];
  /** Wunschseite der Blase; ohne Angabe entscheidet der freie Platz. */
  prefer?: TourSide;
}

/**
 * Rundgang für die aktuelle Shell.
 *
 * Desktop und Handy teilen sich die Ankernamen der Navigation (`nav-…`), weil
 * beide Shells dieselben Ziele anbieten · nur eben einmal als Seitenleiste und
 * einmal als Leiste unten. Auseinander gehen sie beim Training: der Desktop
 * hat für Repertoire, Endspiele und Puzzles je einen eigenen Eintrag, mobil
 * führt der Trainings-Tab zu den dreien.
 */
export function tourSteps(mobile: boolean): TourStep[] {
  return [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      title: "tour.dashboard.title",
      body: "tour.dashboard.body",
      page: "dashboard",
      anchors: ["nav-dashboard"],
      prefer: mobile ? "top" : "right",
    },
    {
      id: "games",
      icon: Database,
      title: "tour.games.title",
      body: "tour.games.body",
      page: "games",
      anchors: ["nav-games"],
      prefer: mobile ? "top" : "right",
    },
    {
      id: "search",
      icon: Search,
      title: "tour.search.title",
      body: "tour.search.body",
      page: "games",
      anchors: ["games-search"],
      prefer: "bottom",
    },
    {
      id: "analysis",
      icon: Activity,
      title: "tour.analysis.title",
      body: "tour.analysis.body",
      page: "analysis",
      anchors: ["nav-analysis"],
      prefer: mobile ? "top" : "right",
    },
    {
      id: "engine",
      icon: Cpu,
      title: "tour.engine.title",
      body: "tour.engine.body",
      page: "analysis",
      anchors: ["analysis-run"],
      prefer: "bottom",
    },
    {
      id: "training",
      icon: GraduationCap,
      title: "tour.training.title",
      body: "tour.training.body",
      page: "study",
      // Mobil stehen die drei Trainer als Kacheln auf der Trainingsseite; auf
      // dem Desktop hat jeder seinen eigenen Eintrag in der Seitenleiste.
      anchors: mobile
        ? ["study-areas"]
        : ["nav-repertoire", "nav-endgame", "nav-puzzles", "nav-study"],
      prefer: mobile ? "bottom" : "right",
    },
    {
      id: "plan",
      icon: Target,
      title: "tour.plan.title",
      body: "tour.plan.body",
      page: "study",
      anchors: ["study-plan"],
      prefer: mobile ? "top" : "left",
    },
    {
      id: "insights",
      icon: BarChart3,
      title: "tour.insights.title",
      body: "tour.insights.body",
      page: "insights",
      anchors: ["insights-tabs"],
      prefer: "bottom",
    },
    {
      // Kein Seitenwechsel: Die Einstellungen sind das Ziel, auf das gezeigt
      // wird · sie zu öffnen würde den Rundgang mitten in eine Liste stellen,
      // durch die niemand geführt werden will.
      id: "settings",
      icon: ShieldCheck,
      title: "tour.settings.title",
      body: "tour.settings.body",
      anchors: ["nav-settings"],
      prefer: mobile ? "bottom" : "right",
    },
  ];
}
