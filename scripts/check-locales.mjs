/**
 * Prüft die Wörterbücher unter src/lib/locales gegen das deutsche Original.
 *
 * Der Typ-Checker fängt fehlende Schlüssel bereits ab; dieses Skript meldet
 * zusätzlich das, was ihm entgeht: Schlüssel, die nur unübersetzt kopiert
 * wurden, und Platzhalter ({n}, {p} …), die beim Übersetzen verloren gingen.
 * Ein fehlender Platzhalter ist der teuerste Fehler in einer Übersetzung — der
 * Text steht dann mit einer Lücke statt einer Zahl in der Oberfläche.
 *
 *   node scripts/check-locales.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "lib", "locales");

/** Einträge "key": "value" aus einer Wörterbuchdatei lesen. */
function entries(file) {
  const source = readFileSync(join(dir, file), "utf8");
  const found = new Map();
  const pattern = /^\s*"([^"]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    found.set(match[1], match[2]);
  }
  return found;
}

const placeholders = (text) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");

const de = entries("de.ts");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "de.ts" && f !== "themes.ts");

let problems = 0;
for (const file of files) {
  const locale = file.replace(/\.ts$/, "");
  const dict = entries(file);
  const missing = [...de.keys()].filter((key) => !dict.has(key));
  const extra = [...dict.keys()].filter((key) => !de.has(key));
  const brokenParams = [...dict.entries()].filter(
    ([key, value]) => de.has(key) && placeholders(de.get(key)) !== placeholders(value)
  );

  const report = [];
  if (missing.length) report.push(`${missing.length} fehlen: ${missing.slice(0, 8).join(", ")}`);
  if (extra.length) report.push(`${extra.length} unbekannt: ${extra.slice(0, 8).join(", ")}`);
  if (brokenParams.length) {
    report.push(
      `${brokenParams.length} mit falschen Platzhaltern: ${brokenParams
        .slice(0, 8)
        .map(([key]) => key)
        .join(", ")}`
    );
  }

  if (report.length === 0) {
    console.log(`${locale}: ${dict.size} Schlüssel · in Ordnung`);
  } else {
    problems++;
    console.log(`${locale}: ${dict.size} Schlüssel · ${report.join(" · ")}`);
  }
}

console.log(`de: ${de.size} Schlüssel (Quelle)`);
process.exit(problems > 0 ? 1 : 0);
