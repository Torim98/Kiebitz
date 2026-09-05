import { afterEach, expect, it, vi } from "vitest";
import { resetTagline, TAGLINES, taglineKey } from "./tagline";

afterEach(() => {
  vi.restoreAllMocks();
  resetTagline();
});

it("draws one claim and keeps it for the whole session", () => {
  resetTagline();
  const zufall = vi.spyOn(Math, "random");
  zufall.mockReturnValueOnce(0.99).mockReturnValue(0);

  const erste = taglineKey();
  expect(erste).toBe(TAGLINES[TAGLINES.length - 1]);
  // Alle vier Stellen der Oberfläche fragen dieselbe Sitzung · nicht jede
  // ihren eigenen Satz.
  expect(taglineKey()).toBe(erste);
  expect(zufall).toHaveBeenCalledTimes(1);
});

it("covers the whole list over enough starts", () => {
  const gesehen = new Set<string>();
  for (let i = 0; i < TAGLINES.length; i++) {
    resetTagline();
    vi.spyOn(Math, "random").mockReturnValue(i / TAGLINES.length);
    gesehen.add(taglineKey());
  }
  expect(gesehen.size).toBe(TAGLINES.length);
});
