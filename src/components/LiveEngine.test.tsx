import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../lib/i18n";
import type { LiveInfo } from "../lib/analysis";
import LiveEngine from "./LiveEngine";

const mocks = vi.hoisted(() => ({
  analyzeLive: vi.fn(),
  doneListener: null as ((done: { generation: number; bestmove: string }) => void) | null,
  engineInfo: vi.fn(),
  infoListener: null as ((info: LiveInfo) => void) | null,
  stopLive: vi.fn(),
}));

vi.mock("../lib/backend", () => ({
  engineInfo: mocks.engineInfo,
}));
vi.mock("../lib/analysis", () => ({
  analyzeLive: mocks.analyzeLive,
  onEngineDone: vi.fn((listener: (done: { generation: number; bestmove: string }) => void) => {
    mocks.doneListener = listener;
    return Promise.resolve(vi.fn());
  }),
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
  mocks.doneListener = null;
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
    act(() => {
      vi.advanceTimersByTime(120);
    });
    await act(async () => {
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
      vi.advanceTimersByTime(150);
    });
    expect(onEval).toHaveBeenCalledTimes(1);
    expect(onEval).toHaveBeenLastCalledWith(20, null);
    expect(onBestMove).toHaveBeenLastCalledWith("e2e3");

    act(() => {
      mocks.infoListener?.({
        generation: 7,
        depth: 21,
        multipv: 1,
        eval_cp: 21,
        mate_in: null,
        nps: 21_000,
        pv: ["e2e3"],
      });
    });
    expect(vi.getTimerCount()).toBe(1);
    act(() => mocks.doneListener?.({ generation: 7, bestmove: "e2e3" }));
    expect(vi.getTimerCount()).toBe(0);
    expect(onEval).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.stopLive).toHaveBeenCalled();
  });

  it("plays the first move of a clicked engine line", async () => {
    const onMove = vi.fn();
    render(
      <LocaleProvider>
        <LiveEngine fen="8/8/8/8/8/8/4K3/7k w - - 0 1" demoLines={[]} onMove={onMove} />
      </LocaleProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(120));
    await act(async () => Promise.resolve());
    act(() => {
      mocks.infoListener?.({
        generation: 7,
        depth: 18,
        multipv: 1,
        eval_cp: 32,
        mate_in: null,
        nps: 25_000,
        pv: ["e2e3", "h1g1"],
      });
      vi.advanceTimersByTime(150);
    });

    fireEvent.click(screen.getByRole("button", { name: /Ke3/ }));
    expect(onMove).toHaveBeenCalledWith("e2e3");
  });

  it("analyzes only the latest position in a quick move sequence", async () => {
    const firstFen = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const secondFen = "8/8/8/8/8/4K3/8/7k b - - 1 1";
    const thirdFen = "8/8/8/8/8/4K3/7k/8 w - - 2 2";
    const view = render(
      <LocaleProvider>
        <LiveEngine fen={firstFen} demoLines={[]} />
      </LocaleProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    view.rerender(
      <LocaleProvider>
        <LiveEngine fen={secondFen} demoLines={[]} />
      </LocaleProvider>
    );
    view.rerender(
      <LocaleProvider>
        <LiveEngine fen={thirdFen} demoLines={[]} />
      </LocaleProvider>
    );

    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(mocks.analyzeLive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.analyzeLive).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeLive).toHaveBeenCalledWith(thirdFen);
  });

  it("retains a short search result that arrives before the invoke response", async () => {
    let resolveAnalysis!: (generation: number) => void;
    mocks.analyzeLive.mockImplementation(
      () => new Promise<number>((resolve) => (resolveAnalysis = resolve))
    );
    const onEval = vi.fn();
    render(
      <LocaleProvider>
        <LiveEngine
          fen="8/8/8/8/8/8/4K3/7k w - - 0 1"
          demoLines={[]}
          onEval={onEval}
        />
      </LocaleProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(120));
    await act(async () => Promise.resolve());

    // The native reader can finish before Tauri resolves analyze_live.
    act(() => {
      mocks.infoListener?.({
        generation: 11,
        depth: 18,
        multipv: 1,
        eval_cp: 42,
        mate_in: null,
        nps: 25_000,
        pv: ["e2e3"],
      });
      mocks.doneListener?.({ generation: 11, bestmove: "e2e3" });
    });
    expect(onEval).not.toHaveBeenCalled();

    await act(async () => {
      resolveAnalysis(11);
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(150));
    expect(onEval).toHaveBeenCalledWith(42, null);
  });

  it("serializes an old analysis, its stop, and the newest analysis", async () => {
    const firstFen = "8/8/8/8/8/8/4K3/7k w - - 0 1";
    const secondFen = "8/8/8/8/8/4K3/8/7k b - - 1 1";
    let resolveFirstAnalysis!: (generation: number) => void;
    mocks.analyzeLive
      .mockImplementationOnce(
        () => new Promise<number>((resolve) => (resolveFirstAnalysis = resolve))
      )
      .mockResolvedValueOnce(8);

    const view = render(
      <LocaleProvider>
        <LiveEngine fen={firstFen} demoLines={[]} />
      </LocaleProvider>
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(120));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.analyzeLive).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeLive).toHaveBeenLastCalledWith(firstFen);
    const stopsBeforePositionChange = mocks.stopLive.mock.calls.length;

    view.rerender(
      <LocaleProvider>
        <LiveEngine fen={secondFen} demoLines={[]} />
      </LocaleProvider>
    );
    act(() => vi.advanceTimersByTime(120));
    await act(async () => Promise.resolve());

    // The old invoke is still in flight, so neither its ordered stop nor the
    // replacement analysis may overtake it.
    expect(mocks.stopLive).toHaveBeenCalledTimes(stopsBeforePositionChange);
    expect(mocks.analyzeLive).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstAnalysis(7);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.stopLive).toHaveBeenCalledTimes(stopsBeforePositionChange + 1);
    expect(mocks.analyzeLive).toHaveBeenCalledTimes(2);
    expect(mocks.analyzeLive).toHaveBeenLastCalledWith(secondFen);
  });
});
