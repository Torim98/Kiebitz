import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../lib/i18n";
import MobileSheet, { SHEET_ROOT_ID } from "./MobileSheet";

afterEach(() => {
  cleanup();
  document.getElementById(SHEET_ROOT_ID)?.remove();
});

function open(props: Partial<Parameters<typeof MobileSheet>[0]> = {}) {
  return render(
    <LocaleProvider>
      <MobileSheet ariaLabel="Detail" title={<h2>Titel</h2>} onClose={() => {}} testId="sheet" {...props}>
        <p>Inhalt</p>
      </MobileSheet>
    </LocaleProvider>
  );
}

/** Wischen ohne echten Finger · nur die Koordinaten zählen. */
function swipe(panel: Element, from: number, to: number, dy = 2) {
  fireEvent.touchStart(panel, { touches: [{ clientX: from, clientY: 300 }] });
  fireEvent.touchMove(panel, { touches: [{ clientX: (from + to) / 2, clientY: 300 + dy }] });
  fireEvent.touchMove(panel, { touches: [{ clientX: to, clientY: 300 + dy }] });
  fireEvent.touchEnd(panel, { changedTouches: [{ clientX: to, clientY: 300 + dy }] });
}

describe("Detailblatt", () => {
  it("legt sich in den Inhaltsbereich, wenn es ihn gibt", () => {
    const root = document.createElement("div");
    root.id = SHEET_ROOT_ID;
    document.body.appendChild(root);

    open();
    // App-Bar und Navigation liegen außerhalb dieses Containers · sie bleiben
    // damit scharf und bedienbar.
    expect(root.querySelector("[data-testid='sheet']")).toBeTruthy();
    expect(screen.getByTestId("sheet").className).toContain("absolute");
  });

  it("deckt ohne Inhaltsbereich den ganzen Bildschirm ab", () => {
    open();
    expect(screen.getByTestId("sheet").className).toContain("fixed");
  });

  it("blättert per Wischen und lässt Scrollgesten in Ruhe", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    open({ onPrev, onNext });
    const panel = document.querySelector(".mobile-sheet-panel")!;

    swipe(panel, 300, 180);
    expect(onNext).toHaveBeenCalledTimes(1);

    swipe(panel, 100, 220);
    expect(onPrev).toHaveBeenCalledTimes(1);

    // Zu kurz für einen Seitenwechsel.
    swipe(panel, 200, 170);
    // Überwiegend senkrecht · das ist Scrollen, kein Blättern.
    swipe(panel, 200, 120, 200);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("schließt auf Android-Zurück, ohne die Seite darunter zu verlassen", async () => {
    const onClose = vi.fn();
    open({ onClose });
    expect((window.history.state as { sheet?: boolean } | null)?.sheet).toBe(true);

    act(() => window.history.back());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("räumt den eigenen History-Eintrag ab, wenn es geschlossen wird", async () => {
    const { unmount } = open();
    const before = window.history.length;
    unmount();

    await waitFor(() =>
      expect((window.history.state as { sheet?: boolean } | null)?.sheet).toBeUndefined()
    );
    expect(window.history.length).toBe(before);
  });
});
