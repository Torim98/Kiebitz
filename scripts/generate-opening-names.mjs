#!/usr/bin/env node
/**
 * Erzeugt die offline gebündelte Stellungs→Eröffnungsname-Tabelle aus dem
 * CC0-Datensatz von lichess-org/chess-openings. Der Commit ist absichtlich
 * gepinnt, damit Builds reproduzierbar bleiben.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src", "data", "opening-names.json");
const REVISION = "51b886249b9e418498d25b6e39b926c3de99c29a";
const BASE = `https://raw.githubusercontent.com/lichess-org/chess-openings/${REVISION}`;

const positionKey = (fen) => fen.split(" ").slice(0, 4).join(" ");

const tables = await Promise.all(
  ["a", "b", "c", "d", "e"].map(async (volume) => {
    const response = await fetch(`${BASE}/${volume}.tsv`);
    if (!response.ok) throw new Error(`${volume}.tsv: HTTP ${response.status}`);
    return response.text();
  })
);

const names = new Map();
for (const table of tables) {
  const [, ...rows] = table.replace(/\r/g, "").split("\n");
  for (const row of rows) {
    if (!row.trim()) continue;
    const [, name, pgn] = row.split("\t");
    if (!name || !pgn) continue;
    const chess = new Chess();
    try {
      chess.loadPgn(pgn);
      names.set(positionKey(chess.fen()), name);
    } catch {
      throw new Error(`Ungültige Eröffnungszeile: ${pgn}`);
    }
  }
}

const sorted = Object.fromEntries(
  [...names].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
);
writeFileSync(OUT, `${JSON.stringify(sorted)}\n`);
console.log(`${names.size} Eröffnungsstellungen nach ${OUT} geschrieben.`);
