import { appendFileSync } from "node:fs";
import { pinEnvironment } from "./lib/toolchain-pins.mjs";

const values = pinEnvironment();
if (process.argv.includes("--github-env")) {
  const target = process.env.GITHUB_ENV;
  if (!target) throw new Error("GITHUB_ENV is not set");
  appendFileSync(target, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
} else {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
}
