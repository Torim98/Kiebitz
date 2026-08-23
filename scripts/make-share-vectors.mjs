#!/usr/bin/env node
/**
 * Testvektoren des Share-Formats.
 *
 * Die eigentliche Absicherung, dass App und Worker denselben Link lesen. Das
 * Spiegeln der Datei (`share:sync`) hält beide Kopien gleich, aber es kann nur
 * melden, was jemand von Hand geändert hat. Diese Vektoren prüfen die Wirkung:
 * Beide Seiten lesen dieselben Zeichenketten und müssen dieselbe Stellung
 * herausbekommen — auch in einem Jahr, wenn die Datei zweimal umgebaut wurde.
 *
 * Deshalb sind die Vektoren nicht bei jedem Lauf neu zu erzeugen. Sie sind
 * eingefroren: Wer sie neu schreiben muss, ändert das Format, und das gehört
 * hinter eine neue Versionsnummer.
 *
 *   node scripts/make-share-vectors.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeShare } from "../src/lib/share/codec.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

/** Je ein Fall für jeden Teil des Formats · zusammen decken sie jedes Feld ab. */
const CASES = [
  {
    name: "start position",
    payload: {
      kind: "analysis",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      orientation: "white",
    },
  },
  {
    name: "en passant and black view",
    payload: {
      kind: "analysis",
      fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
      orientation: "black",
      lastMove: { from: "c7", to: "c5" },
      eval: { cp: 34, mate: null },
    },
  },
  {
    name: "puzzle with solution, rating and theme",
    payload: {
      kind: "puzzle",
      fen: "r4rk1/pp3ppp/2n5/8/8/2N5/PP3PPP/R4RK1 w - - 4 20",
      orientation: "white",
      lastMove: { from: "b8", to: "a8" },
      line: [
        { from: "c3", to: "d5" },
        { from: "g8", to: "h8" },
      ],
      rating: 1720,
      theme: "fork",
    },
  },
  {
    name: "mate score, promotion and a title",
    payload: {
      kind: "analysis",
      fen: "8/4P3/8/8/8/4k3/8/4K3 w - - 0 60",
      orientation: "white",
      line: [{ from: "e7", to: "e8", promo: "q" }],
      eval: { cp: null, mate: 3 },
      title: "Umwandlung mit Matt · Übung",
    },
  },
];

const vectors = {
  note: "Erzeugt von Kiebitz/scripts/make-share-vectors.mjs · in App und Worker identisch.",
  version: 1,
  cases: CASES.map((entry) => ({ ...entry, encoded: encodeShare(entry.payload) })),
};

const targets = [
  join(ROOT, "src", "lib", "share", "vectors.json"),
  join(ROOT, "..", "kiebitz-api", "src", "share", "vectors.json"),
];

const wanted = `${JSON.stringify(vectors, null, 2)}\n`;
let stale = 0;
for (const target of targets) {
  if (target.includes("kiebitz-api") && !existsSync(dirname(target))) {
    console.log(`${target}: Repository liegt nicht daneben · übersprungen.`);
    continue;
  }
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === wanted) {
    console.log(`${target}: aktuell`);
    continue;
  }
  if (CHECK) {
    console.error(`${target}: weicht ab · Formatänderung? Dann braucht sie eine neue Version.`);
    stale++;
    continue;
  }
  writeFileSync(target, wanted);
  console.log(`${target}: geschrieben`);
}

process.exit(stale > 0 ? 1 : 0);
