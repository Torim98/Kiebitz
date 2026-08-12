import { describe, expect, it } from "vitest";
import { parseTagInput } from "./TagEditor";

describe("parseTagInput", () => {
  it("normalizes comma and semicolon separated tags", () => {
    expect(parseTagInput(" rapid, reviewed ; white ")).toEqual([
      "rapid",
      "reviewed",
      "white",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseTagInput(" , ; ")).toEqual([]);
  });
});
