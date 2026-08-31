#!/usr/bin/env node
/**
 * Macht aus den mitgelieferten Fremd-Figurensets je ein Modul für die App.
 *
 * Unter `src/lib/pieces/vendor/<set>/` liegen die zwölf Originaldateien, so wie
 * sie von lichess kommen · unverändert, damit die Quelle nachprüfbar bleibt und
 * die Lizenzen sich auf etwas beziehen, das auch im Repo steht. Zeichnen kann
 * die App damit aber noch nicht: Zwölf Figuren stehen gleichzeitig in einem
 * Dokument, und drei Dinge gehen dabei schief.
 *
 *  1. Jede Datei bringt ihre eigenen IDs mit ("a", "fillGradient"), und die sind
 *     im SVG dokumentweit. Zwölf Bauern mit derselben Verlaufs-ID heißt: elf
 *     Figuren holen sich den Verlauf der ersten. Jede ID bekommt deshalb ihr
 *     Set und ihre Figur vorangestellt.
 *  2. Manche Sätze bringen einen <style>-Block mit Klassen wie `.base` mit. CSS
 *     in einem eingebetteten SVG gilt für die *ganze* Seite · das sind zwölf
 *     Regelsätze, die in die App hineinreichen. Die Regeln wandern deshalb als
 *     `style`-Attribut an die Elemente, die sie tragen.
 *  3. Die Sätze zeichnen in verschiedenen Feldern (45, 50, 800, 933 Einheiten).
 *     Der viewBox bleibt stehen und die Datei bekommt 45x45 als Größe · damit
 *     rechnet der Browser um, und der Ausschnitt (PIECE_VIEWBOX) passt für alle.
 *
 *   node scripts/generate-vendor-pieces.mjs [--check]
 *
 * `--check` schreibt nichts und meldet mit Exit-Code 1, wenn die erzeugten
 * Dateien nicht mehr zu den Originalen passen.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "src", "lib", "pieces", "vendor");
const CHECK = process.argv.includes("--check");

const PIECES = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"];

/**
 * Die Sätze und woher sie stammen · dieselben Angaben stehen in
 * THIRD_PARTY_NOTICES.md und im Kopf jeder erzeugten Datei.
 */
const SETS = [
  {
    id: "merida",
    constant: "MERIDA_GLYPHS",
    author: "Armando Hernandez Marroquin",
    license: "GPLv2+ (https://www.gnu.org/licenses/gpl-2.0.txt)",
  },
  {
    id: "fantasy",
    constant: "FANTASY_GLYPHS",
    author: "Maurizio Monge (https://github.com/maurimo/chess-art)",
    license: "MIT (https://github.com/maurimo/chess-art/blob/main/LICENSE)",
  },
  {
    id: "chessnut",
    constant: "CHESSNUT_GLYPHS",
    author: "Alexis Luengas (https://github.com/LexLuengas/chessnut-pieces)",
    license: "Apache 2.0 (https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt)",
  },
];

const SOURCE = "https://github.com/lichess-org/lila/tree/master/public/piece";

/** Klassenregeln eines <style>-Blocks an die Elemente hängen, die sie tragen. */
function inlineStyles(svg) {
  const rules = new Map();
  const withoutStyle = svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
    for (const [, selector, declarations] of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      rules.set(selector, declarations.trim().replace(/;$/, ""));
    }
    return "";
  });
  if (rules.size === 0) return withoutStyle;

  return withoutStyle.replace(
    /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g,
    (whole, tag, attributes, selfClosing) => {
      const found = /\sclass="([^"]*)"/.exec(attributes);
      if (!found) return whole;
      const declarations = found[1]
        .trim()
        .split(/\s+/)
        .map((name) => rules.get(name))
        .filter(Boolean)
        .join(";");
      let rest = attributes.replace(found[0], "");
      if (declarations) {
        const style = /\sstyle="([^"]*)"/.exec(rest);
        // Das eigene style-Attribut gewinnt · genauso wie zuvor gegen die Klasse.
        if (style) rest = rest.replace(style[0], ` style="${declarations};${style[1]}"`);
        else rest += ` style="${declarations}"`;
      }
      return `<${tag}${rest}${selfClosing}>`;
    }
  );
}

/** IDs eindeutig machen · samt aller Verweise darauf. */
function namespaceIds(svg, prefix) {
  return svg
    .replace(/\sid="([^"]+)"/g, (_, id) => ` id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/((?:xlink:)?href)="#([^"]+)"/g, (_, attribute, id) => `${attribute}="#${prefix}${id}"`);
}

/** Eine Originaldatei in einen Schnipsel für `pieceGlyphs` verwandeln. */
function convert(setId, piece) {
  const original = readFileSync(resolve(DIR, setId, `${piece}.svg`), "utf8");
  let svg = original
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
  svg = inlineStyles(svg);
  svg = namespaceIds(svg, `${setId}-${piece}-`);
  // Die Datei misst sich selbst in Millimetern oder gar nicht · beides ist im
  // Brett falsch. 45x45 ist das Feld, in dem alle Sätze gezeichnet werden.
  svg = svg.replace(/^<svg([^>]*)>/, (_, attributes) => {
    const cleaned = attributes.replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${cleaned} width="45" height="45">`;
  });
  return `<g>${svg}</g>`;
}

let failed = false;
for (const set of SETS) {
  const glyphs = Object.fromEntries(PIECES.map((piece) => [piece, convert(set.id, piece)]));
  const body = PIECES.map((piece) => `  ${piece}: ${JSON.stringify(glyphs[piece])},`).join("\n");
  const file = [
    `// Erzeugt von scripts/generate-vendor-pieces.mjs · nicht von Hand ändern.`,
    `//`,
    `// Zeichnungen: ${set.author}`,
    `// Lizenz: ${set.license}`,
    `// Quelle: ${SOURCE}/${set.id}`,
    `//`,
    `// Die Originaldateien liegen unverändert in ./${set.id}/. Neu erzeugen mit:`,
    `//`,
    `//   npm run pieces:sync`,
    ``,
    `/** Die zwölf Figuren des Satzes · Schlüssel wie in \`PIECE_GLYPH\`. */`,
    `export const ${set.constant}: Record<string, string> = {`,
    body,
    `};`,
    ``,
  ].join("\n");

  const out = resolve(DIR, `${set.id}.ts`);
  if (CHECK) {
    let current = "";
    try {
      current = readFileSync(out, "utf8");
    } catch {
      current = "";
    }
    if (current.replace(/\r\n/g, "\n") !== file) {
      console.error(`${set.id}.ts passt nicht mehr zu den Originalen in ${set.id}/`);
      failed = true;
    } else {
      console.log(`${set.id}: in Ordnung`);
    }
  } else {
    writeFileSync(out, file);
    console.log(`${set.id}: ${(file.length / 1024).toFixed(1)} KiB geschrieben`);
  }
}

if (failed) process.exit(1);
