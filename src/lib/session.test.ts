import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const invoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useTrainingSession } from "./session";

/** Der Zähler läuft nur mit Desktop-Backend · das Test-DOM hat keins. */
function pretendDesktop() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

function advance(seconds: number) {
  act(() => {
    vi.advanceTimersByTime(seconds * 1_000);
  });
}

/** Letzter an das Backend gemeldeter Stand einer Sitzung. */
function lastCall() {
  const call = invoke.mock.calls.at(-1) as
    | [string, { sessionKey: string; area: string; startTs: number; seconds: number }]
    | undefined;
  return call?.[1];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T10:00:00Z"));
  invoke.mockClear();
  pretendDesktop();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("useTrainingSession", () => {
  it("counts active seconds and writes them through after the flush interval", () => {
    renderHook(() => useTrainingSession("tactics"));

    advance(29);
    expect(invoke).not.toHaveBeenCalled();

    advance(1);
    expect(invoke).toHaveBeenCalledOnce();
    expect(lastCall()).toMatchObject({ area: "tactics", seconds: 30 });
  });

  it("stops counting once the attention window has passed", () => {
    renderHook(() => useTrainingSession("openings"));

    // Drei Minuten ohne Eingabe: bis dahin zählt es, danach nicht mehr.
    advance(240);
    const afterIdle = lastCall()?.seconds ?? 0;
    expect(afterIdle).toBeGreaterThan(150);
    expect(afterIdle).toBeLessThanOrEqual(181);

    advance(120);
    expect(lastCall()?.seconds).toBe(afterIdle);
  });

  it("resumes after an input", () => {
    renderHook(() => useTrainingSession("endgames"));

    advance(300);
    const stalled = lastCall()?.seconds ?? 0;

    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    advance(60);
    expect(lastCall()?.seconds).toBeGreaterThan(stalled);
  });

  it("pauses while the window is hidden", () => {
    renderHook(() => useTrainingSession("analysis"));
    advance(30);
    const visible = lastCall()?.seconds ?? 0;

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    advance(120);
    expect(lastCall()?.seconds).toBe(visible);
  });

  it("writes the final stand when the page is left", () => {
    const { unmount } = renderHook(() => useTrainingSession("tactics"));

    advance(12);
    expect(invoke).not.toHaveBeenCalled();
    unmount();
    expect(lastCall()).toMatchObject({ seconds: 12 });
  });

  it("keeps one key per session so a heartbeat never double-counts", () => {
    renderHook(() => useTrainingSession("tactics"));

    advance(30);
    const first = lastCall();
    act(() => {
      window.dispatchEvent(new Event("keydown"));
    });
    advance(30);
    const second = lastCall();

    expect(second?.sessionKey).toBe(first?.sessionKey);
    // Kumulativ, nicht als Zuwachs · ein verlorener Herzschlag kostet nichts.
    expect(second?.seconds).toBe(60);
  });

  it("stays silent without a desktop backend", () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    renderHook(() => useTrainingSession("tactics"));

    advance(120);
    expect(invoke).not.toHaveBeenCalled();
  });
});
