#!/usr/bin/env node
// Downloads the Data Dragon files used by fixtures, screenshots and UI tests into
// .cache/ddragon/<version>/ (git-ignored). Riot assets are never committed or bundled:
// the shipped app downloads them at runtime.
//
// Source order: official Data Dragon CDN, then a public GitHub mirror (used when the
// CDN is unreachable, e.g. in restricted sandboxes). Idempotent: existing files are kept.
//
// Usage: node scripts/fetch-dev-assets.mjs [--all-icons]

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = (await readFile(join(root, "fixtures/ddragon-version.txt"), "utf8")).trim();
const out = join(root, ".cache/ddragon", version);
const allIcons = process.argv.includes("--all-icons");

const OFFICIAL = "https://ddragon.leagueoflegends.com/cdn";
const MIRROR = "https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master";

// Official path → mirror path (the mirror only keeps the latest version).
const sources = (path) => {
  const versioned =
    path.startsWith("data/") ||
    (path.startsWith("img/champion") && !path.startsWith("img/champion/centered")) ||
    path.startsWith("img/item") ||
    path.startsWith("img/spell") ||
    path.startsWith("img/profileicon");
  return versioned ? [`${OFFICIAL}/${version}/${path}`, `${MIRROR}/latest/${path}`] : [`${OFFICIAL}/${path}`, `${MIRROR}/${path}`];
};

let officialReachable = true;
let fetched = 0;
let skipped = 0;

async function download(path) {
  const dest = join(out, path);
  if (existsSync(dest)) {
    skipped++;
    return readFile(dest);
  }
  const urls = sources(path).filter((u) => officialReachable || !u.startsWith(OFFICIAL));
  let lastError;
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const body = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
      fetched++;
      return body;
    } catch (error) {
      lastError = error;
      if (url.startsWith(OFFICIAL)) officialReachable = false;
    }
  }
  throw new Error(`could not download ${path}: ${lastError?.message ?? lastError}`);
}

async function pool(items, size, fn) {
  const queue = [...items];
  const failures = [];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await fn(item).catch((e) => failures.push(e.message));
      }
    }),
  );
  return failures;
}

const json = async (path) => JSON.parse((await download(path)).toString("utf8"));

const champions = await json("data/en_US/champion.json");
const items = await json("data/en_US/item.json");
const runes = await json("data/en_US/runesReforged.json");
const spells = await json("data/en_US/summoner.json");

const icons = new Set();
for (const c of Object.values(champions.data)) icons.add(`img/champion/${c.image.full}`);
for (const s of Object.values(spells.data)) icons.add(`img/spell/${s.image.full}`);
for (const style of runes) {
  icons.add(`img/${style.icon}`);
  for (const slot of style.slots) for (const rune of slot.runes) icons.add(`img/${rune.icon}`);
}
for (const [id, item] of Object.entries(items.data)) {
  if (allIcons || (item.gold?.purchasable && item.maps?.["11"])) icons.add(`img/item/${id}.png`);
}
// Champion art (version-less on the CDN) for champions the fixtures feature in heroes and on the
// tier list's podiums (every lane, Mid, Jungle, Support).
const ART = [
  ...["Ahri", "Aurora", "Orianna", "Lux", "Hwei", "Malphite", "Shen", "Ornn", "Jax", "KSante", "Garen", "Camille"],
  ...["Zed", "Katarina", "Locke", "XinZhao", "Poppy", "Varus", "MasterYi", "Senna", "MonkeyKing"],
];
for (const key of ART) icons.add(`img/champion/centered/${key}_0.jpg`);
// Profile icons referenced by fixtures.
for (const id of [29, 4568, 5205, 6311, 588, 1, 7]) icons.add(`img/profileicon/${id}.png`);

const failures = await pool([...icons], 12, download);
console.log(`ddragon ${version}: ${fetched} downloaded, ${skipped} cached, ${failures.length} failed → ${out}`);

/** An optional file of the client, as CommunityDragon mirrors it, into `cdragon/` (once). */
async function clientFile(url, name, without) {
  const dest = join(out, "cdragon", name);
  if (existsSync(dest)) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`${name} → ${dest}`);
  } catch (error) {
    console.log(`${name} not downloaded (${without}): ${error.message ?? error}`);
  }
}

// Stat shards' names and effects (not in Data Dragon): the client's perks for this patch, which
// the browser mock's tooltips read like the core does. Without it, the UI's own words.
const patch = version.split(".").slice(0, 2).join(".");
const PERKS = `https://raw.communitydragon.org/${patch}/plugins/rcp-be-lol-game-data/global/default/v1/perks.json`;
await clientFile(PERKS, "perks.json", "shard tooltips use the UI's words");
// League's position icons, which the core downloads at run time: the browser mock hands them to
// the UI like the core does. Without them, the UI's own drawings.
for (const role of ["top", "jungle", "middle", "bottom", "utility"]) {
  const svg = `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-${role}.svg`;
  await clientFile(svg, `position-${role}.svg`, "the lanes show MVP's drawings");
}
if (failures.length) {
  console.log(failures.slice(0, 10).join("\n"));
  process.exitCode = failures.length > icons.size * 0.05 ? 1 : 0;
}
