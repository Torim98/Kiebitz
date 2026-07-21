import { describe, it, expect } from "vitest";
import { tcLabel, toUi } from "./gameUi";
import type { GameRecord } from "./db";

function record(partial: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 1,
    source: "chess.com",
    source_id: "abc",
    url: "https://example.com/1",
    played_at: "2026-07-01",
    played_ts: 0,
    time_class: "rapid",
    color: "white",
    opponent: "villain",
    opp_elo: 1400,
    my_elo: 1500,
    result: "win",
    opening: "Italian Game",
    eco: "C50",
    moves_count: 20,
    accuracy: 88.5,
    moves: "e4 e5 Nf3 Nc6",
    note: "",
    analyzed: false,
    ...partial,
  };
}

describe("tcLabel", () => {
  it("localizes known time classes and passes unknown ones through", () => {
    expect(tcLabel("daily", "de")).toBe("Täglich");
    expect(tcLabel("daily", "en")).toBe("Daily");
    expect(tcLabel("rapid", "de")).toBe("Rapid");
    expect(tcLabel("weird", "en")).toBe("weird");
  });
});

describe("toUi date formatting", () => {
  it("prefers played_ts and formats per locale", () => {
    // 2026-07-01 12:00:00 UTC
    const ts = Math.floor(Date.UTC(2026, 6, 1, 12) / 1000);
    expect(toUi(record({ played_ts: ts }), "de").date).toBe("01.07.2026");
    expect(toUi(record({ played_ts: ts }), "en").date).toBe("2026-07-01");
  });

  it("falls back to played_at when there is no timestamp", () => {
    const r = record({ played_ts: 0, played_at: "2025-12-31" });
    expect(toUi(r, "de").date).toBe("31.12.2025");
    expect(toUi(r, "en").date).toBe("2025-12-31");
  });
});

describe("toUi field mapping", () => {
  it("maps DB fields to the UI shape", () => {
    const ui = toUi(record({ id: 42 }), "de");
    expect(ui.id).toBe("db-42");
    expect(ui.dbId).toBe(42);
    expect(ui.tc).toBe("Rapid");
    expect(ui.moves).toBe(20);
    expect(ui.sans).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(ui.tags).toEqual([]);
  });

  it("uses an em dash for a missing opening and undefined for an empty note", () => {
    const ui = toUi(record({ opening: "", note: "" }));
    expect(ui.opening).toBe("—");
    expect(ui.note).toBeUndefined();
  });

  it("keeps a real note and leaves sans undefined when there are no moves", () => {
    const ui = toUi(record({ note: "blunder on move 20", moves: "" }));
    expect(ui.note).toBe("blunder on move 20");
    expect(ui.sans).toBeUndefined();
  });
});
