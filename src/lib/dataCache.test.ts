import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
});

describe("read caches", () => {
  it("coalesces expensive reads and invalidates them after a data change", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_games_for_export") return Promise.resolve([{ id: 1 }]);
      if (command === "list_game_summaries") return Promise.resolve([{ id: 1 }]);
      if (command === "db_stats") return Promise.resolve({ total: 1 });
      if (command === "deep_insights") return Promise.resolve({ coverage: { games: 1 } });
      throw new Error(`unexpected command: ${command}`);
    });
    const db = await import("./db");
    const insights = await import("./insights");
    const { emitDataChange } = await import("./changes");

    await Promise.all([
      db.listGamesForExport(),
      db.listGamesForExport(),
      db.listGameSummaries(),
      db.listGameSummaries(),
      db.dbStats(),
      db.dbStats(),
      insights.deepInsights(),
      insights.deepInsights(),
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(4);

    emitDataChange();
    await Promise.all([db.listGamesForExport(), db.listGameSummaries(), db.dbStats(), insights.deepInsights()]);
    expect(invokeMock).toHaveBeenCalledTimes(8);
  });

  it("retries a failed cached read", async () => {
    invokeMock.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce([]);
    const { listGamesForExport } = await import("./db");

    await expect(listGamesForExport()).rejects.toThrow("temporary");
    await expect(listGamesForExport()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
