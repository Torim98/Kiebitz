import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNavStack, type NavStack } from "./nav";

/** history.back()/go() lösen popstate erst in einem späteren Task aus. */
const atDepth = (result: { current: NavStack }, depth: number) =>
  waitFor(() => expect(result.current.depth).toBe(depth));

beforeEach(() => window.history.replaceState(null, ""));

afterEach(async () => {
  // jsdom teilt die Session-History über alle Tests der Datei.
  const behind = window.history.length - 1;
  if (behind > 0) window.history.go(-behind);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("useNavStack", () => {
  it("starts on the dashboard at depth 1", () => {
    const { result } = renderHook(() => useNavStack());
    expect(result.current.route).toEqual({ page: "dashboard" });
    expect(result.current.depth).toBe(1);
    expect(window.history.state).toEqual({ kd: 1 });
  });

  it("keeps main destinations at depth 2 instead of stacking them up", () => {
    const { result } = renderHook(() => useNavStack());
    act(() => result.current.navigate("games"));
    act(() => result.current.navigate("insights"));
    act(() => result.current.navigate("study"));
    expect(result.current.depth).toBe(2);
    expect(window.history.state).toEqual({ kd: 2 });
  });

  it("pushes a detail level and returns to its parent, parameters intact", async () => {
    const { result } = renderHook(() => useNavStack());
    act(() => result.current.navigate("games", { filter: { result: "loss" } }));
    act(() => result.current.push("analysis", { gameId: 42 }));

    expect(result.current.depth).toBe(3);
    expect(result.current.route).toEqual({ page: "analysis", gameId: 42 });

    act(() => void result.current.back());
    await atDepth(result, 2);
    expect(result.current.route).toEqual({ page: "games", filter: { result: "loss" } });
  });

  it("collapses a detail level when a main destination is picked", async () => {
    const { result } = renderHook(() => useNavStack());
    act(() => result.current.navigate("study"));
    act(() => result.current.push("puzzles", { theme: "fork" }));
    expect(result.current.depth).toBe(3);

    act(() => result.current.navigate("insights"));
    await atDepth(result, 2);
    expect(result.current.route).toEqual({ page: "insights" });

    // Ein einziges Zurück muss von hier auf dem Start landen · nicht in den
    // Resten des alten Stapels.
    act(() => void result.current.back());
    await atDepth(result, 1);
    expect(result.current.route).toEqual({ page: "dashboard" });
  });

  it("reports that the root cannot go back further, so Android may close the app", () => {
    const { result } = renderHook(() => useNavStack());
    expect(result.current.back()).toBe(false);
  });

  it("drops parameters when the same destination is re-picked from the bar", () => {
    const { result } = renderHook(() => useNavStack());
    act(() => result.current.navigate("games", { filter: { result: "loss" } }));
    act(() => result.current.navigate("games"));
    expect(result.current.route).toEqual({ page: "games" });
  });
});
