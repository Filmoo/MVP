#!/usr/bin/env node
// A contact sheet of the tier list hub: before and after at 1280, 420 and 2560 px, then its states,
// the penguin's places and the icon lab. Reads reports/design/*.png (design-shots.mjs), writes
// reports/design/00-before-after.png.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const DIR = resolve(import.meta.dirname, "../../reports/design");
const img = (name, width) =>
  existsSync(`${DIR}/${name}.png`) ? `<img src="${pathToFileURL(`${DIR}/${name}.png`).href}" style="width:${width}px">` : "";

const ROWS = [
  [
    "1280 px — before · shelves · table",
    ["before-tier-list-1280x800", 760],
    ["after-shelves-1280x800", 760],
    ["after-table-1280x800", 760],
  ],
  [
    "420 px — before · shelves (whole page) · table",
    ["before-tier-list-420x800", 300],
    ["after-shelves-420x800", 300],
    ["after-table-420x800", 300],
  ],
  [
    "2560 px — before · shelves · table",
    ["before-tier-list-2560x1440", 760],
    ["after-shelves-2560x1440", 760],
    ["after-table-2560x1440", 760],
  ],
  [
    "Every lane · hover card · lane tooltip",
    ["after-shelves-all-1280x800", 760],
    ["state-peek-1280x800", 760],
    ["state-lane-tip-1280x800", 760],
  ],
  ["Rank menu · filter · French", ["state-rank-menu-1280x800", 760], ["state-filter-1280x800", 760], ["state-french-1280x800", 760]],
  ["Meta map — one lane · every lane · 420 px", ["state-map-1280x800", 760], ["state-map-all-1280x800", 760], ["state-map-420x800", 300]],
  [
    "No stats · nothing published · first patch (no trends)",
    ["state-offline-1280x800", 760],
    ["state-empty-1280x800", 760],
    ["state-no-trends-1280x800", 760],
  ],
  [
    "ARAM · a champion's build · waiting for League",
    ["after-table-aram-1280x800", 760],
    ["state-champion-1280x800", 760],
    ["P-home-waiting-1280x800", 760],
  ],
  ["About · the lab (glyphs, lanes, medallions, penguin)", ["P-about-x2", 400], ["L-design-lab-x2", 1100]],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 40px; background: #0d0e15; color: #eef0fa; font: 600 22px Inter, "Segoe UI", sans-serif; }
  h2 { margin: 36px 0 14px; font-size: 22px; letter-spacing: .02em; color: #b9a9ff; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  img { border-radius: 10px; box-shadow: 0 0 0 1px #2a2d42; }
</style></head><body>
${ROWS.map(([title, ...shots]) => `<h2>${title}</h2><div class="row">${shots.map(([n, w]) => img(n, w)).join("")}</div>`).join("\n")}
</body></html>`;

const page = `${DIR}/00-before-after.html`;
await writeFile(page, html);
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 2420, height: 1000 } });
await tab.goto(pathToFileURL(page).href);
await tab.waitForLoadState("load");
await tab.screenshot({ path: `${DIR}/00-before-after.png`, fullPage: true });
await browser.close();
console.log(`${DIR}/00-before-after.png`);
