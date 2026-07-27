/**
 * Zufällige Endspielstellungen für den Trainer.
 *
 * Die Materialverteilungen sind so gewählt, dass das Ergebnis allein am
 * Material hängt (Matt erzwingbar bzw. Remis haltbar) · die Aufgabe bleibt
 * dadurch auch bei zufälliger Aufstellung eindeutig. Damit nichts sofort
 * hängt, hält der verteidigende König Abstand zu den gegnerischen Figuren.
 */
import { Chess } from "chess.js";
import type { EndgameDrill } from "../data/endgames";

interface Template {
  /** Stabile ID · sie zählt die Statistik je Materialbild, nicht je Stellung. */
  id: string;
  /** Figuren der Gewinnerseite (ohne König), FEN-Buchstaben. */
  strong: string[];
  /** Figuren der Verteidigerseite (ohne König). */
  weak: string[];
  goal: "win" | "draw";
  name: { de: string; en: string };
  hint: { de: string; en: string };
}

const TEMPLATES: Template[] = [
  {
    id: "rnd-kq-k",
    strong: ["q"],
    weak: [],
    goal: "win",
    name: { de: "Zufall: Dame gegen König", en: "Random: queen vs. king" },
    hint: {
      de: "Springerabstand halten, den König an den Rand drängen, eigenen König nachführen · und auf Patt achten.",
      en: "Keep a knight's distance, push the king to the edge, bring your king up · and watch for stalemate.",
    },
  },
  {
    id: "rnd-kr-k",
    strong: ["r"],
    weak: [],
    goal: "win",
    name: { de: "Zufall: Turm gegen König", en: "Random: rook vs. king" },
    hint: {
      de: "Box-Methode: Der Turm schneidet ab, der König erobert die Opposition, dann verkleinerst du den Käfig.",
      en: "Box method: the rook cuts off, your king takes the opposition, then shrink the box.",
    },
  },
  {
    id: "rnd-kbb-k",
    strong: ["b", "b"],
    weak: [],
    goal: "win",
    name: { de: "Zufall: Läuferpaar gegen König", en: "Random: two bishops vs. king" },
    hint: {
      de: "Die Läufer bilden eine Diagonalwand und schieben den König in die Ecke; der eigene König nimmt ihm die Fluchtfelder.",
      en: "The bishops build a diagonal wall and push the king to a corner while your king takes the escape squares.",
    },
  },
  {
    id: "rnd-kqq-k",
    strong: ["q", "q"],
    weak: [],
    goal: "win",
    name: { de: "Zufall: Zwei Damen gegen König", en: "Random: two queens vs. king" },
    hint: {
      de: "Treppenmatt: Eine Dame sperrt eine Reihe, die andere gibt Schach auf der nächsten.",
      en: "Ladder mate: one queen seals a rank, the other checks on the next.",
    },
  },
  {
    id: "rnd-kqr-k",
    strong: ["q", "r"],
    weak: [],
    goal: "win",
    name: { de: "Zufall: Dame und Turm gegen König", en: "Random: queen and rook vs. king" },
    hint: {
      de: "Treppenmatt mit Dame und Turm · Reihe für Reihe abschneiden, ohne dass eine Figur ungedeckt steht.",
      en: "Ladder mate with queen and rook · cut off rank by rank without leaving a piece hanging.",
    },
  },
  {
    id: "rnd-kr-kb",
    strong: ["b"],
    weak: ["r"],
    goal: "draw",
    name: { de: "Zufall: Läufer hält gegen Turm", en: "Random: bishop holds vs. rook" },
    hint: {
      de: "Zur richtigen Ecke laufen und den Läufer aktiv halten · Turm allein setzt nicht matt.",
      en: "Head for the right corner and keep the bishop active · a lone rook cannot mate.",
    },
  },
  {
    id: "rnd-kr-kn",
    strong: ["n"],
    weak: ["r"],
    goal: "draw",
    name: { de: "Zufall: Springer hält gegen Turm", en: "Random: knight holds vs. rook" },
    hint: {
      de: "Springer und König beieinander halten; getrennt wird der Springer zur Beute.",
      en: "Keep knight and king together; separated, the knight becomes prey.",
    },
  },
];

