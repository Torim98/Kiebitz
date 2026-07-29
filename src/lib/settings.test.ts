import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
});

describe("settings cache", () => {
  it("shares the startup request and reuses the loaded settings", async () => {
    const settings = { locale: "en", onboarded: true };
    invokeMock.mockResolvedValue(settings);
    const { getSettings } = await import("./settings");

    const first = getSettings();
    const second = getSettings();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(settings);
    await expect(second).resolves.toBe(settings);
    await expect(getSettings()).resolves.toBe(settings);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("reloads explicitly after an indirect backend change", async () => {
    invokeMock
      .mockResolvedValueOnce({ locale: "en", db_path: null })
      .mockResolvedValueOnce({ locale: "en", db_path: "/new/kiebitz.db" });
    const { getSettings, refreshSettings } = await import("./settings");

    await getSettings();
    await expect(refreshSettings()).resolves.toMatchObject({ db_path: "/new/kiebitz.db" });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
