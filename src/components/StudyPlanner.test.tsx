import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import StudyPlanner from "./StudyPlanner";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const TEMPLATE = {
  id: 3,
  title: "Tactics",
  duration_min: 20,
  tool: "Kiebitz Puzzles",
  description: "15–20 puzzles",
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay() || 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
}

const monday = isoDay(mondayOf(new Date()));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_settings":
        return Promise.resolve({ locale: "de" });
      case "study_calendar":
        return Promise.resolve({
          templates: [TEMPLATE],
          events: [],
          days: [{ day: monday, puzzle_solved: 4, endgame_attempts: 0, rep_reviews: 1, game_reviews: 1, units: 15, due_reviews: 2 }],
        });
      case "schedule_study_unit":
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
});

afterEach(cleanup);

/** Die Vorlagen sind standardmäßig eingeklappt. */
async function openLibrary() {
  fireEvent.click(await screen.findByRole("button", { name: /Lerneinheiten/ }));
}

/**
 * Drag simulieren: die Zielzelle liegt laut elementFromPoint unter dem Zeiger.
 * jsdom kennt die Methode nicht · sie wird für den Test ergänzt.
 */
function pointToDay(day: string) {
  const cell = document.querySelector(`[data-study-day="${day}"]`);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => cell,
  });
}

describe("Week calendar", () => {
  it("shows units earned and reviews due per day", async () => {
    render(<LocaleProvider><StudyPlanner desktop /></LocaleProvider>);

    // 4 gelöste Puzzles + 1 Wiederholung + 1 Partie-Review (×10) = 15 Einheiten.
    expect(await screen.findByText(/15 Einheiten/)).toBeTruthy();
  });

  it("schedules a dragged template on the day under the pointer", async () => {
    render(<LocaleProvider><StudyPlanner desktop /></LocaleProvider>);
    await openLibrary();
    const grip = (await screen.findAllByLabelText("Einheit ziehen"))[0];

    pointToDay(monday);
    fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 300 });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("schedule_study_unit", {
        templateId: TEMPLATE.id,
        day: monday,
        repeatRule: null,
        until: null,
      })
    );
  });

  it("plans a weekly series when the library repeat is set", async () => {
    render(<LocaleProvider><StudyPlanner desktop /></LocaleProvider>);
    await openLibrary();

    fireEvent.change(await screen.findByLabelText("Wiederholung"), {
      target: { value: "weekly" },
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "Planen" }))[0]);

    await waitFor(() => {
      const call = invokeMock.mock.calls.find(([command]) => command === "schedule_study_unit");
      expect(call?.[1]).toMatchObject({ templateId: TEMPLATE.id, repeatRule: "weekly" });
      // Zwölf Wochentermine · das Enddatum liegt elf Wochen nach dem Start.
      expect(call?.[1].until).toBe(
        isoDay(new Date(Date.parse(`${call?.[1].day}T00:00:00Z`) + 11 * 7 * 86_400_000))
      );
    });
  });

  it("ignores a click that never moved", async () => {
    render(<LocaleProvider><StudyPlanner desktop /></LocaleProvider>);
    await openLibrary();
    const grip = (await screen.findAllByLabelText("Einheit ziehen"))[0];

    pointToDay(monday);
    fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(window, { clientX: 12, clientY: 11 });

    expect(invokeMock).not.toHaveBeenCalledWith("schedule_study_unit", expect.anything());
  });
});