const FILES = "abcdefgh";

function square(index: number): string {
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}`;
}

/** Schachbrett-Distanz (Königsschritte). */
function distance(a: number, b: number): number {
  const dx = Math.abs((a % 8) - (b % 8));
  const dy = Math.abs(Math.floor(a / 8) - Math.floor(b / 8));
  return Math.max(dx, dy);
}

function buildFen(pieces: Map<number, string>, sideToMove: "w" | "b"): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pieces.get(rank * 8 + file);
      if (!piece) {
        empty++;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      row += piece;
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  return `${rows.join("/")} ${sideToMove} - - 0 1`;
}

/**
 * Baut eine zufällige Stellung zur Vorlage. `random` ist injizierbar, damit
 * Tests deterministisch laufen.
 */
export function randomDrill(random: () => number = Math.random): EndgameDrill {
  const template = TEMPLATES[Math.floor(random() * TEMPLATES.length) % TEMPLATES.length];
  // Der Spieler zieht immer zuerst: bei „win" die starke, bei „draw" die
  // schwache Seite · so kann ihm nichts vor dem ersten Zug abhandenkommen.
  const playerIsWhite = random() < 0.5;
  const strongColor: "w" | "b" = template.goal === "win" ? (playerIsWhite ? "w" : "b") : playerIsWhite ? "b" : "w";
  const side = playerIsWhite ? "white" : "black";

  for (let attempt = 0; attempt < 400; attempt++) {
    const used = new Set<number>();
    const pick = (): number => {
      for (;;) {
        const index = Math.floor(random() * 64) % 64;
        if (!used.has(index)) {
          used.add(index);
          return index;
        }
      }
    };
    const strongKing = pick();
    const weakKing = pick();
    // Könige dürfen sich nie berühren.
    if (distance(strongKing, weakKing) < 2) continue;

    const pieces = new Map<number, string>();
    const asColor = (letter: string, color: "w" | "b") =>
      color === "w" ? letter.toUpperCase() : letter;
    const weakColor: "w" | "b" = strongColor === "w" ? "b" : "w";
    pieces.set(strongKing, asColor("k", strongColor));
    pieces.set(weakKing, asColor("k", weakColor));

    let hanging = false;
    for (const letter of template.strong) {
      const at = pick();
      // Nichts direkt neben den gegnerischen König stellen.
      if (distance(at, weakKing) < 2) {
        hanging = true;
        break;
      }
      pieces.set(at, asColor(letter, strongColor));
    }
    if (hanging) continue;
    for (const letter of template.weak) {
      const at = pick();
      if (distance(at, strongKing) < 2) {
        hanging = true;
        break;
      }
      pieces.set(at, asColor(letter, weakColor));
    }
    if (hanging) continue;

    const fen = buildFen(pieces, playerIsWhite ? "w" : "b");
    try {
      const chess = new Chess(fen);
      // Weder sofort entschieden noch bereits Schach · die Aufgabe soll erst
      // durch Technik entschieden werden.
      if (chess.isGameOver() || chess.isCheck() || chess.moves().length === 0) continue;
      return {
        id: template.id,
        category: "random",
        side,
        goal: template.goal,
        fen,
        name: template.name,
        hint: template.hint,
      };
    } catch {
      continue;
    }
  }

  // Rückfallebene: Turmmatt aus der Grundaufstellung des Lehrbuchs.
  return {
    id: "rnd-kr-k",
    category: "random",
    side: "white",
    goal: "win",
    fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    name: TEMPLATES[1].name,
    hint: TEMPLATES[1].hint,
  };
}

/** Alle Materialbilder · für die Fortschrittsanzeige der Zufallsaufgaben. */
export const RANDOM_TEMPLATE_IDS = TEMPLATES.map((template) => template.id);
