import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import StudyPlanner from "./StudyPlanner";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const TEMPLATE = {
  id: 3,
  title: "Tactics",
  duration_min: 0,
  tool: "Kiebitz Puzzles",
  description: "15–20 puzzles",
  area: "tactics",
  areas: ["tactics"],
  builtin: "tactics",
  i18n_key: "",
};

/** Eine eigene Einheit · nur die darf gelöscht werden. */
const OWN_TEMPLATE = { ...TEMPLATE, id: 7, title: "Kalkulation", builtin: "", i18n_key: "" };

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Die Plantafel beginnt heute, nicht am Montag. */
const today = isoDay(new Date());

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((command: string) => {
    switch (command) {
      case "get_settings":
        return Promise.resolve({ locale: "de" });
      case "study_calendar":
        return Promise.resolve({
          templates: [TEMPLATE, OWN_TEMPLATE],
          events: [],
          days: [
            {
              day: today,
              puzzle_attempts: 4,
              puzzle_solved: 4,
              endgame_attempts: 0,
              rep_reviews: 1,
              game_reviews: 0,
              actual_minutes: 7,
              due_reviews: 2,
            },
          ],
        });
      case "schedule_study_unit":
        return Promise.resolve();
      default:
        return Promise.reject(new Error(`Unexpected invoke command: ${command}`));
    }
  });
});

afterEach(cleanup);

/** Die Einheiten sind standardmäßig eingeklappt. */
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

describe("Plantafel", () => {
  it("stellt gemessene Minuten neben die geplanten", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop />
      </LocaleProvider>
    );

    expect(await screen.findByText(/7 von 0 Min\./)).toBeTruthy();
    expect(await screen.findByText(/2 fällig/)).toBeTruthy();
  });

  it("plant eine gezogene Einheit auf den Tag unter dem Zeiger, mit Länge aus dem Budget", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop suggestMinutes={() => 25} />
      </LocaleProvider>
    );
    await openLibrary();
    const grip = (await screen.findAllByLabelText("Einheit ziehen"))[0];

    pointToDay(today);
    fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, pointerType: "mouse", button: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 300 });

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("schedule_study_unit", {
        templateId: TEMPLATE.id,
        day: today,
        repeatRule: null,
        until: null,
        plannedMin: 25,
      })
    );
  });

  it("plant eine Serie, wenn das Raster in der Liste gesetzt ist", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop />
      </LocaleProvider>
    );
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

  it("ignoriert einen Klick, der sich nie bewegt hat", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop />
      </LocaleProvider>
    );
    await openLibrary();
    const grip = (await screen.findAllByLabelText("Einheit ziehen"))[0];

    pointToDay(today);
    fireEvent.pointerDown(grip, { clientX: 10, clientY: 10, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(window, { clientX: 12, clientY: 11 });

    expect(invokeMock).not.toHaveBeenCalledWith("schedule_study_unit", expect.anything());
  });

  it("lässt die Standardeinheiten stehen und nur eigene löschen", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop />
      </LocaleProvider>
    );
    await openLibrary();

    // Zwei Einheiten, aber nur eine davon trägt einen Papierkorb.
    const own = document.querySelector('[data-study-template="7"]');
    const builtin = document.querySelector('[data-study-template="3"]');
    expect(own?.querySelector('[aria-label="Löschen"]')).toBeTruthy();
    expect(builtin?.querySelector('[aria-label="Löschen"]')).toBeNull();
  });

  it("fragt im Editor nach Bereichen statt nach einer Dauer", async () => {
    render(
      <LocaleProvider>
        <StudyPlanner desktop />
      </LocaleProvider>
    );
    fireEvent.click(await screen.findByLabelText("Lerneinheit hinzufügen"));

    expect(await screen.findByText("Bereiche")).toBeTruthy();
    // Kein Dauerfeld mehr · die Länge kommt aus dem Wochenbudget.
    expect(screen.queryByText(/Dauer \(Min\.\)/)).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    // Alle fünf Kategorien stehen zur Wahl.
    for (const area of ["Spielen", "Taktik", "Eröffnung", "Endspiel", "Analyse"]) {
      expect(screen.getByRole("button", { name: area })).toBeTruthy();
    }
  });
});
