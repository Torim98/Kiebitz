import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativeUrl) => JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8"));

test("keeps notification settings out of Tauri plugin configuration", () => {
  const shared = readJson("../src-tauri/tauri.conf.json");
  const android = readJson("../src-tauri/tauri.android.conf.json");

  assert.equal(shared.plugins?.notification, undefined);
  assert.equal(android.plugins?.notification, undefined);
});
