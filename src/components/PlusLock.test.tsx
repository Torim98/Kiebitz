/**
 * Was an der Plus-Sperre nachprüfbar sein muss.
 *
 * Zwei Fehler wären mit bloßem Auge unsichtbar und trotzdem gravierend: ein
 * Knopf im Knopf (ungültiges HTML, doppeltes Tastaturziel) und eine gesperrte
 * Vorschau, die zwar gedämpft aussieht, per Tabulator aber voll bedienbar
 * bleibt. Beides prüft dieser Test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlusBadge, PlusBadgeButton, PlusLock } from "./PlusLock";
import type { PlusFeature } from "../lib/plus/types";

const gate = { unlocked: false, pending: false };

vi.mock("../lib/plus/usePlus", () => ({
  usePlusGate: () => ({ ...gate, plus: {} }),
}));

const opened = vi.fn();
vi.mock("../lib/plus/dialog", () => ({
  openPlusDialog: (feature: PlusFeature) => opened(feature),
}));

beforeEach(() => {
  gate.unlocked = false;
  gate.pending = false;
  opened.mockClear();
});

describe("PlusBadge", () => {
  it("is not a button, so it may sit inside one", () => {
    render(
      <button type="button">
        Alle analysieren
        <PlusBadge />
      </button>
    );
    // Genau ein Knopf · der Hinweis bringt keinen zweiten mit.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("becomes part of the surrounding button's name", () => {
    render(
      <button type="button">
        Alle analysieren
        <PlusBadge />
      </button>
    );
    expect(screen.getByRole("button").textContent).toContain("Mit Plus");
  });
});

describe("PlusBadgeButton", () => {
  it("opens the explanation and carries a name that stands alone", () => {
    render(<PlusBadgeButton feature="automatic_lan_sync" />);
    const button = screen.getByRole("button", {
      name: "Mit Plus · zeigt, was Kiebitz Plus enthält",
    });
    fireEvent.click(button);
    expect(opened).toHaveBeenCalledWith("automatic_lan_sync");
  });
});

describe("PlusLock", () => {
  const preview = (
    <div>
      <button type="button">Vorschau-Knopf</button>
      <a href="#deep">Vorschau-Link</a>
      <input aria-label="Vorschau-Feld" />
    </div>
  );

  it("takes the locked preview out of the tab order", () => {
    const { container } = render(<PlusLock feature="full_insights">{preview}</PlusLock>);
    const locked = container.querySelector("[aria-hidden='true']");
    expect(locked).not.toBeNull();
    expect(locked?.hasAttribute("inert")).toBe(true);
    for (const element of Array.from(locked!.querySelectorAll("button, a, input"))) {
      expect(element.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("keeps exactly one reachable control: the Plus entry", () => {
    render(<PlusLock feature="full_insights">{preview}</PlusLock>);
    const reachable = screen
      .getAllByRole("button", { hidden: true })
      .filter((element) => element.tabIndex >= 0);
    expect(reachable).toHaveLength(1);
    fireEvent.click(reachable[0]);
    expect(opened).toHaveBeenCalledWith("full_insights");
  });

  it("hands the preview back untouched once Plus applies", () => {
    const { container, rerender } = render(
      <PlusLock feature="full_insights">{preview}</PlusLock>
    );
    gate.unlocked = true;
    rerender(<PlusLock feature="full_insights">{preview}</PlusLock>);
    expect(container.querySelector("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Vorschau-Knopf" }).tabIndex).toBe(0);
  });

  it("shows the real content while the Plus state is still loading", () => {
    gate.pending = true;
    const { container } = render(<PlusLock feature="full_insights">{preview}</PlusLock>);
    expect(container.querySelector("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Vorschau-Knopf" })).toBeTruthy();
  });
});
