/**
 * Das Register — die Hülle des Modus.
 *
 * Geprüft wird, was die Zeile leisten soll: hinführen und zugleich sagen, was
 * dort offen ist, ohne einen Bestand zu einem Grund zu machen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Database, LayoutDashboard, Puzzle } from "lucide-react";
import {
  RegisterAppBar,
  RegisterNav,
  RegisterSidebar,
  registerZahlen,
  type RegisterItem,
} from "./Register";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ locale: "de", t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock("../PlanBadge", () => ({ default: () => null }));

afterEach(cleanup);

const items: RegisterItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "games", labelKey: "nav.games", icon: Database },
  { id: "puzzles", labelKey: "nav.puzzles", icon: Puzzle },
];

describe("Register", () => {
  it("tells a holding from an open item", () => {
    render(
      <RegisterSidebar
        items={items}
        page="dashboard"
        zahlen={{
          games: { text: "1.519", offen: false },
          puzzles: { text: "12/20", offen: true },
        }}
        onSelect={vi.fn()}
        foot="SQLite"
      />
    );
    // Der Bestand steht blass, der offene Posten kräftig · genau daran soll
    // man sehen, wo es etwas zu tun gibt.
    expect(screen.getByText("1.519").className).toContain("text-ink3");
    expect(screen.getByText("12/20").className).toContain("text-ink");
    expect(screen.getByText("12/20").className).not.toContain("text-ink3");
  });

  it("leaves the column empty rather than inventing a zero", () => {
    render(
      <RegisterSidebar
        items={items}
        page="dashboard"
        zahlen={{}}
        onSelect={vi.fn()}
        foot="SQLite"
      />
    );
    expect(screen.queryByText("0")).toBeNull();
  });

  it("marks the running chapter and navigates", () => {
    const onSelect = vi.fn();
    render(
      <RegisterSidebar
        items={items}
        page="games"
        zahlen={{}}
        onSelect={onSelect}
        foot="SQLite"
      />
    );
    expect(screen.getByText("nav.games").closest("button")!.getAttribute("aria-current")).toBe(
      "page"
    );
    expect(
      screen.getByText("nav.dashboard").closest("button")!.getAttribute("aria-current")
    ).toBeNull();
    fireEvent.click(screen.getByText("nav.puzzles"));
    expect(onSelect).toHaveBeenCalledWith("puzzles");
  });

  it("carries the same handles in the app bar as the ordinary one", () => {
    const onSettings = vi.fn();
    const onBack = vi.fn();
    render(
      <RegisterAppBar
        title="nav.settings"
        showBack
        onBack={onBack}
        onSettings={onSettings}
        settingsActive
      />
    );
    expect(screen.getByText("Kiebitz")).toBeTruthy();
    // Der Kolumnentitel nennt das Kapitel neben der Marke.
    expect(screen.getByText(/nav\.settings/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("app.back"));
    expect(onBack).toHaveBeenCalled();
    const zahnrad = screen.getByLabelText("nav.settings");
    expect(zahnrad.getAttribute("aria-current")).toBe("page");
    fireEvent.click(zahnrad);
    expect(onSettings).toHaveBeenCalled();
  });

  it("shows the claim on the start, where there is no chapter", () => {
    render(
      <RegisterAppBar
        title={null}
        showBack={false}
        onBack={vi.fn()}
        onSettings={vi.fn()}
        settingsActive={false}
      />
    );
    expect(screen.getByText(/app\.tagline/)).toBeTruthy();
    expect(screen.queryByLabelText("app.back")).toBeNull();
  });

  it("keeps the tab bar reachable on a phone", () => {
    render(
      <RegisterNav items={items} activeId="games" onSelect={vi.fn()} rail={false} />
    );
    // 56 px hoch · über den geforderten 44.
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("h-14");
    }
  });
  /**
   * Die Regel, nach der die Zahlen überhaupt entstehen.
   *
   * Sie ist der Grund, warum die Repertoire-Zeile an einem Tag ohne fällige
   * Wiederholung genauso aussieht wie Endspiele und Insights: leer.
   */
  describe("registerZahlen", () => {
    const voll = { analysis: 4, repertoire: 14, puzzles: 12, puzzleGoal: 20 };

    it("marks a holding pale and an open item bold", () => {
      // Dreistellig, damit die Prüfung nicht am Tausendertrennzeichen der
      // gerade eingestellten Sprache hängt · geprüft wird die Regel, nicht
      // die Zahlenschreibung (die steht in lib/format).
      const zahlen = registerZahlen({ gameCount: 519, openItems: voll });
      expect(zahlen.games).toEqual({ text: "519", offen: false });
      expect(zahlen.repertoire).toEqual({ text: "14", offen: true });
      expect(zahlen.analysis).toEqual({ text: "4", offen: true });
    });

    it("leaves the line empty instead of writing a zero", () => {
      const zahlen = registerZahlen({
        gameCount: 519,
        openItems: { ...voll, analysis: 0, repertoire: 0 },
      });
      expect(zahlen.repertoire).toBeUndefined();
      expect(zahlen.analysis).toBeUndefined();
    });

    it("keeps the daily puzzle goal, which is a standing and not a zero", () => {
      const zahlen = registerZahlen({
        gameCount: null,
        openItems: { ...voll, puzzles: 0 },
      });
      expect(zahlen.puzzles).toEqual({ text: "0/20", offen: true });
      // Ohne gezählte Datenbank steht auch kein Bestand da.
      expect(zahlen.games).toBeUndefined();
    });

    it("stays empty as long as nothing has been counted", () => {
      expect(registerZahlen({ gameCount: null, openItems: null })).toEqual({});
    });
  });
});
