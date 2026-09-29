#!/usr/bin/env node
// Fails the build when the UI bundle outgrows its budget. The initial load
// (entry JS + CSS) is what the user waits for when opening the window.
// Measures `dist`: the desktop build (`vite build --mode app`, no browser mock), what ships.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = {
  initialJsGzip: 46, // entry chunk(s) loaded before first paint
  initialCssGzip: 12,
  totalJsGzip: 136, // everything, including lazy views
  fontsKb: 150,
};

const dist = join(import.meta.dirname, "../dist");
const html = await readFile(join(dist, "index.html"), "utf8");
const initial = new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((m) => m[1]));

const assets = await readdir(join(dist, "assets"));
const sizes = { initialJsGzip: 0, initialCssGzip: 0, totalJsGzip: 0, fontsKb: 0 };
for (const name of assets) {
  const path = join(dist, "assets", name);
  const rel = `assets/${name}`;
  if (name.endsWith(".js") || name.endsWith(".css")) {
    const gz = gzipSync(await readFile(path)).length / 1024;
    if (name.endsWith(".js")) {
      sizes.totalJsGzip += gz;
      if (initial.has(rel)) sizes.initialJsGzip += gz;
    } else if (initial.has(rel)) {
      sizes.initialCssGzip += gz;
    }
  } else if (/\.(woff2?|ttf)$/.test(name)) {
    sizes.fontsKb += (await stat(path)).size / 1024;
  }
}

let failed = false;
for (const [key, budget] of Object.entries(BUDGET_KB)) {
  const value = sizes[key];
  const ok = value <= budget;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${key.padEnd(15)} ${value.toFixed(1).padStart(6)} KB / ${budget} KB`);
}
if (failed) {
  console.error("Bundle budget exceeded. Lazy-load the new code or raise the budget deliberately.");
  process.exit(1);
}
