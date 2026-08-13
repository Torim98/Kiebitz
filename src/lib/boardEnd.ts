/**
 * Wie eine Partie endete · und was davon auf dem Brett zu sehen ist.
 *
 * Zwei Quellen, die sich ergänzen und beide nötig sind:
 *
 * · **Die Schlussstellung.** Matt, Patt, ungenügendes Material und die
 *   50-Züge-Regel stehen in ihr. Sie sind ohne Zusatzwissen ableitbar und
 *   gelten deshalb auch für Endspiel-Drills, Puzzles und das Analysebrett.
 * · **Die Partiequelle.** Aufgabe, Zeitüberschreitung und Remisangebot
 *   hinterlassen in der Stellung *keine* Spur. Sie kommen aus dem Import
 *   (`games.termination`) oder es gibt sie in Kiebitz nicht.
 *
 * Dreifachwiederholung fehlt bei der Ableitung bewusst: sie hängt an der
 * Vorgeschichte, nicht an der Stellung. Kommt sie aus der Quelle, wird sie
 * angezeigt.
 */
import { Chess } from "chess.js";
import { fenSquares } from "./boardSound";

/** Vokabular von `games.termination` · identisch im Rust-Backend. */
export const TERMINATIONS = [
  "mate",
  "resign",
  "timeout",
  "stalemate",
  "agreement",
  "repetition",
  "fifty",
  "insufficient",
  "abandoned",
  "rules",
] as const;

export type Termination = (typeof TERMINATIONS)[number];

/** Enden, bei denen eine Seite gewinnt · alles andere ist ein Remis. */
const DECISIVE: readonly Termination[] = ["mate", "resign", "timeout", "abandoned", "rules"];

export function isDecisive(reason: Termination): boolean {
  return DECISIVE.includes(reason);
}

export function isTermination(value: string): value is Termination {
  return (TERMINATIONS as readonly string[]).includes(value);
}

export interface BoardEnd {
  /** Grund; null heißt: der Ausgang ist bekannt, der Grund nicht. */
  reason: Termination | null;
  /** Gewinnerseite; null bei Remis. */
  winner: "white" | "black" | null;
  /**
   * Feld, auf dem der Marker sitzt · der König der Verliererseite, bei Patt
   * der König am Zug. Bei den übrigen Remis bleibt es leer, weil es keine
   * betroffene Seite gibt.
   */
  square: string | null;
}

/**
 * chess.com liefert den Grund in `players.<seite>.result`. Der Sieger trägt
 * dort "win", der Grund steht immer bei der Verliererseite bzw. bei beiden im
 * Remisfall · deshalb bekommt diese Funktion beide Werte.
 */
export function terminationFromChessCom(mine: string, theirs: string): Termination | "" {
  const map: Record<string, Termination> = {
    checkmated: "mate",
    resigned: "resign",
    timeout: "timeout",
    abandoned: "abandoned",
    stalemate: "stalemate",
    agreed: "agreement",
    repetition: "repetition",
    insufficient: "insufficient",
    "50move": "fifty",
    // Zeit abgelaufen, Gegner kann nicht mattsetzen · nach den Regeln remis.
    timevsinsufficient: "insufficient",
    kingofthehill: "rules",
    threecheck: "rules",
    bughousepartnerlose: "rules",
    lose: "rules",
  };
  // "win" sagt nichts über den Grund · der steht bei der anderen Seite.
  return map[mine] ?? map[theirs] ?? "";
}

/** Lichess nennt den Grund im Feld `status` der Partien-API. */
export function terminationFromLichess(status: string): Termination | "" {
  const map: Record<string, Termination> = {
    mate: "mate",
    resign: "resign",
    outoftime: "timeout",
    timeout: "abandoned",
    stalemate: "stalemate",
    draw: "agreement",
    aborted: "abandoned",
    noStart: "abandoned",
    cheat: "rules",
    variantEnd: "rules",
  };
  return map[status] ?? "";
}

/**
 * PGN-Header `Termination`. Der Standard schreibt keinen festen Wortlaut vor;
 * chess.com und Lichess formulieren ihn als Satz ("Torim98 won by resignation").
 * Deshalb wird auf Stichwörter geprüft und im Zweifel nichts behauptet.
 */
