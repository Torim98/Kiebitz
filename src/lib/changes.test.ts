import { describe, expect, it, vi } from "vitest";
import { batchDataChanges, emitDataChange, onDataChange } from "./changes";

describe("data changes", () => {
  it("notifies only subscribers of the changed topic", () => {
    const games = vi.fn();
    const study = vi.fn();
    const offGames = onDataChange(games, ["games"]);
    const offStudy = onDataChange(study, ["study"]);

    emitDataChange("games");

    expect(games).toHaveBeenCalledOnce();
    expect(study).not.toHaveBeenCalled();
    offGames();
    offStudy();
  });

  it("coalesces asynchronous and nested batches into one event", async () => {
    const listener = vi.fn();
    const off = onDataChange(listener);

    await batchDataChanges(async () => {
      emitDataChange("study");
      await Promise.resolve();
      await batchDataChanges(() => {
        emitDataChange("study");
        emitDataChange("repertoire");
      });
    });

    expect(listener).toHaveBeenCalledOnce();
    expect([...listener.mock.calls[0][0]].sort()).toEqual(["repertoire", "study"]);
    off();
  });

  it("treats an unscoped change as a full invalidation", () => {
    const listener = vi.fn();
    const off = onDataChange(listener, ["puzzles"]);

    emitDataChange();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].has("puzzles")).toBe(true);
    off();
  });
});
