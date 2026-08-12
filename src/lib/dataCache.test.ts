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
      if (command === "list_games") return Promise.resolve([{ id: 1 }]);
      if (command === "db_stats") return Promise.resolve({ total: 1 });
      if (command === "deep_insights") return Promise.resolve({ coverage: { games: 1 } });
      throw new Error(`unexpected command: ${command}`);
    });
    const db = await import("./db");
    const insights = await import("./insights");
    const { emitDataChange } = await import("./changes");

    await Promise.all([
      db.listGames(),
      db.listGames(),
      db.dbStats(),
      db.dbStats(),
      insights.deepInsights(),
      insights.deepInsights(),
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(3);

    emitDataChange();
    await Promise.all([db.listGames(), db.dbStats(), insights.deepInsights()]);
    expect(invokeMock).toHaveBeenCalledTimes(6);
  });

  it("retries a failed cached read", async () => {
    invokeMock.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce([]);
    const { listGames } = await import("./db");

    await expect(listGames()).rejects.toThrow("temporary");
    await expect(listGames()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
