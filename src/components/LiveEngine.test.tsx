import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../lib/i18n";
import type { LiveInfo } from "../lib/analysis";
import LiveEngine from "./LiveEngine";

const mocks = vi.hoisted(() => ({
  analyzeLive: vi.fn(),
  engineInfo: vi.fn(),
  infoListener: null as ((info: LiveInfo) => void) | null,
  stopLive: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  engineInfo: mocks.engineInfo,
}));
vi.mock("../lib/analysis", () => ({
  analyzeLive: mocks.analyzeLive,
  onEngineDone: vi.fn(() => Promise.resolve(vi.fn())),
  onEngineInfo: vi.fn((listener: (info: LiveInfo) => void) => {
    mocks.infoListener = listener;
    return Promise.resolve(vi.fn());
  }),
  stopLive: mocks.stopLive,
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.engineInfo.mockResolvedValue({
    available: true,
    name: "Stockfish",
    path: "stockfish",
  });
  mocks.analyzeLive.mockResolvedValue(7);
  mocks.stopLive.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.infoListener = null;
});

describe("LiveEngine", () => {
  it("batches streamed engine updates and really stops when paused", async () => {
    const onEval = vi.fn();
    const onBestMove = vi.fn();
    render(
      <LocaleProvider>
        <LiveEngine
          fen="8/8/8/8/8/8/4K3/7k w - - 0 1"
          demoLines={[]}
          onEval={onEval}
          onBestMove={onBestMove}
        />
      </LocaleProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.analyzeLive).toHaveBeenCalled();
    expect(mocks.infoListener).not.toBeNull();

    act(() => {
      for (let depth = 8; depth <= 20; depth++) {
        mocks.infoListener?.({
          generation: 7,
          depth,
          multipv: 1,
          eval_cp: depth,
          mate_in: null,
          nps: depth * 1000,
          pv: ["e2e3"],
        });
      }
    });
    expect(onEval).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onEval).toHaveBeenCalledTimes(1);
    expect(onEval).toHaveBeenLastCalledWith(20, null);
    expect(onBestMove).toHaveBeenLastCalledWith("e2e3");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.stopLive).toHaveBeenCalled();
  });
});
