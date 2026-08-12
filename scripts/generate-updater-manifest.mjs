import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { buildUpdaterManifest } from "./lib/updater-manifest.mjs";

const { RELEASE_ID, REPOSITORY, SERVER_URL, TAG } = process.env;
if (!RELEASE_ID || !REPOSITORY || !SERVER_URL || !TAG) {
  throw new Error("RELEASE_ID, REPOSITORY, SERVER_URL und TAG müssen gesetzt sein.");
}

const ghJson = (endpoint) => JSON.parse(execFileSync(
  "gh",
  ["api", endpoint],
  { encoding: "utf8" },
));
const release = ghJson(`repos/${REPOSITORY}/releases/${RELEASE_ID}`);
const assets = ghJson(`repos/${REPOSITORY}/releases/${RELEASE_ID}/assets?per_page=100`);
const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;

const manifest = await buildUpdaterManifest({
  release,
  assets,
  repository: REPOSITORY,
  serverUrl: SERVER_URL,
  tag: TAG,
  version,
  readSignature: (asset) => execFileSync(
    "gh",
    [
      "api",
      `repos/${REPOSITORY}/releases/assets/${asset.id}`,
      "-H",
      "Accept: application/octet-stream",
    ],
    { encoding: "utf8" },
  ),
});

writeFileSync("latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json für ${Object.keys(manifest.platforms).join(", ")}`);
