import { describe, expect, it } from "vitest";
import { buildFindings, findingsFor, topFindings, localizeFindingParams } from "./findings";
import { buildInsights } from "./stats";
import { translator } from "./i18n";
import type { DeepInsights } from "./insights";
import { DEMO_RECORDS, demoDeepInsights } from "../pages/insights/demo";

const live = buildInsights(DEMO_RECORDS, "de");

/** Tiefenanalyse mit gezielt veränderten Teilbereichen. */
function deepWith(patch: (deep: DeepInsights) => void): DeepInsights {
  const deep = demoDeepInsights();
  patch(deep);
  return deep;
}

describe("Befund-Engine", () => {
  it("erkennt die eingebauten Schwächen der Demo-Daten", () => {
    const ids = buildFindings(demoDeepInsights(), live).map((f) => f.id);
    // Die Demo-Daten sind so gebaut, dass jeder Block mindestens einmal greift.
    expect(ids).toContain("time-rush");
    expect(ids).toContain("time-trouble");
    expect(ids).toContain("conversion");
    expect(ids).toContain("session-length");
    expect(ids).toContain("requeue");
    expect(ids).toContain("rep-deviation-black");
    expect(ids).toContain("format-mismatch");
  });

  it("sortiert nach Schweregrad", () => {
    const findings = buildFindings(demoDeepInsights(), live);
    const severities = findings.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
  });

  it("schweigt bei zu kleiner Stichprobe", () => {
    // Dieselbe schlechte Verwertungsquote, aber nur aus fünf Partien.
    const thin = deepWith((deep) => {
      deep.content.conversion.games = 5;
      deep.content.conversion.score_pct = 40;
    });
    expect(buildFindings(thin, live).map((f) => f.id)).not.toContain("conversion");

    const solid = deepWith((deep) => {
      deep.content.conversion.games = 40;
      deep.content.conversion.score_pct = 40;
    });
    expect(buildFindings(solid, live).map((f) => f.id)).toContain("conversion");
  });

  it("gewichtet größere Effekte höher", () => {
    const mild = deepWith((deep) => {
      deep.content.conversion.games = 40;
      deep.content.conversion.score_pct = 79;
    });
    const severe = deepWith((deep) => {
      deep.content.conversion.games = 40;
      deep.content.conversion.score_pct = 58;
    });
    const of = (deep: DeepInsights) =>
      buildFindings(deep, live).find((f) => f.id === "conversion")!.severity;
    expect(of(severe)).toBeGreaterThan(of(mild));
  });

  it("lobt, wo es etwas zu loben gibt", () => {
    const findings = buildFindings(demoDeepInsights(), live);
    const good = findings.filter((f) => f.tone === "good");
    expect(good.length).toBeGreaterThan(0);
    // Der Feldvergleich dreht sich mit dem Vorzeichen um.
    const better = deepWith((deep) => {
      deep.benchmark.me!.blunders_per_100 = 1.6;
      deep.benchmark.field!.blunders_per_100 = 2.8;
    });
    const bench = buildFindings(better, live).find((f) => f.id === "bench-blunders");
    expect(bench?.tone).toBe("good");
    expect(bench?.titleKey).toBe("fnd.benchBetterTitle");
  });

  it("ordnet jeden Befund genau einem Reiter zu", () => {
    const findings = buildFindings(demoDeepInsights(), live);
    const tabs = ["strength", "time", "openings", "patterns", "training"] as const;
    const sum = tabs.reduce((total, tab) => total + findingsFor(findings, tab).length, 0);
    expect(sum).toBe(findings.length);
    // Der Formatvergleich hängt an den Uhrdaten und gehört auf den Zeit-Reiter.
    expect(findingsFor(findings, "time").map((f) => f.id)).toContain("format-mismatch");
  });

  it("zeigt im Überblick höchstens ein Lob", () => {
    const top = topFindings(buildFindings(demoDeepInsights(), live), 4);
    expect(top.length).toBeLessThanOrEqual(4);
    expect(top.filter((f) => f.tone === "good").length).toBeLessThanOrEqual(1);
  });

  it("liefert für jeden Befund einen echten Satz statt eines Schlüssels", () => {
    const t = translator("de");
    for (const finding of buildFindings(demoDeepInsights(), live)) {
      const params = localizeFindingParams(finding.params, t, "de");
      const title = t(finding.titleKey, params);
      const body = t(finding.bodyKey, params);
      expect(title).not.toBe(finding.titleKey);
      expect(body).not.toBe(finding.bodyKey);
      // Kein Platzhalter darf stehen bleiben.
      expect(title + body).not.toMatch(/\{[a-z]+\}/);
    }
  });

  it("übersetzt Rohwerte in den Befundparametern", () => {
    const t = translator("de");
    const params = localizeFindingParams(
      { side: "black", phase: "endgame", piece: "N", type: "rook", best: "blitz" },
      t,
      "de"
    );
    expect(params.side).toBe("Schwarz");
    expect(params.phase).toBe("Endspiel");
    expect(params.piece).toBe("Springer");
    expect(params.type).toBe("Turmendspiel");
    expect(params.best).toBe("Blitz");
  });

  it("kommt mit einer leeren Datenbank ohne Befunde aus", () => {
    const empty = deepWith((deep) => {
      deep.time = { ...deep.time, games: 0, moves: 0, by_speed: [], drift: [], by_phase: [] };
      deep.time.trouble = { ...deep.time.trouble, moves: 0, flag_losses: 0 };
      deep.time.edge = { ...deep.time.edge, games: 0 };
      deep.time.theory = { ...deep.time.theory, book_moves: 0 };
      deep.time.focus = { ...deep.time.focus, error_share: 0, ok_share: 0 };
      deep.content.conversion.games = 0;
      deep.content.defense.games = 0;
      deep.content.punishment.chances = 0;
      deep.content.anatomy.errors = 0;
      deep.content.anatomy.by_piece = [];
      deep.content.endgames = [];
      deep.benchmark = { games: 0, avg_opp_elo: 0, me: null, field: null };
      deep.sessions.recommended_length = 0;
      deep.sessions.requeue.fast_games = 0;
      deep.sessions.warmup.primed_games = 0;
      deep.sessions.damage.sessions = 0;
      deep.progress.months = [];
      deep.progress.themes = [];
      deep.progress.rep_effect = { before_games: 0, before_score: 0, after_games: 0, after_score: 0 };
      deep.repertoire.by_side = [];
      deep.repertoire.shaky = [];
      deep.formats.formats = [];
    });
    const bare = buildInsights([], "de");
    expect(buildFindings(empty, bare)).toEqual([]);
  });
});