export function terminationFromPgnHeader(value: string): Termination | "" {
  const text = value.toLowerCase();
  if (!text) return "";
  // Die Reihenfolge trägt hier Bedeutung: "stalemate" enthält "mate", und
  // "material" ebenfalls. Deshalb stehen die spezifischen Wörter zuerst und
  // "mate" wird nie für sich allein geprüft.
  if (text.includes("stalemate")) return "stalemate";
  if (text.includes("insufficient")) return "insufficient";
  if (text.includes("checkmate")) return "mate";
  if (text.includes("resign")) return "resign";
  if (text.includes("time forfeit") || text.includes("on time") || text.includes("timeout")) {
    return "timeout";
  }
  if (text.includes("agree")) return "agreement";
  if (text.includes("repetition") || text.includes("repeat")) return "repetition";
  if (text.includes("50-move") || text.includes("50 move") || text.includes("fifty")) {
    return "fifty";
  }
  if (text.includes("abandon") || text.includes("unterminated")) return "abandoned";
  if (text.includes("rules infraction") || text.includes("forfeit")) return "rules";
  return "";
}

/**
 * Gegenstück fürs PGN-Schreiben. Der Standard schreibt keinen Wortlaut vor;
 * diese Sätze sind so gewählt, dass `terminationFromPgnHeader` sie wieder
 * einliest · ein Export/Import-Rundlauf verliert den Grund damit nicht.
 */
export function pgnTerminationHeader(reason: Termination): string {
  const labels: Record<Termination, string> = {
    mate: "Checkmate",
    resign: "Resignation",
    timeout: "Time forfeit",
    stalemate: "Stalemate",
    agreement: "Draw by agreement",
    repetition: "Threefold repetition",
    fifty: "50-move rule",
    insufficient: "Insufficient material",
    abandoned: "Abandoned",
    rules: "Rules infraction",
  };
  return labels[reason];
}

/** Feld des Königs einer Seite; null, wenn die FEN keinen enthält. */
export function kingSquare(fen: string, side: "white" | "black"): string | null {
  const squares = fenSquares(fen);
  if (!squares) return null;
  const king = side === "white" ? "K" : "k";
  const index = squares.indexOf(king);
  if (index < 0) return null;
  const file = index % 8;
  const rank = 8 - Math.floor(index / 8);
  return `${String.fromCharCode(97 + file)}${rank}`;
}

function sideToMove(fen: string): "white" | "black" | null {
  const field = fen.trim().split(/\s+/)[1];
  return field === "w" ? "white" : field === "b" ? "black" : null;
}

function other(side: "white" | "black"): "white" | "black" {
  return side === "white" ? "black" : "white";
}

/**
 * Aus der Stellung ableitbares Ende · null, solange noch gespielt werden kann.
 * Das ist der Weg für Endspiel-Drills, Puzzles und selbst gespielte Varianten,
 * die keinen gespeicherten Grund haben.
 */
export function endForPosition(fen: string): BoardEnd | null {
  let position: Chess;
  try {
    position = new Chess(fen);
  } catch {
    return null;
  }
  const toMove = sideToMove(fen);
  if (!toMove) return null;
  if (position.isCheckmate()) {
    return { reason: "mate", winner: other(toMove), square: kingSquare(fen, toMove) };
  }
  if (position.isStalemate()) {
    return { reason: "stalemate", winner: null, square: kingSquare(fen, toMove) };
  }
  if (position.isInsufficientMaterial()) {
    return { reason: "insufficient", winner: null, square: null };
  }
  if (position.isDrawByFiftyMoves()) {
    return { reason: "fifty", winner: null, square: null };
  }
  return null;
}

/**
 * Das Ende einer importierten Partie: gespeicherter Grund und Ausgang schlagen
 * die Ableitung, weil nur sie Aufgabe und Zeitüberschreitung kennen. Fehlt der
 * Grund, bleibt immerhin der Ausgang · „Schwarz gewinnt" ohne Zusatz ist
 * ehrlicher als ein erfundenes Matt.
 */
export function gameEnd(input: {
  /** Schlussstellung der Partie. */
  fen: string;
  /** Wert aus `games.termination`; "" heißt unbekannt. */
  termination?: string;
  result?: "win" | "loss" | "draw";
  /** Eigene Farbe in dieser Partie · nur damit wird aus dem Ergebnis eine Seite. */
  color?: "white" | "black";
}): BoardEnd | null {
  const { fen, color, result } = input;
  const stored = input.termination && isTermination(input.termination) ? input.termination : null;
  const derived = endForPosition(fen);

  const winner: "white" | "black" | null =
    result && color
      ? result === "draw"
        ? null
        : result === "win"
          ? color
          : other(color)
      : (derived?.winner ?? null);

  const reason = stored ?? derived?.reason ?? null;
  if (!reason && !result) return null;

  // Der Marker gehört auf den König der Verliererseite. Bei einem Remis ohne
  // betroffene Seite (Vereinbarung, Wiederholung) trägt nur der Streifen die
  // Aussage · siehe `BoardEnd.square`.
  let square: string | null = null;
  if (winner) square = kingSquare(fen, other(winner));
  else if (reason === "stalemate") square = derived?.square ?? null;

  return { reason, winner, square };
}
