import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Was in einem Widget-Layout stehen darf.
 *
 * Eine `previewLayout` wird nicht wie eine App-Ansicht aufgeblasen, sondern als
 * RemoteViews · und RemoteViews lässt nur eine feste Liste von Klassen zu.
 * `android.view.View` gehört nicht dazu, obwohl es in jedem anderen Layout die
 * naheliegende Wahl für eine Farbfläche ist. Der Fehler ist beim Bauen nicht zu
 * sehen: Das Layout übersetzt sauber, und erst im Auswahldialog des
 * Startbildschirms steht dann „Widget kann nicht geladen werden" · eine Stelle,
 * an der niemand einen Test hat und die man beim Entwickeln nie öffnet.
 *
 * Die Liste stammt aus der Dokumentation von RemoteViews (Stand API 36) und
 * enthält nur die Klassen, die Kiebitz auch wirklich braucht; wer eine weitere
 * hinzunimmt, gleicht sie dort ab.
 */
const ALLOWED = new Set([
  "FrameLayout",
  "LinearLayout",
  "RelativeLayout",
  "GridLayout",
  "ImageView",
  "TextView",
  "ProgressBar",
  "Button",
  "ImageButton",
  "Chronometer",
  "AnalogClock",
  "ViewFlipper",
  "ViewStub",
]);

const layoutDir = new URL(
  "../src-tauri/gen/android/app/src/main/res/layout/",
  import.meta.url,
);

/** Öffnende Tags ohne die Kommentare drumherum. */
function tagsIn(xml) {
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(/<([A-Za-z][A-Za-z0-9_.]*)/g)].map((m) => m[1]);
}

test("widget layouts only use views that RemoteViews can inflate", () => {
  const files = readdirSync(layoutDir).filter((name) => name.startsWith("widget_"));
  assert.ok(files.length > 0, "keine Widget-Layouts gefunden");

  for (const file of files) {
    const xml = readFileSync(new URL(file, layoutDir), "utf8");
    for (const tag of tagsIn(xml)) {
      assert.ok(
        ALLOWED.has(tag),
        `${file}: <${tag}> kann RemoteViews nicht aufblasen`,
      );
    }
  }
});
