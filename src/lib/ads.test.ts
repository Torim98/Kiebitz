import { describe, expect, it } from "vitest";
import { desktopAdFrameUrl } from "./ads";

describe("desktopAdFrameUrl", () => {
  it("accepts only an explicit HTTPS provider endpoint", () => {
    expect(desktopAdFrameUrl("https://ads.example.test/kiebitz")).toBe(
      "https://ads.example.test/kiebitz"
    );
    expect(desktopAdFrameUrl("http://ads.example.test/kiebitz")).toBeNull();
    expect(desktopAdFrameUrl("javascript:alert(1)")).toBeNull();
  });

  it("stays disabled when no desktop provider is configured", () => {
    expect(desktopAdFrameUrl("")).toBeNull();
  });
});
