import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoSyncManager } from "./syncManager";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(run: () => Promise<unknown>, over: Partial<Record<string, number>> = {}) {
  return new AutoSyncManager({
    run,
    debounceMs: 100,
    minGapMs: 10,
    periodMs: 1_000_000,
    maxBackoffMs: 1000,
    ...over,
  });
}

describe("AutoSyncManager", () => {
  it("does nothing while inactive", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const m = make(run);
    m.notifyChange();
    m.kick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("syncs once immediately when activated", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const m = make(run);
    m.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(m.getStatus().phase).toBe("idle");
    expect(m.getStatus().lastSync).toBeGreaterThan(0);
  });

  it("coalesces a burst of changes into a single roundtrip", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const m = make(run);
    m.setActive(true);
    await vi.advanceTimersByTimeAsync(0); // the activation sync
    run.mockClear();

    m.notifyChange();
    m.notifyChange();
    m.notifyChange();
    await vi.advanceTimersByTimeAsync(150); // past debounce + gap
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops running after being deactivated", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const m = make(run);
    m.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    m.setActive(false);
    run.mockClear();

    m.notifyChange();
    m.kick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("handles an unreachable peer quietly: error status, no throw", async () => {
    const run = vi.fn().mockRejectedValue(new Error("unreachable"));
    const phases: string[] = [];
    const m = make(run);
    m.subscribe((s) => phases.push(s.phase));
    m.setActive(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(1);
    const st = m.getStatus();
    expect(st.phase).toBe("error");
    expect(st.lastError).toContain("unreachable");
    expect(phases).toContain("syncing");
    expect(phases).toContain("error");
  });

  it("queues one follow-up sync when a change arrives mid-flight", async () => {
    let resolveFirst: (() => void) | undefined;
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockImplementation(() => Promise.resolve());
    const m = make(run, { debounceMs: 0, minGapMs: 0 });

    m.setActive(true); // starts run #1, which stays pending
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    m.notifyChange(); // arrives mid-flight -> queued
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1); // still only the first, in flight

    resolveFirst?.(); // first finishes -> the queued sync runs
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("emits status to subscribers", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const m = make(run);
    const seen: boolean[] = [];
    m.subscribe((s) => seen.push(s.active));
    m.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.some((a) => a === true)).toBe(true);
  });
});
