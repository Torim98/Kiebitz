import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "./settings";
import { CURRENT_NEWS, markNewsSeen, pendingNews } from "./news";
import { getSettings, setSettings } from "./settings";

const mocks = vi.hoisted(() => ({
  stored: null as Settings | null,
}));

vi.mock("./settings", () => ({
  getSettings: vi.fn(() => Promise.resolve(mocks.stored)),
  setSettings: vi.fn((next: Settings) => {
    mocks.stored = next;
    return Promise.resolve(next);
  }),
}));

/** Nur die Felder, an denen die Neuigkeiten hängen · der Rest tut nichts zur Sache. */
function settings(overrides: Partial<Settings> = {}): Settings {
  return { locale: "de", onboarded: true, news_seen: "", ...overrides } as Settings;
}

beforeEach(() => {
  mocks.stored = settings();
  vi.mocked(setSettings).mockClear();
  vi.mocked(getSettings).mockClear();
});

describe("pendingNews", () => {
  it("shows the current entry to someone who never dismissed it", () => {
    expect(pendingNews(settings())).toBe(CURRENT_NEWS);
  });

  it("stays away once the entry was dismissed", () => {
    expect(pendingNews(settings({ news_seen: CURRENT_NEWS.id }))).toBeNull();
  });

  it("shows up again after a new entry replaced the dismissed one", () => {
    expect(pendingNews(settings({ news_seen: "irgendwas-aelteres" }))).toBe(CURRENT_NEWS);
  });

  // Zwei Fenster übereinander wären der schlechteste erste Eindruck.
  it("waits until the first-run setup is done", () => {
    expect(pendingNews(settings({ onboarded: false }))).toBeNull();
  });
});

describe("markNewsSeen", () => {
  it("writes the entry id into the freshly read settings", async () => {
    mocks.stored = settings({ sound_volume: 40 });
    await markNewsSeen();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setSettings).mock.calls[0][0]).toMatchObject({
      news_seen: CURRENT_NEWS.id,
      sound_volume: 40,
    });
    expect(pendingNews(mocks.stored!)).toBeNull();
  });

  it("does not save again when the entry is already known", async () => {
    mocks.stored = settings({ news_seen: CURRENT_NEWS.id });
    await markNewsSeen();
    expect(setSettings).not.toHaveBeenCalled();
  });
});
