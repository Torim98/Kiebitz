/**
 * Das Abzeichen darf nie das falsche Modell behaupten.
 *
 * Zwei Fälle sind dabei heikler als der Normalfall: der Moment, in dem der
 * Zustand noch geladen wird — dort wäre ein voreiliges „Free" eine falsche
 * Auskunft an jemanden, der gerade bezahlt hat — und der Testzeitraum, der in
 * der schmalen App-Leiste zwar auf „Plus" verkürzt wird, für Vorlesewerkzeuge
 * aber vollständig lesbar bleiben muss.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PlanBadge from "./PlanBadge";

const plus = { loading: false, isPlus: false, isTrial: false };

vi.mock("../lib/plus/usePlus", () => ({
  usePlus: () => plus,
}));

beforeEach(() => {
  plus.loading = false;
  plus.isPlus = false;
  plus.isTrial = false;
});

describe("PlanBadge", () => {
  it("names the free plan", () => {
    render(<PlanBadge />);
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("names the plus plan", () => {
    plus.isPlus = true;
    render(<PlanBadge />);
    expect(screen.getByText("Plus")).toBeTruthy();
  });

  it("says nothing at all while the plan is still unknown", () => {
    plus.loading = true;
    const { container } = render(<PlanBadge />);
    expect(container.textContent).toBe("");
  });

  it("spells out the trial where there is room", () => {
    plus.isPlus = true;
    plus.isTrial = true;
    render(<PlanBadge />);
    expect(screen.getByText("Plus · Test")).toBeTruthy();
  });

  it("shortens the trial in the app bar but keeps it in the accessible name", () => {
    plus.isPlus = true;
    plus.isTrial = true;
    render(<PlanBadge compact />);
    expect(screen.getByText("Plus")).toBeTruthy();
    expect(screen.getByLabelText("Aktuelles Modell: Plus · Test")).toBeTruthy();
  });
});
