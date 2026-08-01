/**
 * Welches Zeitformat sollte gespielt werden?
 *
 * Die Formattabelle beantwortet die Frage schon, aber nur, wenn man sie zu
 * lesen weiß · neun Spalten, und die entscheidende (das poolbereinigte Rating)
 * steht in der Mitte. Diese Datei zieht daraus einen Satz, den die Oberfläche
 * ungeklappt anzeigen kann.
 *
 * Die Rangfolge der Belege ist bewusst und entspricht ihrer Aussagekraft:
 *
 * 1. **Poolbereinigtes Rating.** Beantwortet direkt „wo bin ich stärker" ·
 *    roh verglichen käme regelmäßig das Gegenteil heraus, siehe `formatScale`.
 * 2. **Patzerquote.** Poolfrei und aus den eigenen Partien, aber sie zeigt fast
 *    immer aufs langsamste Format · als Beleg zweite Wahl, weil sie kaum etwas
 *    unterscheidet, was man nicht vorher wusste.
 * 3. **Punktausbeute.** Hängt am Gegnerfeld und ist der schwächste Beleg ·
 *    reicht nur, solange nichts Besseres da ist.
 *
 * Reine Funktion ohne Backend-Zugriff · testbar wie `findings.ts`.
 */
import type { FormatStat } from "./insights";
import { toReference } from "./formatScale";

/** Worauf die Empfehlung beruht · die Oberfläche formuliert danach. */
export type FormatEvidence = "pool" | "skill" | "score";

export interface FormatChoice {
  key: string;
  source: string;
  timeClass: string;
  games: number;
  scorePct: number;
  /** Rating auf der Referenzskala; null, wenn der Pool unbekannt ist. */
  reference: number | null;
  blundersPer100: number | null;
}

export interface FormatRecommendation {
  /** Das Format, das gespielt werden sollte. */
  best: FormatChoice;
  /** Das meistgespielte · daran misst sich die Empfehlung. */
  busiest: FormatChoice;
  /**
   * Wogegen die Empfehlung gemessen wird: das meistgespielte Format, und wenn
   * das schon das empfohlene ist, der Zweitplatzierte · sonst stünde in der
   * Begründung ein Format gegen sich selbst.
   */
  versus: FormatChoice;
  /** Spielst du schon überwiegend das empfohlene Format? */
  matches: boolean;
  /** Anteil des meistgespielten Formats an den verglichenen Partien, in Prozent. */
  busiestShare: number;
  evidence: FormatEvidence;
  /**
   * Vorsprung des empfohlenen Formats gegenüber `versus`, in der Einheit des
   * Belegs: Referenzpunkte, Patzer je 100 Züge oder Prozentpunkte Ausbeute.
   */
  margin: number;
}

/**
 * Fernschach ist kein Zeitformat in diesem Sinn · man setzt sich nicht hin und
 * „spielt eine Runde Täglich". Es bliebe sonst regelmäßig als Empfehlung
 * stehen, weil dort naturgemäß am wenigsten gepatzt wird.
 */
const REAL_TIME = new Set(["bullet", "blitz", "rapid", "classical"]);

/** Unter so vielen Partien sagt ein Format nichts über Spielstärke. */
const MIN_GAMES = 10;

/** Ab so vielen Partien ist das Rating eines Pools brauchbar eingependelt. */
const MIN_RATED_GAMES = 15;

/** Ab so vielen analysierten Partien ist die Patzerquote belastbar. */
const MIN_ANALYZED = 5;

function toChoice(format: FormatStat): FormatChoice {
  return {
    key: format.key,
    source: format.source,
    timeClass: format.time_class,
    games: format.games,
    scorePct: format.score_pct,
    reference: toReference(format.rating, format.source, format.time_class)?.value ?? null,
    blundersPer100: format.blunders_per_100,
  };
}

/**
 * Das empfohlene Format, oder `null`, wenn zwei Formate mit genug Partien
 * fehlen · dann gibt es schlicht nichts zu vergleichen, und eine Empfehlung
 * aus einem einzigen Pool wäre keine.
 */
export function recommendFormat(formats: FormatStat[]): FormatRecommendation | null {
  const candidates = formats.filter(
    (format) => REAL_TIME.has(format.time_class) && format.games >= MIN_GAMES
  );
  if (candidates.length < 2) return null;

  const rated = candidates.filter(
    (format) =>
      format.games >= MIN_RATED_GAMES &&
      toReference(format.rating, format.source, format.time_class) != null
  );
  const analyzed = candidates.filter(
    (format) => format.analyzed >= MIN_ANALYZED && format.blunders_per_100 != null
  );

  let ranked: FormatStat[];
  let evidence: FormatEvidence;
  let valueOf: (format: FormatStat) => number;
  if (rated.length >= 2) {
    evidence = "pool";
    valueOf = (format) =>
      toReference(format.rating, format.source, format.time_class)?.value ?? 0;
    ranked = [...rated].sort((a, b) => valueOf(b) - valueOf(a));
  } else if (analyzed.length >= 2) {
    // Kleiner ist besser · für die Spanne unten wird das Vorzeichen gedreht.
    evidence = "skill";
    valueOf = (format) => -(format.blunders_per_100 ?? 0);
    ranked = [...analyzed].sort((a, b) => valueOf(b) - valueOf(a));
  } else {
    evidence = "score";
    valueOf = (format) => format.score_pct;
    ranked = [...candidates].sort((a, b) => valueOf(b) - valueOf(a));
  }

  const best = ranked[0];
  // Das meistgespielte wird unter *denselben* Kandidaten gesucht: sonst stünde
  // die Empfehlung gegen ein Format, für das die Belege gar nicht reichen.
  const busiest = [...ranked].sort((a, b) => b.games - a.games)[0];
  const versus = best.key === busiest.key ? ranked[1] : busiest;
  const total = ranked.reduce((sum, format) => sum + format.games, 0);

  return {
    best: toChoice(best),
    busiest: toChoice(busiest),
    versus: toChoice(versus),
    matches: best.key === busiest.key,
    busiestShare: total > 0 ? Math.round((busiest.games / total) * 100) : 0,
    evidence,
    margin: Math.round(Math.abs(valueOf(best) - valueOf(versus)) * 10) / 10,
  };
}

/**
 * Trägt der Abstand die Empfehlung? Darunter ist der Unterschied Rauschen, und
 * die ehrliche Auskunft lautet „nimm, was dir liegt".
 *
 * 60 Referenzpunkte sind rund eine Klasse · dieselbe Schwelle wie beim
 * `format-pool`-Befund.
 */
export function isMeaningful(recommendation: FormatRecommendation): boolean {
  switch (recommendation.evidence) {
    case "pool":
      return recommendation.margin >= 60;
    case "skill":
      return recommendation.margin >= 1.5;
    case "score":
      return recommendation.margin >= 6;
  }
}
