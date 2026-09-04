import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { tourSteps } from "../lib/tourSteps";
import GuidedTour from "./GuidedTour";

// Die Texte stehen im Wörterbuch; hier interessiert nur, welcher Schritt
// gerade dran ist · deshalb steht der Schlüssel selbst in der Blase.
vi.mock("../lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/i18n")>()),
  useT: () => (key: string) => key,
}));

const created: HTMLElement[] = [];

/** Ein Bedienelement mit Rundgang-Marke · samt Lage, die jsdom nicht kennt. */
function anchor(mark: string, rect: { top: number; left: number; width: number; height: number }) {
  const node = document.createElement("div");
  node.dataset.tour = mark;
  node.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => "",
    }) as DOMRect;
  document.body.appendChild(node);
  created.push(node);
  return node;
}

/**
 * Der reservierte Platz der Android-Anzeige.
 *
 * Im Gerät liegt dort eine native Fläche über dem WebView; im Test genügt der
 * Slot mit seiner Lage, denn genau danach richtet sich die Blase.
 */
function adSlot(top: number, height = 50) {
  const node = document.createElement("div");
  node.dataset.adSlot = "android-banner";
  node.getBoundingClientRect = () =>
    ({
      top,
      left: 0,
      width: 360,
      height,
      right: 360,
      bottom: top + height,
      x: 0,
      y: top,
      toJSON: () => "",
    }) as DOMRect;
  document.body.appendChild(node);
  created.push(node);
  return node;
}

afterEach(() => {
  created.splice(0).forEach((node) => node.remove());
});

const steps = tourSteps(false);

describe("GuidedTour", () => {
  it("wechselt auf die Seite des Schritts und leuchtet ihr Bedienelement aus", async () => {
    anchor("nav-dashboard", { top: 100, left: 8, width: 200, height: 36 });
    const onNavigate = vi.fn();

    render(<GuidedTour steps={steps} onNavigate={onNavigate} onDone={vi.fn()} />);

    expect(onNavigate).toHaveBeenCalledWith("dashboard");
    expect(screen.getByRole("dialog").textContent).toContain("tour.dashboard.title");

    // Der Ausschnitt liegt über dem Element, mit etwas Luft ringsum.
    await waitFor(() => expect(document.querySelector(".tour-spot")).toBeTruthy());
    const spot = document.querySelector<HTMLElement>(".tour-spot")!;
    expect(spot.style.top).toBe("94px");
    expect(spot.style.left).toBe("2px");
    expect(spot.style.width).toBe("212px");
  });

  it("führt Schritt für Schritt weiter und wieder zurück", async () => {
    const onNavigate = vi.fn();
    render(<GuidedTour steps={steps} onNavigate={onNavigate} onDone={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "tour.next" }));
    expect(dialog.textContent).toContain("tour.games.title");
    expect(onNavigate).toHaveBeenLastCalledWith("games");

    fireEvent.click(screen.getByRole("button", { name: "tour.back" }));
    expect(dialog.textContent).toContain("tour.dashboard.title");

    // Auf dem ersten Schritt führt Zurück nirgendwohin.
    expect(screen.getByRole("button", { name: "tour.back" }).hasAttribute("disabled")).toBe(true);
  });

  it("lässt über die Punkte springen und schließt auf dem letzten Schritt ab", () => {
    const onDone = vi.fn();
    render(<GuidedTour steps={steps} onNavigate={vi.fn()} onDone={onDone} />);

    const dots = screen.getAllByRole("button", { name: "tour.step" });
    expect(dots.length).toBe(steps.length);

    fireEvent.click(dots[dots.length - 1]);
    expect(screen.getByRole("dialog").textContent).toContain("tour.settings.title");
    // Am Ende gibt es kein Überspringen mehr, nur noch Abschließen.
    expect(screen.queryByRole("button", { name: "tour.skip" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "tour.done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("deckelt lange Karten, damit die Blase noch irgendwo hinpasst", async () => {
    // Die Trainingsvorschläge sind auf dem Handy über tausend Pixel hoch ·
    // ausgeleuchtet wird davon der sichtbare Anfang, nicht das ganze Fenster.
    anchor("study-plan", { top: 20, left: 16, width: 343, height: 1200 });
    render(<GuidedTour steps={steps} onNavigate={vi.fn()} onDone={vi.fn()} />);

    const dots = screen.getAllByRole("button", { name: "tour.step" });
    fireEvent.click(dots[6]);

    await waitFor(() => expect(document.querySelector(".tour-spot")).toBeTruthy());
    const spot = document.querySelector<HTMLElement>(".tour-spot")!;
    // window.innerHeight liegt in jsdom bei 768 · 55 % davon sind 422,4;
    // dazu die Luft von 6 px oben und unten.
    expect(Number.parseFloat(spot.style.height)).toBeCloseTo(434.4, 1);
    // Unter dem Ausschnitt bleibt Platz, also steht die Blase dort.
    expect(Number.parseFloat(screen.getByRole("dialog").style.top)).toBeGreaterThan(440);
  });

  it("stellt sich nicht unter die Anzeige", async () => {
    // Die Leiste unten wie auf dem Handy, darüber die Anzeige: jsdom misst
    // 768 px Höhe, die Anzeige beginnt bei 660.
    anchor("nav-dashboard", { top: 712, left: 8, width: 344, height: 48 });
    adSlot(660);
    render(<GuidedTour steps={steps} onNavigate={vi.fn()} onDone={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.style.top).not.toBe(""));
    // Die Blase steht ganz oberhalb der Anzeige · gemessen wird ihre Unterkante,
    // und ohne Layout in jsdom zählt dafür das Ausweichmaß.
    const top = Number.parseFloat(dialog.style.top);
    expect(top + 210).toBeLessThanOrEqual(660);
  });

  it("bricht nicht ab, wenn das Element eines Schritts fehlt", async () => {
    render(<GuidedTour steps={steps} onNavigate={vi.fn()} onDone={vi.fn()} />);

    // Ohne Treffer bleibt der Schritt stehen · nur eben ohne Ausschnitt.
    await waitFor(() => expect(screen.getByRole("dialog").style.top).not.toBe(""));
    expect(document.querySelector(".tour-spot")).toBeNull();
    expect(screen.getByRole("dialog").textContent).toContain("tour.dashboard.body");
  });

  it("beendet den Rundgang mit Escape und über Überspringen", () => {
    const onDone = vi.fn();
    const { unmount } = render(<GuidedTour steps={steps} onNavigate={vi.fn()} onDone={onDone} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "tour.skip" }));
    expect(onDone).toHaveBeenCalledTimes(2);
    unmount();
  });
});
