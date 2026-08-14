/**
 * Statischer Stand des Study-Reiters für die Web-Vorschau und die
 * Store-Aufnahmen. Ohne Backend gibt es keine Partien, keine Züge und keine
 * Versuche · das Layout soll trotzdem zeigen, wofür die Seite gebaut ist.
 *
 * Die Zahlen sind erfunden, aber in sich stimmig: die Verordnungen passen zu
 * den Befunden, und die Wirkungszeile zeigt bewusst auch einen Fall, der noch
 * nicht messbar ist — das ist der häufigste echte Zustand.
 */
import { isoDay } from "../lib/dates";
import type { Locale } from "../lib/i18n";
import type { Finding } from "../lib/findings";
import type { MetricWindow } from "../lib/insights";
import type { StudyState } from "./Study";

const DAY = 86_400;

/** Ein Messfenster mit der Patzerrate des Mittelspiels. */
function demoWindow(blunders: number, from: number, to: number): MetricWindow {
  return {
    from_ts: from,
    to_ts: to,
    games: 34,
    ratings: [],
    metrics: [
      {
        key: "blunders_middlegame_per100",
        value: blunders,
        n: 1_180,
        sd: null,
        unit: "per100",
        lower_is_better: true,
      },
    ],
  };
}

export function DEMO_PLAN_STATE(_locale: Locale): StudyState {
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / DAY);
  // Montag dieser Woche als Tagesbeginn · dieselbe Grenze wie `weekStartOf`.
  const weekStart = (today - ((new Date().getUTCDay() || 7) - 1)) * DAY;

  const findings: Finding[] = [
    {
      id: "time-trouble",
      severity: 71,
      tone: "bad",
      tab: "time",
      titleKey: "fnd.troubleTitle",
      bodyKey: "fnd.troubleBody",
      params: { p: 17.4, e: 9.2, b: 4.1, m: 28 },
      lever: { area: "play", trainability: 0.9 },
      metricKey: "trouble_pct",
    },
    {
      id: "punishment",
      severity: 63,
      tone: "bad",
      tab: "strength",
      titleKey: "fnd.punishTitle",
      bodyKey: "fnd.punishBody",
      params: { p: 44.5, n: 96, m: 43 },
      lever: { area: "tactics", trainability: 0.9 },
      metricKey: "blunders_middlegame_per100",
      action: { kind: "puzzles" },
    },
    {
      id: "opening-black-name:sicilian defense",
      severity: 48,
      tone: "warn",
      tab: "openings",
      titleKey: "fnd.openFacedTitle",
      bodyKey: "fnd.openFacedBody",
      params: { name: "Sicilian Defense", p: 36.4, b: 49.1, n: 22, m: 6 },
      lever: { area: "openings", trainability: 1 },
      metricKey: "acc_opening",
      action: { kind: "repertoire" },
    },
    {
      id: "endgame-rook",
      severity: 34,
      tone: "warn",
      tab: "strength",
      titleKey: "fnd.endgameTitle",
      bodyKey: "fnd.endgameBody",
      params: { type: "rook", p: 38.1, n: 17 },
      lever: { area: "endgames", trainability: 0.9 },
      metricKey: "acc_endgame",
      action: { kind: "endgame" },
    },
  ];

  return {
    data: {
      due_now: 14,
      due_week: [14, 6, 9, 4, 11, 3, 7],
      unanalyzed: 4,
      today_puzzle_attempts: 6,
      puzzle_goal: 20,
      activity: [12, 0, 8, 15, 5, 9, 6].map((attempts, index) => ({
        day_ts: (today - 6 + index) * DAY,
        puzzle_attempts: attempts,
        puzzle_solved: Math.round(attempts * 0.7),
        endgame_attempts: [0, 0, 2, 1, 0, 3, 0][index],
        rep_reviews: [10, 0, 6, 12, 0, 8, 14][index],
        game_reviews: index === 3 ? 1 : 0,
      })),
      streak_days: 3,
    },
    program: {
      focuses: [
        {
          id: 1,
          area: "tactics",
          metric_key: "blunders_middlegame_per100",
          label_params: "{}",
          target: 2,
          cycle_days: 14,
          start_ts: now - 9 * DAY,
          end_ts: 0,
          status: "active",
        },
      ],
      history: [],
      load_28d: [
        { area: "play", items: 41, minutes: 420 },
        { area: "tactics", items: 180, minutes: 270 },
        { area: "openings", items: 60, minutes: 30 },
        { area: "endgames", items: 3, minutes: 12 },
        { area: "analysis", items: 12, minutes: 72 },
      ],
      // Die laufende Woche ab Montag · daraus baut die Wochenleiste ihren
      // Balken. Die Verteilung ist die typische: viel Spielen, Taktik
      // regelmäßig, Endspiel als der Bereich, der liegen bleibt.
      days: [0, 1, 2, 3, 4, 5, 6]
        .map((offset) => (weekStart + offset * DAY))
        .filter((dayTs) => dayTs <= today * DAY)
        .map((dayTs, index) => ({
          day_ts: dayTs,
          play: [42, 0, 28, 55, 0, 36, 0][index] ?? 0,
          tactics: [14, 9, 0, 18, 11, 0, 0][index] ?? 0,
          openings: [6, 0, 8, 0, 5, 7, 0][index] ?? 0,
          endgames: [0, 0, 0, 12, 0, 0, 0][index] ?? 0,
          analysis: [0, 16, 0, 22, 0, 9, 0][index] ?? 0,
        })),
      observed_weekly_minutes: 201,
    },
    plan: {
      allocation: [
        { area: "play", target: 27, minutes: 65, evidence: 0.9 },
        { area: "tactics", target: 31, minutes: 74, evidence: 0.6 },
        { area: "openings", target: 21, minutes: 50, evidence: 0.5 },
        { area: "endgames", target: 10, minutes: 24, evidence: 0.3 },
        { area: "analysis", target: 11, minutes: 27, evidence: 0 },
      ],
      prescriptions: [
        {
          id: "time-trouble",
          area: "play",
          finding: findings[0],
          doseKey: "plan.dosePlay",
          doseParams: { m: 65 },
          metricKey: "trouble_pct",
        },
        {
          id: "punishment",
          area: "tactics",
          finding: findings[1],
          doseKey: "plan.dosePuzzlesTheme",
          doseParams: { n: 15, lo: 1420, hi: 1670, theme: "fork" },
          action: { kind: "puzzles", theme: "fork", minRating: 1420, maxRating: 1670 },
          metricKey: "blunders_middlegame_per100",
        },
        {
          id: "opening-black-name:sicilian defense",
          area: "openings",
          finding: findings[2],
          doseKey: "plan.doseOpenings",
          doseParams: { m: 12, d: 5 },
          action: { kind: "repertoire" },
          metricKey: "acc_opening",
        },
      ],
      hygiene: [
        // Blitz ist in der Demo zugleich das meistgespielte und das schwächere
        // Format · deshalb bestätigt der Coach den Trainingsfokus.
        {
          id: "format",
          key: "plan.hygieneFormatContinue",
          params: { best: "rapid", weak: "blitz", p: 46 },
        },
        { id: "length", key: "plan.hygieneLength", params: { n: 4 } },
        { id: "requeue", key: "plan.hygieneRequeue", params: { m: 10, p: 9 } },
        { id: "clock", key: "plan.hygieneClock", params: { m: 28, p: 17 } },
      ],
      dose: { minRating: 1420, maxRating: 1670, perDay: 15, theme: "fork" },
      weeklyMinutes: 240,
      budgetFromSettings: false,
      rating: 1486,
      trainingDayCount: 5,
    },
    findings,
    // Zwei Messfenster für den laufenden Zyklus · ohne sie fehlt der Vorschau
    // genau das, was den Reiter ausmacht: die Rückmeldung, ob das Training
    // wirkt. Die Zahlen liegen bewusst klar über der Rauschgrenze.
    windows: new Map([
      [
        1,
        {
          before: demoWindow(3.4, now - 23 * DAY, now - 9 * DAY),
          after: demoWindow(2.1, now - 9 * DAY, now),
        },
      ],
    ]),
    templates: [],
    // Zwei Einheiten für heute · die eine ist von der gemessenen Zeit bereits
    // erfüllt, die andere steht noch offen. Genau dieser Unterschied ist es,
    // was die Tagessitzung zeigen soll.
    events: [
      {
        id: 1,
        template_id: 3,
        day: isoDay(new Date()),
        position: 0,
        completed: false,
        completed_ts: 0,
        auto_done: true,
        repeat_rule: "weekly",
        series_key: "demo-tactics",
        planned_min: 20,
        source: "plan",
        template: {
          id: 3,
          title: "Tactics",
          duration_min: 0,
          tool: "Kiebitz Puzzles",
          description: "",
          area: "tactics",
          areas: ["tactics"],
          builtin: "tactics",
          i18n_key: "st.seed.tactics",
        },
      },
      {
        id: 2,
        template_id: 2,
        day: isoDay(new Date()),
        position: 1,
        completed: false,
        completed_ts: 0,
        auto_done: false,
        repeat_rule: "",
        series_key: "",
        planned_min: 20,
        source: "plan",
        template: {
          id: 2,
          title: "Endgame training",
          duration_min: 0,
          tool: "Kiebitz Endgames",
          description: "",
          area: "endgames",
          areas: ["endgames"],
          builtin: "endgames",
          i18n_key: "st.seed.endgames",
        },
      },
    ],
    rating: { delta: 34, confidence: "measured", pools: 2, games: 118 },
    trainingDays: [true, true, false, true, true, false, true],
    observedWeeklyMinutes: 201,
    budgetSet: true,
  };
}
