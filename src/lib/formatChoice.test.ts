import { describe, expect, it } from "vitest";
import { isMeaningful, recommendFormat } from "./formatChoice";
import type { FormatStat } from "./insights";

function format(partial: Partial<FormatStat> & { time_class: string }): FormatStat {
  return {
    key: `chess.com/${partial.time_class}`,
    source: "chess.com",
    games: 60,
    score_pct: 50,
    rating: null,
    avg_opp_elo: null,
    perf_rating: null,
    perf_edge: null,
    accuracy: null,
    avg_loss: null,
    blunders_per_100: null,
    trouble_pct: null,
    minutes: 600,
    analyzed: 0,
    last_ts: 0,
    ...partial,
  };
}

describe("recommendFormat", () => {
  it("braucht zwei Formate mit genug Partien", () => {
    expect(recommendFormat([])).toBeNull();
    expect(recommendFormat([format({ time_class: "blitz", rating: 1500 })])).toBeNull();
    // Acht Partien tragen keine Aussage über Spielstärke.
    expect(
      recommendFormat([
        format({ time_class: "blitz", rating: 1500 }),
        format({ time_class: "rapid", rating: 1700, games: 8 }),
      ])
    ).toBeNull();
  });

  it("vergleicht Ratings erst nach der Poolumrechnung", () => {
    // Roh liegt Rapid vorn; auf der Referenzskala ist 1720 Rapid schwächer als
    // 1700 Blitz, weil der Rapid-Pool bei chess.com höher zählt.
    const pick = recommendFormat([
      format({ time_class: "blitz", rating: 1700, games: 40 }),
      format({ time_class: "rapid", rating: 1720, games: 160 }),
    ])!;
    expect(pick.evidence).toBe("pool");
    expect(pick.best.timeClass).toBe("blitz");
    expect(pick.busiest.timeClass).toBe("rapid");
    expect(pick.matches).toBe(false);
    expect(pick.busiestShare).toBe(80);
  });

  it("fällt ohne Ratings auf die Patzerquote zurück", () => {
    const pick = recommendFormat([
      format({ time_class: "bullet", analyzed: 20, blunders_per_100: 7.5 }),
      format({ time_class: "rapid", analyzed: 20, blunders_per_100: 2.5, games: 30 }),
    ])!;
    expect(pick.evidence).toBe("skill");
    expect(pick.best.timeClass).toBe("rapid");
    expect(pick.margin).toBe(5);
    expect(isMeaningful(pick)).toBe(true);
  });

  it("nimmt die Punktausbeute nur als letzten Beleg", () => {
    const pick = recommendFormat([
      format({ time_class: "bullet", score_pct: 44 }),
      format({ time_class: "blitz", score_pct: 58 }),
    ])!;
    expect(pick.evidence).toBe("score");
    expect(pick.best.timeClass).toBe("blitz");
  });

  it("misst gegen den Zweitplatzierten, wenn schon das Beste gespielt wird", () => {
    const pick = recommendFormat([
      format({ time_class: "blitz", rating: 1700, games: 200 }),
      format({ time_class: "rapid", rating: 1720, games: 30 }),
    ])!;
    expect(pick.matches).toBe(true);
    expect(pick.best.timeClass).toBe("blitz");
    // Ohne diesen Fall stünde Blitz in der Begründung gegen sich selbst.
    expect(pick.versus.timeClass).toBe("rapid");
    expect(pick.margin).toBeGreaterThan(0);
  });

  it("lässt Fernschach draußen", () => {
    const pick = recommendFormat([
      format({ time_class: "blitz", analyzed: 20, blunders_per_100: 6 }),
      format({ time_class: "rapid", analyzed: 20, blunders_per_100: 3 }),
      // Im Fernschach patzt naturgemäß niemand · als "spiel das" wäre es Unsinn.
      format({ time_class: "daily", analyzed: 20, blunders_per_100: 0.4 }),
    ])!;
    expect(pick.best.timeClass).toBe("rapid");
  });

  it("hält knappe Abstände für nicht empfehlenswert", () => {
    const pick = recommendFormat([
      format({ time_class: "blitz", rating: 1700, games: 100 }),
      format({ time_class: "bullet", rating: 1640, games: 100 }),
    ])!;
    expect(pick.evidence).toBe("pool");
    expect(pick.margin).toBeLessThan(60);
    expect(isMeaningful(pick)).toBe(false);
  });
});
