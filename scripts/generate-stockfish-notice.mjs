import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadToolchainPins, pinEnvironment, repoRoot } from "./lib/toolchain-pins.mjs";

const pins = loadToolchainPins();
const values = {
  ...pinEnvironment(pins),
  ANDROID_PAGE_SIZE_KB: String(pins.android.pageSize / 1024),
};
const templatePath = join(repoRoot, "src-tauri", "resources", "stockfish", "NOTICE.template.txt");
const outputPath = join(repoRoot, "src-tauri", "resources", "stockfish", "NOTICE.txt");
const template = readFileSync(templatePath, "utf8");
const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`Unknown Stockfish notice placeholder: ${key}`);
  return values[key];
});
if (/\{\{[^}]+\}\}/.test(rendered)) throw new Error("Unresolved Stockfish notice placeholder");

if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== rendered) {
    console.error("Stockfish NOTICE.txt is stale. Run: npm run pins:sync");
    process.exit(1);
  }
  console.log("Stockfish notice matches the central toolchain pins.");
} else {
  writeFileSync(outputPath, rendered);
  console.log("Updated src-tauri/resources/stockfish/NOTICE.txt");
}
