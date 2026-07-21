import type { GameRecord } from "./db";
import type { Locale } from "./i18n";
import { tcLabel, toUi, type UiGame } from "./gameUi";

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface RatingCard {
  id: string;
  platform: "chess.com" | "lichess";
  tc: string;
  value: number;
  delta: number;
  spark: number[];
  url: string;
}

export interface HistoryPoint {
  week: string;
  cc: number | null;
  li: number | null;
}

export interface LiveDashboard {
  cards: RatingCard[];
  history: HistoryPoint[];
  recent: UiGame[];
  unanalyzed: number;
}

export interface DashboardOptions {
  locale: Locale;
  ccUser: string;
  liUser: string;
}

function isoWeek(d: Date, locale: Locale): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return locale === "en" ? `W ${week}` : `KW ${week}`;
}

export function buildDashboard(
  records: GameRecord[],
  opts: DashboardOptions = { locale: "de", ccUser: "Torim98", liUser: "Torim98" }
): LiveDashboard {
  const profileUrl: Record<string, string> = {
    "chess.com": `https://www.chess.com/member/${opts.ccUser}`,
    lichess: `https://lichess.org/@/${opts.liUser}`,
  };
  const asc = [...records].sort((a, b) => a.played_ts - b.played_ts);
  const now = Math.floor(Date.now() / 1000);
  const cutoff30d = now - 30 * 86400;

  const cards: RatingCard[] = [];
  for (const platform of ["chess.com", "lichess"] as const) {
    for (const tc of ["rapid", "blitz", "bullet", "daily"]) {
      const bucket = asc.filter(
        (g) => g.source === platform && g.time_class === tc && g.my_elo > 0
      );
      if (bucket.length === 0) continue;
      const value = bucket[bucket.length - 1].my_elo;
      const older = bucket.filter((g) => g.played_ts <= cutoff30d);
      const ref = older.length > 0 ? older[older.length - 1].my_elo : bucket[0].my_elo;
      let spark = bucket.slice(-12).map((g) => g.my_elo);
      if (spark.length === 1) spark = [spark[0], spark[0]];
      cards.push({
        id: `${platform}-${tc}`,
        platform,
        tc: tcLabel(tc, opts.locale),
        value,
        delta: value - ref,
        spark,
        url: profileUrl[platform],
      });
    }
  }
  // Die zuletzt aktivsten Kategorien zuerst: Partienzahl der letzten 30 Tage,
  // bei Gleichstand (z. B. lange Pause) entscheidet die jüngste Partie.
  const activity = new Map<string, { recent: number; last: number }>();
  for (const g of records) {
    const key = `${g.source}-${g.time_class}`;
    const a = activity.get(key) ?? { recent: 0, last: 0 };
    if (g.played_ts > cutoff30d) a.recent++;
    if (g.played_ts > a.last) a.last = g.played_ts;
    activity.set(key, a);
  }
  cards.sort((a, b) => {
    const A = activity.get(a.id) ?? { recent: 0, last: 0 };
    const B = activity.get(b.id) ?? { recent: 0, last: 0 };
    return B.recent - A.recent || B.last - A.last;
  });

  // Wochenverlauf (letzte 26 Wochen): letztes Rapid-/Blitz-Rating pro Woche & Quelle
  const history: HistoryPoint[] = [];
  for (let w = 25; w >= 0; w--) {
    const start = now - (w + 1) * 7 * 86400;
    const end = now - w * 7 * 86400;
    const inWeek = (src: string) =>
      asc.filter(
        (g) =>
          g.source === src &&
          g.played_ts > start &&
          g.played_ts <= end &&
          g.my_elo > 0 &&
          (g.time_class === "rapid" || g.time_class === "blitz")
      );
    const cc = inWeek("chess.com");
    const li = inWeek("lichess");
    history.push({
      week: isoWeek(new Date(end * 1000), opts.locale),
      cc: cc.length ? cc[cc.length - 1].my_elo : null,
      li: li.length ? li[li.length - 1].my_elo : null,
    });
  }

  return {
    cards: cards.slice(0, 4),
    history,
    recent: records.slice(0, 5).map((r) => toUi(r, opts.locale)),
    unanalyzed: records.filter((g) => !g.analyzed).length,
  };
}

// ── Insights ─────────────────────────────────────────────────────────────────

export interface LiveInsights {
  totalGames: number;
  winRate: number;
  avgAccuracy: number | null;
  avgOppElo: number;
  openings: { name: string; games: number; win: number }[];
  byColor: { color: string; win: number; draw: number; loss: number }[];
  byTimeControl: { tc: string; games: number; winRate: number }[];
  byOppStrength: { bucket: string; games: number; winRate: number }[];
  accuracyTrend: { month: string; acc: number }[];
  phaseAccuracy: { phase: "opening" | "middlegame" | "endgame"; accuracy: number | null; games: number }[];
  activity: { days: string[]; slots: string[]; values: number[][] };
  whiteAdvantagePts: number;
  topSlot: { label: string; games: number } | null;
}

