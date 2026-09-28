#!/usr/bin/env node
// A contact sheet of the design pre-shoot: each direction at 1280 and 420 px side by side, then
// the role rail's states, the penguin's places and the icon lab. Reads reports/design/*.png
// (design-shots.mjs), writes reports/design/00-overview.png.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const DIR = resolve(import.meta.dirname, "../../reports/design");
const img = (name, width) =>
  existsSync(`${DIR}/${name}.png`) ? `<img src="${pathToFileURL(`${DIR}/${name}.png`).href}" style="width:${width}px">` : "";

const ROWS = [
  ["A — Shelves", ["A-shelves-1280x800", 760], ["A-shelves-peek-1280x800", 760], ["A-shelves-420x800", 250]],
  ["B — Ledger", ["B-ledger-1280x800", 760], ["B-ledger-scrolled-1280x800", 760], ["B-ledger-420x800", 250]],
  ["C — Meta map", ["C-map-1280x800", 760], ["C-map-lit-1280x800", 760], ["C-map-420x800", 250]],
  ["Role rail — rest · open under the pointer · keyboard", ["R-rail-rest-x2", 590], ["R-rail-hover-x2", 590], ["R-rail-keyboard-x2", 590]],
  [
    "Penguin — first start · nothing published · About",
    ["P-home-waiting-1280x800", 760],
    ["P-stats-empty-1280x800", 760],
    ["P-about-x2", 400],
  ],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 40px; background: #0d0e15; color: #eef0fa; font: 600 22px Inter, "Segoe UI", sans-serif; }
  h2 { margin: 36px 0 14px; font-size: 22px; letter-spacing: .02em; color: #b9a9ff; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  img { border-radius: 10px; box-shadow: 0 0 0 1px #2a2d42; }
</style></head><body>
${ROWS.map(([title, ...shots]) => `<h2>${title}</h2><div class="row">${shots.map(([n, w]) => img(n, w)).join("")}</div>`).join("\n")}
</body></html>`;

const page = `${DIR}/00-overview.html`;
await writeFile(page, html);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 2420, height: 1000 } });
await tab.goto(pathToFileURL(page).href);
await tab.waitForLoadState("load");
await tab.screenshot({ path: `${DIR}/00-overview.png`, fullPage: true });
await browser.close();
console.log(`${DIR}/00-overview.png`);
