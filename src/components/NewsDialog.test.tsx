import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewsDialog from "./NewsDialog";
import { CURRENT_NEWS, markNewsSeen } from "../lib/news";
import { openExternal } from "../lib/ext";

vi.mock("../lib/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../lib/news", async () => {
  const actual = await vi.importActual<typeof import("../lib/news")>("../lib/news");
  return { ...actual, markNewsSeen: vi.fn(() => Promise.resolve()) };
});
vi.mock("../lib/ext", () => ({ openExternal: vi.fn() }));

describe("NewsDialog", () => {
  it("shows every point of the entry and opens its links externally", () => {
    render(<NewsDialog entry={CURRENT_NEWS} onClose={vi.fn()} />);

    expect(screen.getByText(CURRENT_NEWS.titleKey)).toBeTruthy();
    expect(screen.getByText(CURRENT_NEWS.introKey)).toBeTruthy();
    for (const key of CURRENT_NEWS.pointKeys) expect(screen.getByText(key)).toBeTruthy();
    expect(screen.getByText(CURRENT_NEWS.outroKey)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: CURRENT_NEWS.links[0].labelKey }));
    expect(openExternal).toHaveBeenCalledWith(CURRENT_NEWS.links[0].url);
  });

  // "Später" darf nichts merken · sonst verliert man die Links versehentlich.
  it("closes without remembering anything on later", () => {
    const onClose = vi.fn();
    render(<NewsDialog entry={CURRENT_NEWS} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "news.later" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(markNewsSeen).not.toHaveBeenCalled();
  });

  it("remembers the entry and closes on don't show again", async () => {
    const onClose = vi.fn();
    render(<NewsDialog entry={CURRENT_NEWS} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "news.dismiss" }));
    });

    expect(markNewsSeen).toHaveBeenCalledWith(CURRENT_NEWS);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
