import { describe, expect, it } from "vitest";
import { renderBoardSound, type BoardSoundKind } from "./sound";

const KINDS: BoardSoundKind[] = [
  "move",
  "capture",
  "error",
];

describe("renderBoardSound", () => {
  it.each(KINDS)("renders a finite, controlled %s waveform", (kind) => {
    const samples = renderBoardSound(kind, 48_000);
    const peak = samples.reduce(
      (highest, sample) => Math.max(highest, Math.abs(sample)),
      0
    );

    expect(samples.length).toBeGreaterThan(3_000);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThan(0.561);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.0001);
  });

  it("renders the same recognizable move sound every time", () => {
    const first = renderBoardSound("move", 48_000);
    const repeated = renderBoardSound("move", 48_000);

    expect(first).toEqual(repeated);
  });

  it("keeps capture longer and error shorter than a normal move", () => {
    const move = renderBoardSound("move", 48_000);
    expect(renderBoardSound("capture", 48_000).length).toBeGreaterThan(move.length);
    expect(renderBoardSound("error", 48_000).length).toBeLessThan(move.length);
  });
});
