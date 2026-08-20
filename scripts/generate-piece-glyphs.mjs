#!/usr/bin/env node
/**
 * Zieht die Figurenzeichnungen aus dem Brett heraus, damit die Schlagliste
 * unter den Spielernamen dieselben Figuren zeigt wie das Brett daneben.
 *
 * Warum nicht einfach importieren: `react-chessboard` hält seine Figuren in
 * einem internen `defaultPieces`-Objekt und exportiert es nicht. Statt die
 * Pfade abzuschreiben — und damit ein zweites, langsam auseinanderlaufendes
 * Figurenset zu pflegen — rendert dieses Skript ein echtes Brett in jsdom und
 * liest ab, was dabei im DOM steht. Was das Brett zeichnet, steht danach
 * wörtlich in `src/components/pieceGlyphs.ts`.
 *
 *   node scripts/generate-piece-glyphs.mjs [--check]
 *
 * `--check` schreibt nichts und meldet mit Exit-Code 1, wenn die erzeugte
 * Datei nicht mehr zum installierten `react-chessboard` passt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src", "components", "pieceGlyphs.ts");
const CHECK = process.argv.includes("--check");

// Geschlagen werden kann alles außer dem König · nur diese Figuren brauchen wir.
const PIECES = ["wP", "wB", "wN", "wR", "wQ", "bP", "bB", "bN", "bR", "bQ"];
// Eine Stellung, in der jede dieser Figuren genau einmal vorkommt.
const POSITION = "1qrbnk2/1p6/8/8/8/8/1P6/1QRBNK2 w - - 0 1";

// jsdom muss stehen, bevor React geladen wird: react-dnd entscheidet beim
// Import anhand von `window`, welches Backend es benutzt.
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const expose = (key, value) =>
  // `navigator` und Geschwister sind in neueren Node-Versionen Getter ohne
  // Setter · deshalb definieren statt zuweisen.
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
expose("window", dom.window);
// react-dnd greift beim Import auf `Image`, `document` und weitere Browser-
// Globals zu. Statt sie einzeln aufzuzählen, kommt alles mit, was jsdom
// anbietet und Node nicht schon selbst hat.
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key === "window" || key in globalThis) continue;
  expose(key, dom.window[key]);
}
expose("document", dom.window.document);
expose("navigator", dom.window.navigator);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Chessboard } = await import("react-chessboard");

const container = dom.window.document.getElementById("root");
const root = createRoot(container);
const render = () =>
  createElement(Chessboard, { position: POSITION, boardWidth: 360, arePiecesDraggable: false });

act(() => root.render(render()));
// Das Brett baut sich in Effekten auf (DnD-Backend, Figurenset) · zwei Ticks
// reichen, bis die Figuren im DOM stehen.
await new Promise((done) => setTimeout(done, 0));
await new Promise((done) => setTimeout(done, 0));

const glyphs = {};
for (const piece of PIECES) {
  const svg = container.querySelector(`[data-piece="${piece}"] svg`);
  if (!svg) throw new Error(`Figur ${piece} nicht im gerenderten Brett gefunden.`);
  // Nur der Inhalt des äußeren `svg` — also exakt das, was das Brett in
  // seinen Rahmen hängt. Der Rahmen selbst bleibt der Komponente überlassen,
  // damit sie die Größe bestimmt statt der fest eingebauten 45 px.
  glyphs[piece] = svg.innerHTML.replace(/\s+/g, " ").trim();
}

const body = PIECES.map((piece) => `  ${piece}: ${JSON.stringify(glyphs[piece])},`).join("\n");
const file = `// Erzeugt von scripts/generate-piece-glyphs.mjs · nicht von Hand ändern.
//
// Der Inhalt stammt wörtlich aus den Figuren, die \`react-chessboard\` auf das
// Brett zeichnet · damit zeigt die Schlagliste dieselben Figuren wie das Brett
// daneben. Neu erzeugen nach jedem Update von react-chessboard:
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
