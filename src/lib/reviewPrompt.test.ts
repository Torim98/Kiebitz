import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { maybeRequestPlayReview } from "./reviewPrompt";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const playBackend = {
  version: "0.8.0",
  backend: "tauri",
  platform: "android",
  distribution: "play-store",
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({ requested: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
});

describe("Play review success-moment policy", () => {
  it("never invokes Play Review outside the Play-Store Android build", async () => {
    await maybeRequestPlayReview(
      { ...playBackend, distribution: "sideload" },
      { kind: "analysis-complete", totalAnalyzedGames: 10 }
    );

    expect(invoke).not.toHaveBeenCalled();
  });

  it("waits until at least the tenth analyzed game", async () => {
    expect(
      await maybeRequestPlayReview(playBackend, {
        kind: "analysis-complete",
        totalAnalyzedGames: 9,
      })
    ).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    expect(
      await maybeRequestPlayReview(playBackend, {
        kind: "analysis-complete",
        totalAnalyzedGames: 10,
      })
    ).toBe(true);
    expect(invoke).toHaveBeenCalledWith("request_play_review");
  });

  it("uses a three-month cooldown even when another milestone follows", async () => {
    await maybeRequestPlayReview(playBackend, {
      kind: "analysis-complete",
      totalAnalyzedGames: 10,
    });
    await maybeRequestPlayReview(playBackend, {
      kind: "puzzle-solved",
      totalSolved: 40,
    });

    expect(invoke).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    await maybeRequestPlayReview(playBackend, {
      kind: "analysis-complete",
      totalAnalyzedGames: 21,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ kind: "puzzle-solved", totalSolved: 24 }, { kind: "puzzle-solved", totalSolved: 25 }],
    [
      { kind: "repertoire-session-complete", correctAnswers: 4 },
      { kind: "repertoire-session-complete", correctAnswers: 5 },
    ],
    [
      { kind: "endgame-drill-mastered", masteredDrills: 4 },
      { kind: "endgame-drill-mastered", masteredDrills: 5 },
    ],
  ] as const)("requires meaningful progress before a training milestone", async (below, reached) => {
    expect(await maybeRequestPlayReview(playBackend, below)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();

    expect(await maybeRequestPlayReview(playBackend, reached)).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps a later success moment available when Play Core cannot start", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ requested: false });
    expect(
      await maybeRequestPlayReview(playBackend, { kind: "puzzle-solved", totalSolved: 40 })
    ).toBe(false);
    expect(
      await maybeRequestPlayReview(playBackend, {
        kind: "analysis-complete",
        totalAnalyzedGames: 10,
      })
    ).toBe(true);

    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
