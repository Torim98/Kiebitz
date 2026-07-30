import { describe, expect, it } from "vitest";
import {
  clockStamp,
  clocksAtPly,
  clocksFromPgn,
  formatClock,
  parseClockStamp,
  parseClocks,
  parseTimeControl,
  serializeClocks,
  timeControlLabel,
} from "./clocks";

describe("time control", () => {
  it("reads base time and increment, including staged tournament controls", () => {
    expect(parseTimeControl("600+5")).toEqual({ initial: 600, increment: 5 });
    expect(parseTimeControl("180")).toEqual({ initial: 180, increment: 0 });
    expect(parseTimeControl("40/7200:1800")).toEqual({ initial: 7200, increment: 0 });
    expect(parseTimeControl("-")).toBeNull();
    expect(parseTimeControl("")).toBeNull();
  });

  it("labels a control the way players say it", () => {
    expect(timeControlLabel("180+2")).toBe("3+2");
    expect(timeControlLabel("600")).toBe("10");
    expect(timeControlLabel("90")).toBe("1.5");
    expect(timeControlLabel("?")).toBeNull();
  });
});

describe("clock stamps", () => {
  it("round-trips the PGN notation", () => {
    expect(parseClockStamp("0:09:57.9")).toBe(59_790);
    expect(clockStamp(59_790)).toBe("0:09:57.9");
    expect(clockStamp(60_000)).toBe("0:10:00");
    expect(parseClockStamp("1:23")).toBe(8_300);
    expect(parseClockStamp("nope")).toBeNull();
  });

  it("formats remaining time with tenths only under twenty seconds", () => {
    expect(formatClock(59_790)).toBe("9:57");
    expect(formatClock(1_940)).toBe("0:19,4");
    expect(formatClock(940, "en")).toBe("0:09.4");
    expect(formatClock(366_000)).toBe("1:01:00");
    expect(formatClock(-5)).toBe("0:00,0");
  });
});

describe("clocks from a PGN", () => {
  const pgn = `[Event "Live Chess"]
[TimeControl "600"]

1. e4 {[%clk 0:09:57.9]} e5 {[%clk 0:09:58.1]} 2. Nf3 {[%clk 0:09:52]} 1-0`;

  it("takes the %clk comments in move order", () => {
    expect(clocksFromPgn(pgn, parseTimeControl("600"))).toEqual([59_790, 59_810, 59_200]);
  });

  it("derives remaining time from %emt when only elapsed times are given", () => {
    const emt = `1. e4 {[%emt 0:00:03]} e5 {[%emt 0:00:05]} 2. Nf3 {[%emt 0:00:02]} 1-0`;
    // 600 s Grundzeit, 2 s Zuschlag: 600 − 3 + 2 = 599 für Weiß.
    expect(clocksFromPgn(emt, { initial: 600, increment: 2 })).toEqual([59_900, 59_700, 59_900]);
  });

  it("stays empty without any clock information", () => {
    expect(clocksFromPgn("1. e4 e5 2. Nf3 1-0", parseTimeControl("600"))).toEqual([]);
    expect(clocksFromPgn("1. e4 {[%emt 0:00:03]} 1-0", null)).toEqual([]);
  });
});

describe("storage format", () => {
  it("round-trips and rejects garbage", () => {
    expect(serializeClocks([59_790, 59_810])).toBe("59790 59810");
    expect(parseClocks("59790 59810")).toEqual([59_790, 59_810]);
    expect(parseClocks("")).toEqual([]);
    expect(parseClocks("59790 nope")).toEqual([]);
    expect(parseClocks("59790 -3")).toEqual([]);
  });
});

describe("clocks at a ply", () => {
  const control = { initial: 600, increment: 0 };
  // Halbzüge 1..4: Weiß, Schwarz, Weiß, Schwarz.
  const clocks = [59_500, 59_300, 58_800, 58_100];

  it("shows the base time before either side has moved", () => {
    expect(clocksAtPly(clocks, 0, control)).toEqual({
      white: 60_000,
      black: 60_000,
      spent: null,
    });
  });

  it("uses each side's most recent reading", () => {
    expect(clocksAtPly(clocks, 1, control)).toMatchObject({ white: 59_500, black: 60_000 });
    expect(clocksAtPly(clocks, 2, control)).toMatchObject({ white: 59_500, black: 59_300 });
    expect(clocksAtPly(clocks, 3, control)).toMatchObject({ white: 58_800, black: 59_300 });
  });

  it("reports what the move at that ply cost", () => {
    // Weiß' erster Zug: 600,00 s − 595,00 s = 5,00 s.
    expect(clocksAtPly(clocks, 1, control).spent).toBe(500);
    // Weiß' zweiter Zug: 595,00 s − 588,00 s = 7,00 s.
    expect(clocksAtPly(clocks, 3, control).spent).toBe(700);
  });

  it("adds the increment back before measuring the time spent", () => {
    expect(clocksAtPly([59_500], 1, { initial: 600, increment: 5 }).spent).toBe(1_000);
  });

  it("has nothing to show without clock data", () => {
    expect(clocksAtPly([], 4, control)).toEqual({ white: null, black: null, spent: null });
  });

  it("falls back to the last known reading past the end of the list", () => {
    expect(clocksAtPly(clocks, 9, control)).toMatchObject({ white: 58_800, black: 58_100 });
  });

  it("works without a known time control, just without a starting value", () => {
    expect(clocksAtPly(clocks, 0, null)).toEqual({ white: null, black: null, spent: null });
    expect(clocksAtPly(clocks, 2, null)).toMatchObject({ white: 59_500, black: 59_300 });
  });
});
