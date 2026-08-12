/**
 * Enforces budgets for the assets required before Kiebitz can render.
 * Lazy pages, optional locales and other dynamic imports deliberately do not
 * count towards the initial budget, but every individual JS chunk is capped.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const dist = join(process.cwd(), "dist");
const assets = join(dist, "assets");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error("Vite manifest contains no entry module");

const limits = {
  initialJs: 650 * 1024,
  initialGzip: 210 * 1024,
  singleJs: 450 * 1024,
  css: 60 * 1024,
};

const initialFiles = new Set();
function collectInitial(item) {
  if (!item || initialFiles.has(item.file)) return;
  initialFiles.add(item.file);
  for (const imported of item.imports ?? []) collectInitial(manifest[imported]);
}
collectInitial(entry);

const bytes = (file) => statSync(join(dist, file)).size;
const gzipBytes = (file) => gzipSync(readFileSync(join(dist, file))).length;
const initialJs = [...initialFiles].filter((file) => file.endsWith(".js"));
const initialSize = initialJs.reduce((sum, file) => sum + bytes(file), 0);
const initialGzip = initialJs.reduce((sum, file) => sum + gzipBytes(file), 0);
const jsFiles = readdirSync(assets).filter((file) => file.endsWith(".js"));
const cssFiles = readdirSync(assets).filter((file) => file.endsWith(".css"));
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
if (largestJs?.size > limits.singleJs) failures.push(`${largestJs.file} ${kb(largestJs.size)} > ${kb(limits.singleJs)}`);
if (largestCss?.size > limits.css) failures.push(`${largestCss.file} ${kb(largestCss.size)} > ${kb(limits.css)}`);

console.log(`Initial JS: ${kb(initialSize)} raw / ${kb(initialGzip)} gzip across ${initialJs.length} chunks`);
console.log(`Largest JS chunk: ${largestJs.file} (${kb(largestJs.size)})`);
console.log(`CSS: ${largestCss.file} (${kb(largestCss.size)})`);
if (failures.length) {
  console.error(`Bundle budget exceeded:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Bundle budget is within limits.");
