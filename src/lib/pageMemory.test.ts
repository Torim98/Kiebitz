import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  forgetPages,
  keepScroll,
  rememberScroll,
  takeScroll,
  usePageMemory,
  type ScrollBox,
} from "./pageMemory";

/**
 * Ein Scroll-Container, der wie im Browser bei `scrollHeight` abschneidet ·
 * genau daran scheitert eine Wiederherstellung, solange die Seite noch lädt.
 */
function fakeBox(limit: number) {
  let top = 0;
  const listeners = new Map<string, EventListener>();
  return {
    get scrollTop() {
      return top;
    },
    set scrollTop(next: number) {
      top = Math.min(next, limit);
    },
    /** Der Inhalt ist da · ab jetzt reicht die Seite weiter nach unten. */
    grow(next: number) {
      limit = next;
    },
    fire(type: string) {
      listeners.get(type)?.(new Event(type));
    },
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
}

const asBox = (box: ReturnType<typeof fakeBox>) => box as unknown as ScrollBox;

afterEach(() => {
  forgetPages();
  vi.useRealTimers();
});

describe("scroll memory", () => {
  it("hands the remembered position back exactly once", () => {
    rememberScroll(2, 640);
    expect(takeScroll(2)).toBe(640);
    expect(takeScroll(2)).toBeUndefined();
  });

  it("knows nothing about levels it never left", () => {
    rememberScroll(2, 640);
    expect(takeScroll(3)).toBeUndefined();
  });

  it("forgets everything on a tab switch, so every tab starts at the top", () => {
    rememberScroll(2, 640);
    forgetPages();
    expect(takeScroll(2)).toBeUndefined();
  });
});

describe("keepScroll", () => {
  it("takes the position right away when the page is already long enough", () => {
    const box = fakeBox(2000);
    keepScroll(asBox(box), 640);
    expect(box.scrollTop).toBe(640);
  });

  it("holds on until the page has loaded its content", () => {
    vi.useFakeTimers();
    const box = fakeBox(0);
    keepScroll(asBox(box), 640);
    expect(box.scrollTop).toBe(0);

    box.grow(2000);
    act(() => void vi.advanceTimersByTime(50));
    expect(box.scrollTop).toBe(640);
  });

  it("gives up after two seconds instead of fighting a short page forever", () => {
    vi.useFakeTimers();
    const box = fakeBox(100);
    keepScroll(asBox(box), 640);

    act(() => void vi.advanceTimersByTime(2_500));
    box.grow(2000);
    act(() => void vi.advanceTimersByTime(500));
    expect(box.scrollTop).toBe(100);
  });

  it("lets go as soon as the user scrolls themselves", () => {
    vi.useFakeTimers();
    const box = fakeBox(0);
    keepScroll(asBox(box), 640);

    box.fire("touchstart");
    box.grow(2000);
    act(() => void vi.advanceTimersByTime(500));
    expect(box.scrollTop).toBe(0);
  });

  it("can be cancelled when the next page arrives", () => {
    vi.useFakeTimers();
    const box = fakeBox(0);
    const stop = keepScroll(asBox(box), 640);

    stop();
    box.grow(2000);
    act(() => void vi.advanceTimersByTime(500));
    expect(box.scrollTop).toBe(0);
  });
});

describe("usePageMemory", () => {
  it("brings the value back after a remount, like a jump and a return", () => {
    const first = renderHook(() => usePageMemory("insights.tab", "overview"));
    act(() => first.result.current[1]("openings"));
    first.unmount();

    const second = renderHook(() => usePageMemory("insights.tab", "overview"));
    expect(second.result.current[0]).toBe("openings");
  });

  it("starts over after a tab switch", () => {
    const first = renderHook(() => usePageMemory("insights.tab", "overview"));
    act(() => first.result.current[1]("openings"));
    first.unmount();
    forgetPages();

    const second = renderHook(() => usePageMemory("insights.tab", "overview"));
    expect(second.result.current[0]).toBe("overview");
  });
});
