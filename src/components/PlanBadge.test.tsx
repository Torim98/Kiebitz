/**
 * Das Abzeichen darf nie das falsche Modell behaupten.
 *
 * Heikel ist vor allem der Moment, in dem der Zustand noch geladen wird — dort
 * wäre ein voreiliges „Free" eine falsche Auskunft an jemanden, der gerade
 * bezahlt hat. Der Testzeitraum dagegen ist bewusst kein Fall mehr: Wer testet,
 * hat Plus, und genau das steht dann auch da.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import PlanBadge from "./PlanBadge";

const plus = { loading: false, isPlus: false, isTrial: false };
const diagram = { an: false };

vi.mock("../lib/plus/usePlus", () => ({
  usePlus: () => plus,
}));

vi.mock("../lib/diagramMode", () => ({
  useDiagramMode: () => diagram.an,
}));

beforeEach(() => {
  plus.loading = false;
  plus.isPlus = false;
  plus.isTrial = false;
  diagram.an = false;
});

afterEach(cleanup);

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

  /**
   * Im Diagramm-Modus ist das Abzeichen der Vermerk auf einem Formular: ein
   * Kasten aus einer Haarlinie, kein gerundetes Feld mit Füllung und Funkeln.
   * Gesagt wird dasselbe Wort · nur gesetzt ist es anders.
   */
  it("becomes a stamp on the form in diagram mode", () => {
    diagram.an = true;
    plus.isPlus = true;
    const { container } = render(<PlanBadge />);
    const abzeichen = screen.getByText("Plus");
    expect(abzeichen.className).not.toContain("rounded-full");
    expect(abzeichen.className).not.toContain("bg-accent-soft");
    expect(abzeichen.className).toContain("border-ink");
    // Kein Symbol im Buchsatz.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the pill outside the mode", () => {
    plus.isPlus = true;
    render(<PlanBadge />);
    expect(screen.getByText("Plus").className).toContain("rounded-full");
  });

  it("calls the trial Plus, without a second word", () => {
    plus.isPlus = true;
    plus.isTrial = true;
    render(<PlanBadge />);
    expect(screen.getByText("Plus")).toBeTruthy();
    expect(screen.getByLabelText("Aktuelles Modell: Plus")).toBeTruthy();
  });
});
