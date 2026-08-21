import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativeUrl) => JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8"));

test("keeps Android notification settings out of desktop builds", () => {
  const shared = readJson("../src-tauri/tauri.conf.json");
  const android = readJson("../src-tauri/tauri.android.conf.json");

  assert.equal(shared.plugins?.notification, undefined);
  assert.deepEqual(android.plugins?.notification, {
    icon: "ic_notification",
    iconColor: "#22C08A",
  });
});
