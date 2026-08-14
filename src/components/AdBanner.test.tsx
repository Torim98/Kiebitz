import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdBanner from "./AdBanner";

const { invoke, openExternal } = vi.hoisted(() => ({
  invoke: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../lib/ext", () => ({ openExternal }));

function sendFromFrame(iframe: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data,
      origin: "https://kiebitz.dev",
      source: iframe.contentWindow,
    }));
  });
}

describe("AdBanner desktop surface", () => {
  beforeEach(() => {
    invoke.mockReset();
    openExternal.mockReset();
  });

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
    expect(slot?.classList.contains("h-[72px]")).toBe(true);
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

describe("AdBanner Android slot", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 0,
      left: 0,
      right: 360,
      top: 500,
      width: 360,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    // Unmount while the Tauri mock still returns a Promise; the component's
    // cleanup deliberately hides the native banner one final time.
    cleanup();
    vi.restoreAllMocks();
  });

  it("reserves space only after the native banner has loaded", async () => {
    let finishLoad!: (value: unknown) => void;
    invoke.mockImplementation((_command, args: { rect?: { visible?: boolean } }) => {
      if (args.rect?.visible) {
        return new Promise((resolve) => {
          finishLoad = resolve;
        });
      }
      return Promise.resolve({ available: true, loaded: false });
    });

    const { container } = render(<AdBanner android />);
    const slot = container.querySelector('[data-ad-slot="android-banner"]');
    expect(slot?.classList.contains("h-0")).toBe(true);
    await waitFor(() => expect(finishLoad).toBeTypeOf("function"));

    await act(async () => finishLoad({ available: true, loaded: true }));
    expect(slot?.classList.contains("h-[50px]")).toBe(true);
  });

  it("stays collapsed when AdMob cannot fill the banner", async () => {
    invoke.mockResolvedValue({ available: true, loaded: false });
    const { container } = render(<AdBanner android />);
    const slot = container.querySelector('[data-ad-slot="android-banner"]');

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(slot?.classList.contains("h-0")).toBe(true);
  });
});
