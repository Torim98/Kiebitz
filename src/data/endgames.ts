/**
 * Kuratierte Endspiel-Drills für den Endspiel-Trainer. Die IDs sind stabil —
 * sie landen als drill_id in der Datenbank (endgame_attempts).
 *
 * Jede Aufgabe ist ein theoretisch eindeutiges Lehrbuch-Endspiel: Ziel „win“
 * heißt, der Spieler muss gegen beste Verteidigung mattsetzen; Ziel „draw“
 * heißt, er muss gegen beste Angriffe das Remis halten (Patt, Zugwiederholung,
 * 50-Züge-Regel oder ungenügendes Material zählen als Erfolg).
 */

export type EndgameCategory = "mates" | "pawn" | "rook" | "queen";

export interface EndgameDrill {
  id: string;
  category: EndgameCategory;
  /** Seite, die der Spieler führt. */
  side: "white" | "black";
  goal: "win" | "draw";
  fen: string;
  name: { de: string; en: string };
  hint: { de: string; en: string };
}

export const ENDGAME_DRILLS: EndgameDrill[] = [
  // ── Grundlegende Mattführungen ─────────────────────────────────────────────
  {
    id: "mate-queen",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
    name: { de: "Damenmatt", en: "Queen checkmate" },
    hint: {
      de: "Die Dame hält Springerabstand zum König und drängt ihn an den Rand; der eigene König rückt nach. Vorsicht: kein Patt!",
      en: "Keep the queen a knight's move away from the king and drive him to the edge; bring your own king up. Careful: no stalemate!",
    },
  },
  {
    id: "mate-rook",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: { de: "Turmmatt", en: "Rook checkmate" },
    hint: {
      de: "Der Turm sperrt eine Reihe, der König erkämpft die Opposition — dann Schach und die nächste Reihe abschneiden (Box-Methode).",
      en: "The rook fences off a rank, your king fights for the opposition — then check and shrink the box.",
    },
  },
  {
    id: "mate-bishops",
    category: "mates",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1",
    name: { de: "Zwei Läufer", en: "Two bishops" },
    hint: {
      de: "Die Läufer bilden nebeneinander eine Barriere, der König wird in eine Ecke gedrängt. Der eigene König muss eng mitarbeiten.",
      en: "Side-by-side the bishops form a barrier; drive the king into a corner. Your own king must work closely with them.",
    },
  },

  // ── Bauernendspiele ────────────────────────────────────────────────────────
  {
    id: "pawn-front",
    category: "pawn",
    side: "white",
    goal: "win",
    fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
    name: { de: "König vor dem Bauern", en: "King in front of the pawn" },
    hint: {
      de: "Steht der König vor dem Bauern auf der 6. Reihe, ist es immer gewonnen: erst der König, dann der Bauer. Achtung Patt am Schluss.",
      en: "With the king in front of the pawn on the 6th rank it is always winning: king first, pawn second. Beware the final stalemate.",
    },
  },
  {
    id: "pawn-square",
    category: "pawn",
    side: "white",
    goal: "win",
    fen: "8/8/8/8/k7/8/6P1/6K1 w - - 0 1",
    name: { de: "Quadratregel", en: "The square rule" },
    hint: {
      de: "Steht der gegnerische König außerhalb des Quadrats des Freibauern, läuft er durch. Danach: Damenmatt zu Ende führen.",
      en: "If the defending king is outside the square of the passed pawn, it simply runs. Afterwards: convert the queen checkmate.",
    },
  },
  {
    id: "pawn-rookpawn",
    category: "pawn",
    side: "black",
    goal: "draw",
    fen: "2k5/8/K7/P7/8/8/8/8 b - - 0 1",
    name: { de: "Randbauer: Remis halten", en: "Rook pawn: hold the draw" },
    hint: {
      de: "Gegen den Randbauern rettet die Ecke: Erreicht dein König c8/a8, kommt Weiß nie heraus — Patt oder Dauerpendeln.",
      en: "Against a rook pawn the corner saves you: once your king reaches c8/a8, White never gets out — stalemate or endless shuffling.",
    },
  },
  {
    id: "pawn-opposition",
    category: "pawn",
    side: "black",
    goal: "draw",
    fen: "8/4k3/8/4K3/4P3/8/8/8 w - - 0 1",
    name: { de: "Opposition halten", en: "Keep the opposition" },
    hint: {
      de: "Bleib vor dem Bauern und nimm die Opposition, sobald der weiße König vorrückt. Weiche nie zur Seite aus, solange es geradeaus geht.",
      en: "Stay in front of the pawn and take the opposition whenever the white king steps up. Never sidestep while you can stay in line.",
    },
  },

  // ── Turmendspiele ──────────────────────────────────────────────────────────
  {
    id: "rook-lucena",
    category: "rook",
    side: "white",
    goal: "win",
    fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    name: { de: "Lucena: Brückenbau", en: "Lucena: building the bridge" },
    hint: {
      de: "Erst den gegnerischen König einen Schritt weiter abdrängen, dann den Turm auf die 4. Reihe: Der König tritt heraus und die „Brücke“ blockt die Schachs.",
      en: "First push the enemy king one file further away, then rook to the 4th rank: the king steps out and the “bridge” blocks the checks.",
    },
  },
  {
    id: "rook-philidor",
    category: "rook",
    side: "black",
    goal: "draw",
    fen: "4k3/8/r7/4K3/4P3/8/8/7R b - - 0 1",
    name: { de: "Philidor-Verteidigung", en: "Philidor defence" },
    hint: {
      de: "Turm auf der 6. Reihe patrouillieren lassen, solange der Bauer nicht dort steht. Rückt er auf die 6. vor: Turm nach unten und Dauerschach von hinten.",
      en: "Keep the rook patrolling the 6th rank while the pawn stays back. Once it advances to the 6th: drop the rook down and check from behind forever.",
    },
  },

  // ── Damenendspiele ─────────────────────────────────────────────────────────
  {
    id: "queen-pawn",
    category: "queen",
    side: "white",
    goal: "win",
    fen: "8/8/6K1/Q7/8/8/3pk3/8 w - - 0 1",
    name: { de: "Dame gegen Umwandlungsbauer", en: "Queen vs promoting pawn" },
    hint: {
      de: "Mit Schachs den König vor den Bauern zwingen — jedes Mal, wenn er das Umwandlungsfeld blockiert, rückt dein König einen Schritt näher.",
      en: "Check the king in front of its pawn — every time it blocks the promotion square, your own king gains a step.",
    },
  },
];

export const CATEGORY_ORDER: EndgameCategory[] = ["mates", "pawn", "rook", "queen"];
