import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
});

describe("backend detection", () => {
  it("is shared by all consumers and retained for newly mounted pages", async () => {
    let resolveInfo!: (value: unknown) => void;
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveInfo = resolve;
      })
    );
    const { useBackendInfo } = await import("./backend");

    const first = renderHook(() => useBackendInfo());
    const second = renderHook(() => useBackendInfo());
    expect(first.result.current.mode).toBe("pending");
    expect(second.result.current.mode).toBe("pending");
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInfo({ version: "0.6.0", backend: "tauri", platform: "android" });
    });
    expect(first.result.current).toMatchObject({
      mode: "desktop",
      info: { platform: "android" },
    });
    expect(second.result.current.mode).toBe("desktop");

    const laterPage = renderHook(() => useBackendInfo());
    expect(laterPage.result.current.mode).toBe("desktop");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
