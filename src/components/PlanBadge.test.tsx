/**
 * Das Abzeichen darf nie das falsche Modell behaupten.
 *
 * Heikel ist vor allem der Moment, in dem der Zustand noch geladen wird — dort
 * wäre ein voreiliges „Free" eine falsche Auskunft an jemanden, der gerade
 * bezahlt hat. Der Testzeitraum dagegen ist bewusst kein Fall mehr: Wer testet,
 * hat Plus, und genau das steht dann auch da.
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

  it("calls the trial Plus, without a second word", () => {
    plus.isPlus = true;
    plus.isTrial = true;
    render(<PlanBadge />);
    expect(screen.getByText("Plus")).toBeTruthy();
    expect(screen.getByLabelText("Aktuelles Modell: Plus")).toBeTruthy();
  });
});
