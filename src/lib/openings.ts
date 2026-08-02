import { Chess } from "chess.js";
import openingNames from "../data/opening-names.json";

/**
 * Namen aus lichess-org/chess-openings, Revision
 * 51b886249b9e418498d25b6e39b926c3de99c29a (CC0 1.0).
 */
const names = openingNames as Record<string, string>;

const positionKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** Zu einer Zugfolge die zuletzt erreichte benannte Eröffnung finden. */
export function openingName(sans: string[]): string {
  const chess = new Chess();
  let found = "";
  for (const san of sans) {
    try {
      chess.move(san);
    } catch {
      break;
    }
    found = names[positionKey(chess.fen())] ?? found;
  }
  return found;
}