const MONTHS: Record<Locale, string[]> = {
  de: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const DAYS: Record<Locale, string[]> = {
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
const SLOTS = ["0–4", "4–8", "8–12", "12–16", "16–20", "20–24"];

const TC_ORDER = ["bullet", "blitz", "rapid", "classical", "daily"];

const STRENGTH_LABELS: Record<Locale, [string, string, string]> = {
  de: ["Gegner ≥ 100 schwächer", "ähnlich stark (±100)", "Gegner ≥ 100 stärker"],
  en: ["opp. ≥ 100 weaker", "similar (±100)", "opp. ≥ 100 stronger"],
};

function winPct(games: GameRecord[]): number {
  if (games.length === 0) return 0;
  return (games.filter((g) => g.result === "win").length / games.length) * 100;
}

export function buildInsights(records: GameRecord[], locale: Locale = "de"): LiveInsights {
  const months = MONTHS[locale];
  const dayNames = DAYS[locale];
  const total = records.length;

  const withAcc = records.filter((g) => g.accuracy != null);
  const avgAccuracy =
    withAcc.length > 0
      ? withAcc.reduce((s, g) => s + (g.accuracy ?? 0), 0) / withAcc.length
      : null;

  const phaseAccuracy = (
    [
      ["opening", "accuracy_opening"],
      ["middlegame", "accuracy_middlegame"],
      ["endgame", "accuracy_endgame"],
    ] as const
  ).map(([phase, field]) => {
    const values = records.map((g) => g[field]).filter((v): v is number => v != null);
    return {
      phase,
      games: values.length,
      accuracy: values.length ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10 : null,
    };
  });

  const rated = records.filter((g) => g.opp_elo > 0);
  const avgOppElo =
    rated.length > 0 ? Math.round(rated.reduce((s, g) => s + g.opp_elo, 0) / rated.length) : 0;

  // Eröffnungen: Top 6 nach Häufigkeit
  const byOpening = new Map<string, GameRecord[]>();
  for (const g of records) {
    const key = g.opening || "Unbekannt";
    byOpening.set(key, [...(byOpening.get(key) ?? []), g]);
  }
  const openings = [...byOpening.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([name, gs]) => ({
      name: name.length > 30 ? name.slice(0, 29) + "…" : name,
      games: gs.length,
      win: Math.round(winPct(gs)),
    }));

  // Farben
  const byColor = (["white", "black"] as const).map((c) => {
    const gs = records.filter((g) => g.color === c);
    return {
      color: c === "white" ? (locale === "en" ? "White" : "Weiß") : locale === "en" ? "Black" : "Schwarz",
      win: gs.filter((g) => g.result === "win").length,
      draw: gs.filter((g) => g.result === "draw").length,
      loss: gs.filter((g) => g.result === "loss").length,
    };
  });
  const wWhite = winPct(records.filter((g) => g.color === "white"));
  const wBlack = winPct(records.filter((g) => g.color === "black"));

  // Zeitkontrollen
  const byTimeControl = TC_ORDER.filter((tc) => records.some((g) => g.time_class === tc)).map(
    (tc) => {
      const gs = records.filter((g) => g.time_class === tc);
      return { tc: tcLabel(tc, locale), games: gs.length, winRate: Math.round(winPct(gs)) };
    }
  );

  // Gegnerstärke relativ zum eigenen Rating
  const [weaker, similar, stronger] = STRENGTH_LABELS[locale];
  const strengthBuckets: [string, (d: number) => boolean][] = [
    [weaker, (d) => d <= -100],
    [similar, (d) => d > -100 && d < 100],
    [stronger, (d) => d >= 100],
  ];
  const byOppStrength = strengthBuckets.map(([bucket, match]) => {
    const gs = rated.filter((g) => g.my_elo > 0 && match(g.opp_elo - g.my_elo));
    return { bucket, games: gs.length, winRate: Math.round(winPct(gs)) };
  });

  // Genauigkeit pro Monat (letzte 12 Monate mit Daten)
  const byMonth = new Map<string, number[]>();
  for (const g of withAcc) {
    const d = new Date(g.played_ts * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    byMonth.set(key, [...(byMonth.get(key) ?? []), g.accuracy!]);
  }
  const accuracyTrend = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([key, accs]) => {
      const monthIdx = Number(key.split("-")[1]);
      return {
        month: months[monthIdx],
        acc: Math.round((accs.reduce((s, a) => s + a, 0) / accs.length) * 10) / 10,
      };
    });

  // Aktivität: Wochentag × 4h-Slot (lokale Zeit)
  const values = dayNames.map(() => SLOTS.map(() => 0));
  for (const g of records) {
    if (g.played_ts <= 0) continue;
    const d = new Date(g.played_ts * 1000);
    const day = (d.getDay() + 6) % 7; // Mo = 0
    const slot = Math.floor(d.getHours() / 4);
    values[day][slot]++;
  }
  let topSlot: LiveInsights["topSlot"] = null;
  let max = 0;
  for (let di = 0; di < 7; di++) {
    for (let si = 0; si < 6; si++) {
      if (values[di][si] > max) {
        max = values[di][si];
        topSlot = {
          label:
            locale === "en"
              ? `${dayNames[di]} ${SLOTS[si]}h`
              : `${dayNames[di]} ${SLOTS[si]} Uhr`,
          games: max,
        };
      }
    }
  }

  return {
    totalGames: total,
    winRate: winPct(records),
    avgAccuracy,
    avgOppElo,
    openings,
    byColor,
    byTimeControl,
    byOppStrength,
    accuracyTrend,
    phaseAccuracy,
    activity: { days: dayNames, slots: SLOTS, values },
    whiteAdvantagePts: Math.round((wWhite - wBlack) * 10) / 10,
    topSlot,
  };
}
