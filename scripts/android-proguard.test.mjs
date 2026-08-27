import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rules = readFileSync(
  new URL("../src-tauri/gen/android/app/proguard-rules.pro", import.meta.url),
  "utf8",
);

test("keeps constructors that Android release startup loads through reflection", () => {
  assert.match(
    rules,
    /-keepclassmembers class \* extends androidx\.room\.RoomDatabase\s*\{\s*<init>\(\);\s*\}/,
  );
  assert.match(
    rules,
    /-keepclassmembers class \* implements com\.google\.firebase\.components\.ComponentRegistrar\s*\{\s*public <init>\(\);\s*\}/,
  );
});

// Ohne diese Regel läuft im Release kein einziger WorkManager-Worker, und die
// Homescreen-Widgets bleiben für immer auf ihrem initialLayout stehen: Glance
// komponiert in `androidx.glance.session.SessionWorker`. Die Consumer-Regel der
// Bibliothek hält nur den Klassennamen fest, nicht den Konstruktor.
test("keeps the InputMerger constructor that every WorkManager worker needs", () => {
  assert.match(
    rules,
    /-keepclassmembers class \* extends androidx\.work\.InputMerger\s*\{\s*<init>\(\);\s*\}/,
  );
});
