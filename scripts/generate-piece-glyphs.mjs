#!/usr/bin/env node
/**
 * Zieht die Figurenzeichnungen aus dem Brett heraus, damit Schlagliste und
 * Share-Karte dieselben Figuren zeigen wie das Brett daneben.
 *
 * Warum nicht abschreiben: Ein zweites Figurenset von Hand liefe langsam
 * auseinander. `react-chessboard` gibt seine Zeichnungen seit Version 5 als
 * `defaultPieces` heraus · das Skript rendert sie einmal zu Markup und legt
 * wörtlich ab, was dabei herauskommt.
 *
 *   node scripts/generate-piece-glyphs.mjs [--check]
 *
 * `--check` schreibt nichts und meldet mit Exit-Code 1, wenn die erzeugte
 * Datei nicht mehr zum installierten `react-chessboard` passt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPieces } from "react-chessboard";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src", "components", "pieceGlyphs.ts");
const CHECK = process.argv.includes("--check");

// Alle zwölf Figuren. Die Schlagliste kommt ohne Könige aus, die Share-Karte
// zeichnet dagegen ein vollständiges Brett und braucht sie.
const PIECES = ["wP", "wB", "wN", "wR", "wQ", "wK", "bP", "bB", "bN", "bR", "bQ", "bK"];

const glyphs = {};
for (const piece of PIECES) {
  const render = defaultPieces[piece];
  if (typeof render !== "function") {
    throw new Error(`Figur ${piece} fehlt in defaultPieces von react-chessboard.`);
  }
  const markup = renderToStaticMarkup(createElement(render));
  // Nur der Inhalt des äußeren `svg` — also exakt das, was das Brett in
  // seinen Rahmen hängt. Der Rahmen selbst bleibt der Komponente überlassen,
  // damit sie die Größe bestimmt statt der fest eingebauten 45 px.
  const inner = markup.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/);
  if (!inner) throw new Error(`Figur ${piece} kam nicht als einzelnes <svg> zurück.`);
  glyphs[piece] = inner[1].replace(/\s+/g, " ").trim();
}

const body = PIECES.map((piece) => `  ${piece}: ${JSON.stringify(glyphs[piece])},`).join("\n");
const file = `// Erzeugt von scripts/generate-piece-glyphs.mjs · nicht von Hand ändern.
//
// Der Inhalt stammt wörtlich aus den Figuren, die \`react-chessboard\` auf das
// Brett zeichnet · damit zeigen Schlagliste und geteilte Bildkarte dieselben
// Figuren wie das Brett daneben. Neu erzeugen nach jedem Update von
// react-chessboard:
//
//   npm run pieces:sync
//
// Zeichnungen: SVG chess pieces von en:User:Cburnett, CC BY-SA 3.0
// https://commons.wikimedia.org/w/index.php?curid=1499810
// Siehe THIRD_PARTY_NOTICES.md · Abschnitt "Chess piece artwork".

/** Innerer SVG-Inhalt je Figur · gezeichnet in einem 45×45-Feld. */
export const PIECE_GLYPH: Record<string, string> = {
${body}
};

/** Ausschnitt, den das Brett um dieselben Zeichnungen legt · hier identisch,
 * damit eine geschlagene Figur genauso beschnitten ist wie auf dem Brett. */
export const PIECE_VIEWBOX = "1 1 43 43";
`;

if (CHECK) {
  const current = readFileSync(OUT, "utf8");
  if (current !== file) {
    console.error(`${OUT} ist nicht mehr aktuell · "npm run pieces:sync" ausführen.`);
    process.exit(1);
  }
  console.log("Figurenzeichnungen sind aktuell.");
} else {
  writeFileSync(OUT, file);
  console.log(`${PIECES.length} Figuren nach ${OUT} geschrieben.`);
}
process.exit(0);
