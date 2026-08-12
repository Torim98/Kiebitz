import { describe, expect, it } from "vitest";
import { isoDay } from "./dates";

describe("isoDay", () => {
  it("returns the UTC calendar day", () => {
    expect(isoDay(new Date("2026-08-12T23:59:59Z"))).toBe("2026-08-12");
  });
});
