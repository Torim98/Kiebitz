/**
 * Prüft die Farbwelten in src/themes.css auf lesbaren Kontrast.
 *
 * Die Datei verspricht in ihrem Kopf bestimmte Verhältnisse. Ein Versprechen,
 * das niemand nachrechnet, hält genau bis zur nächsten Farbkorrektur — deshalb
 * steht die Rechnung hier und nicht im Kommentar. Geprüft wird jede Paarung,
 * die in der Oberfläche tatsächlich als Text auf Fläche vorkommt.
 *
 * Grundlage ist das WCAG-Kontrastverhältnis; 4.5:1 ist die Schwelle für
 * normalen Text (AA). Vollständige Vollständigkeit ist das nicht — halb
 * durchsichtige Markierungen auf dem Brett lassen sich so nicht rechnen —,
 * aber es fängt den Fehler ab, der sonst erst dem Nutzer auffällt.
 *
 *   node scripts/check-theme-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src", "themes.css"), "utf8");

/** Mindestverhältnis für Text auf Fläche (WCAG AA). */
const MIN = 4.5;

/**
 * Was in der Oberfläche aufeinanderliegt: [Schrift, Fläche].
 *
 * Wer ein Paar hinzufügt, hat es vorher in der App gesehen · die Liste ist
 * eine Behauptung über die Oberfläche, keine Sammlung möglicher Kombinationen.
 */
const PAIRS = [
  ["ink", "panel"],
  ["ink2", "panel"],
  ["ink3", "panel"],
  ["ink2", "bg"],
  ["accent", "panel"],
  ["win", "panel"],
  ["loss", "panel"],
  ["draw", "panel"],
  ["warn", "panel"],
  ["blue", "panel"],
  ["violet", "panel"],
  ["gold", "panel"],
  ["cc", "panel"],
  // Zustandsflächen und Schrift auf einer Akzentfläche.
  ["loss", "loss-soft"],
  ["gold", "gold-soft"],
  ["accent-ink", "accent"],
];

/** Alle Themenblöcke als { theme: { token: "#rrggbb" } }. */
function themes() {
  const found = new Map();
  const blocks = source.matchAll(/\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g);
  for (const [, name, body] of blocks) {
    const tokens = new Map();
    for (const [, token, value] of body.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
      tokens.set(token, value.trim());
    }
    found.set(name, tokens);
  }
  return found;
}

function channels(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(front, back) {
  const [high, low] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

let problems = 0;
for (const [theme, tokens] of themes()) {
  let weakest = { pair: "", value: Infinity };
  for (const [front, back] of PAIRS) {
    const a = channels(tokens.get(front) ?? "");
    const b = channels(tokens.get(back) ?? "");
    if (!a || !b) {
      console.error(`${theme}: --color-${front} oder --color-${back} fehlt`);
      problems += 1;
      continue;
    }
    const value = ratio(a, b);
    if (value < weakest.value) weakest = { pair: `${front} auf ${back}`, value };
    if (value < MIN) {
      console.error(`${theme}: ${front} auf ${back} nur ${value.toFixed(2)}:1 (mindestens ${MIN})`);
      problems += 1;
    }
  }
  if (weakest.value < Infinity) {
    console.log(
      `${theme.padEnd(9)} knappstes Paar: ${weakest.pair} · ${weakest.value.toFixed(2)}:1`
    );
  }
}

if (problems > 0) {
  console.error(`\n${problems} Paarung(en) unter ${MIN}:1.`);
  process.exit(1);
}
console.log("\nAlle Farbwelten in Ordnung.");
