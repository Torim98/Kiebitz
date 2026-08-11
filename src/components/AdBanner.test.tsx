import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdBanner from "./AdBanner";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("../lib/ext", () => ({ openExternal }));

function sendFromFrame(iframe: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data,
      origin: "https://torim98.github.io",
      source: iframe.contentWindow,
    }));
  });
}

describe("AdBanner desktop surface", () => {
  beforeEach(() => openExternal.mockReset());

  it("keeps the slot collapsed until an active campaign is reported", () => {
    render(<AdBanner android={false} />);
    const iframe = screen.getByTitle("Anzeige") as HTMLIFrameElement;
    const slot = iframe.closest("aside");

    expect(slot?.classList.contains("h-0")).toBe(true);
    sendFromFrame(iframe, {
      source: "kiebitz-desktop-ad",
      type: "status",
      visible: true,
    });
    expect(slot?.classList.contains("h-[64px]")).toBe(true);
  });

  it("opens only HTTPS campaign targets from the configured frame", () => {
    render(<AdBanner android={false} />);
    const iframe = screen.getByTitle("Anzeige") as HTMLIFrameElement;

    sendFromFrame(iframe, {
      source: "kiebitz-desktop-ad",
      type: "open",
      href: "https://advertiser.example/campaign",
    });
    sendFromFrame(iframe, {
      source: "kiebitz-desktop-ad",
      type: "open",
      href: "javascript:alert(1)",
    });

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("https://advertiser.example/campaign");
  });
});
