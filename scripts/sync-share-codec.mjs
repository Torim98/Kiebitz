#!/usr/bin/env node
/**
 * Spiegelt den Share-Codec und die Figurenzeichnungen in den Worker.
 *
 * Ein geteilter Link wird an zwei Stellen gelesen: in der App und auf der
 * Landeseite, die der Worker `kiebitz-share` ausliefert. Beide müssen exakt
 * dasselbe Format sprechen — ein Byte Unterschied, und ein Link aus der App
 * öffnet im Browser eine kaputte Stellung.
 *
 * Statt einer geteilten Bibliothek (zwei Repos, kein gemeinsames Paket) hält
 * dieses Skript die Dateien wörtlich gleich. Die Kopie im Worker trägt einen
 * Kopf, der sagt, woher sie kommt und dass sie nicht von Hand zu ändern ist.
 *
 *   node scripts/sync-share-codec.mjs [--check]
 *
 * `--check` schreibt nichts und meldet mit Exit-Code 1, wenn die Kopien
 * abweichen. Fehlt das Nachbar-Repository, endet der Lauf ohne Befund: Nicht
 * jede Arbeitskopie hat beide Repos nebeneinander, und die eigentliche
 * Sicherung sind die Testvektoren, die auf beiden Seiten laufen.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = resolve(ROOT, "..", "kiebitz-api");
const CHECK = process.argv.includes("--check");

/** Was gespiegelt wird · Quelle in der App, Ziel im Worker. */
const FILES = [
  {
    from: join(ROOT, "src", "lib", "share", "codec.ts"),
    to: join(WORKER, "src", "share", "codec.ts"),
  },
  {
    from: join(ROOT, "src", "components", "pieceGlyphs.ts"),
    to: join(WORKER, "src", "share", "pieces.ts"),
  },
];

const header = (source) => `// Kopie aus Kiebitz · ${source}
// Erzeugt von scripts/sync-share-codec.mjs · nicht von Hand ändern.
//
// Landeseite und App müssen denselben Link lesen. Was hier abweicht, öffnet
// beim Empfänger eine andere Stellung als beim Absender.

`;

if (!existsSync(WORKER)) {
  console.log(`kiebitz-api liegt nicht unter ${WORKER} · nichts zu spiegeln.`);
  process.exit(0);
}

let stale = 0;
for (const { from, to } of FILES) {
  const source = from.slice(ROOT.length + 1).replaceAll("\\", "/");
  const wanted = header(source) + readFileSync(from, "utf8");
  const current = existsSync(to) ? readFileSync(to, "utf8") : null;
  if (current === wanted) {
    console.log(`${source}: aktuell`);
    continue;
  }
  if (CHECK) {
    console.error(`${source}: Kopie im Worker weicht ab · "npm run share:sync" ausführen.`);
    stale++;
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, wanted);
  console.log(`${source} → ${to}`);
}

process.exit(stale > 0 ? 1 : 0);
