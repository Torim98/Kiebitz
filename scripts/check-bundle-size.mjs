/**
 * Enforces budgets for the assets required before Kiebitz can render.
 * Besides the shell, the default dashboard route is budgeted: it is lazy in
 * the manifest but required for the first useful screen. Optional pages and
 * locales stay outside that startup budget; every JS chunk is still capped.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = join(process.cwd(), "dist");
const assets = join(dist, "assets");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error("Vite manifest contains no entry module");
const dashboard = Object.entries(manifest).find(([key]) =>
  key.replaceAll("\\", "/").endsWith("src/pages/Dashboard.tsx")
)?.[1];
if (!dashboard) throw new Error("Vite manifest contains no Dashboard module");

const limits = {
  initialJs: 440 * 1024,
  initialGzip: 150 * 1024,
  startupRouteJs: 900 * 1024,
  startupRouteGzip: 275 * 1024,
  singleJs: 450 * 1024,
  // Sieben Farbwelten kosten rund 6 KiB CSS (src/themes.css) · das ist der
  // Preis dafür, dass der Themenwechsel ein Attributwechsel bleibt und kein
  // Nachladen. Der Wert unten ist die alte Grenze plus diesen Block.
  css: 68 * 1024,
  fonts: 140 * 1024,
};

function collectDependencies(item, files) {
  if (!item || files.has(item.file)) return;
  files.add(item.file);
  for (const imported of item.imports ?? []) collectDependencies(manifest[imported], files);
}
const initialFiles = new Set();
collectDependencies(entry, initialFiles);
const startupRouteFiles = new Set(initialFiles);
collectDependencies(dashboard, startupRouteFiles);

const bytes = (file) => statSync(join(dist, file)).size;
const gzipBytes = (file) => gzipSync(readFileSync(join(dist, file))).length;
const initialJs = [...initialFiles].filter((file) => file.endsWith(".js"));
const initialSize = initialJs.reduce((sum, file) => sum + bytes(file), 0);
const initialGzip = initialJs.reduce((sum, file) => sum + gzipBytes(file), 0);
const startupRouteJs = [...startupRouteFiles].filter((file) => file.endsWith(".js"));
const startupRouteSize = startupRouteJs.reduce((sum, file) => sum + bytes(file), 0);
const startupRouteGzip = startupRouteJs.reduce((sum, file) => sum + gzipBytes(file), 0);
const jsFiles = readdirSync(assets).filter((file) => file.endsWith(".js"));
const cssFiles = readdirSync(assets).filter((file) => file.endsWith(".css"));
const fontFiles = readdirSync(assets).filter((file) => file.endsWith(".woff2"));
const fontSize = fontFiles.reduce((sum, file) => sum + bytes(`assets/${file}`), 0);
const largestJs = jsFiles
  .map((file) => ({ file, size: bytes(`assets/${file}`) }))
  .sort((a, b) => b.size - a.size)[0];
const largestCss = cssFiles
  .map((file) => ({ file, size: bytes(`assets/${file}`) }))
  .sort((a, b) => b.size - a.size)[0];

const kb = (value) => `${(value / 1024).toFixed(1)} KiB`;
const failures = [];
if (initialSize > limits.initialJs) failures.push(`initial JS ${kb(initialSize)} > ${kb(limits.initialJs)}`);
if (initialGzip > limits.initialGzip) failures.push(`initial gzip ${kb(initialGzip)} > ${kb(limits.initialGzip)}`);
if (startupRouteSize > limits.startupRouteJs) failures.push(`startup route JS ${kb(startupRouteSize)} > ${kb(limits.startupRouteJs)}`);
if (startupRouteGzip > limits.startupRouteGzip) failures.push(`startup route gzip ${kb(startupRouteGzip)} > ${kb(limits.startupRouteGzip)}`);
if (largestJs?.size > limits.singleJs) failures.push(`${largestJs.file} ${kb(largestJs.size)} > ${kb(limits.singleJs)}`);
if (largestCss?.size > limits.css) failures.push(`${largestCss.file} ${kb(largestCss.size)} > ${kb(limits.css)}`);
if (fontSize > limits.fonts) failures.push(`fonts ${kb(fontSize)} > ${kb(limits.fonts)}`);

console.log(`Initial JS: ${kb(initialSize)} raw / ${kb(initialGzip)} gzip across ${initialJs.length} chunks`);
console.log(`Startup route JS: ${kb(startupRouteSize)} raw / ${kb(startupRouteGzip)} gzip across ${startupRouteJs.length} chunks`);
console.log(`Largest JS chunk: ${largestJs.file} (${kb(largestJs.size)})`);
console.log(`CSS: ${largestCss.file} (${kb(largestCss.size)})`);
console.log(`Fonts: ${kb(fontSize)} across ${fontFiles.length} files`);
if (failures.length) {
  console.error(`Bundle budget exceeded:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Bundle budget is within limits.");
