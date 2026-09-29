/**
 * `game_description` for the browser mock: the core's reading of Riot's text
 * (`crates/static-data/src/descriptions.rs`, same cases in `fixtures/rich-text-cases.json`),
 * from the local dev cache (`scripts/fetch-dev-assets.mjs`: Data Dragon's files and, for the stat
 * shards, the client's `perks.json` from CommunityDragon). English, like the mock's names.
 */
import type { Description } from "../generated/Description";
import type { DescriptionKind } from "../generated/DescriptionKind";
import type { TextSpan } from "../generated/TextSpan";
import type { TextTone } from "../generated/TextTone";
import { DEV_ASSET_BASE } from "./game-data";

/** The client's tags that stress or colour their text. */
const TONES: Record<string, TextTone> = {
  attention: "strong",
  b: "strong",
  strong: "strong",
  passive: "strong",
  active: "strong",
  unique: "strong",
  keywordmajor: "strong",
  spellname: "strong",
  spellactive: "strong",
  spellpassive: "strong",
  raritygeneric: "strong",
  raritylegendary: "strong",
  raritymythic: "strong",
  ornnbonus: "strong",
  jadeunique: "strong",
  buffedstat: "strong",
  titleleft: "strong",
  rules: "subtle",
  i: "subtle",
  em: "subtle",
  flavortext: "subtle",
  jaderules: "subtle",
  titleright: "subtle",
  physicaldamage: "physical",
  magicdamage: "magic",
  truedamage: "true",
  healing: "heal",
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return ENTITIES[code] ?? entity;
    const value = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
}

/** Riot's markup to lines of text spans (an empty line between paragraphs), as the core does it. */
export function richText(markup: string): TextSpan[][] {
  const done: TextSpan[][] = [];
  let line: TextSpan[] = [];
  let breaks = 0;
  let bullet = false;
  const open: Array<[string, TextTone]> = [];
  const push = (text: string, tone: TextTone | undefined) => {
    const last = line.at(-1);
    if (last && last.tone === tone) last.text += text;
    else line.push(tone ? { text, tone } : { text });
  };
  const endLine = () => {
    while (line.length) {
      const last = line.at(-1) as TextSpan;
      last.text = last.text.trimEnd();
      if (last.text) break;
      line.pop();
    }
    if (line.length) done.push(line);
    line = [];
  };
  const text = (raw: string) => {
    const collapsed = decode(raw).replace(/[ \t\n\r\f]+/g, " ");
    if (!collapsed.trim() && (breaks > 0 || !line.length)) return;
    if (breaks > 0) {
      if (line.length || done.length) {
        endLine();
        if (breaks > 1) done.push([]);
      }
      breaks = 0;
    }
    if (bullet) {
      bullet = false;
      push("• ", undefined);
    }
    const last = line.at(-1);
    const t = !last || last.text.endsWith(" ") ? collapsed.trimStart() : collapsed;
    if (t) push(t, open.at(-1)?.[1]);
  };
  let rest = markup;
  for (let at = rest.indexOf("<"); at >= 0; at = rest.indexOf("<")) {
    text(rest.slice(0, at));
    const inside = rest.slice(at + 1);
    const tag = /^(\/?)([a-z][a-z0-9_-]*)/i.exec(inside);
    const end = inside.indexOf(">");
    if (!tag || end < 0) {
      text("<");
      rest = inside;
      continue;
    }
    const closing = tag[1] === "/";
    const name = (tag[2] ?? "").toLowerCase();
    if (name === "br") breaks++;
    else if (name === "hr") breaks = Math.max(breaks, 2);
    else if (name === "li" && !closing) {
      breaks = Math.max(breaks, 1);
      bullet = true;
    } else if (closing) {
      const index = open.map(([n]) => n).lastIndexOf(name);
      if (index >= 0) open.splice(index, 1);
    } else {
      const tone = TONES[name];
      if (tone && !inside.slice(0, end).endsWith("/")) open.push([name, tone]);
    }
    rest = inside.slice(end + 1);
  }
  text(rest);
  endLine();
  while (done.at(-1)?.length === 0) done.pop();
  return done;
}

/** `@name@`: a value the client fills in while playing. */
export const hasPlaceholder = (text: string) => /@[\w.:*]+@/.test(text);

/** The first text that shows something as it is (see the core's `first_shown`). */
const firstShown = (...texts: string[]) => texts.find((text) => !hasPlaceholder(text) && richText(text).length > 0) ?? "";

const described = (text: TextSpan[][], cooldown?: number): Description | null =>
  text.length || cooldown ? { ...(cooldown ? { cooldown } : {}), text } : null;

interface DevFiles {
  items: Record<string, { description?: string; plaintext?: string }>;
  spells: Record<string, { key: string; description?: string; cooldownBurn?: string }>;
  runes: Array<{ slots: Array<{ runes: Array<{ id: number; shortDesc?: string; longDesc?: string }> }> }>;
  perks: Array<{ id: number; name?: string; shortDesc?: string; longDesc?: string }>;
}

let files: Promise<DevFiles> | undefined;

async function json<T>(path: string, fallback: T): Promise<T> {
  const res = await fetch(`${DEV_ASSET_BASE}/${path}`).catch(() => undefined);
  // A file missing from the dev cache can come back as the preview's own page (200, HTML): it
  // counts as missing, so one absent file doesn't break every description.
  return res?.ok ? ((await res.json().catch(() => fallback)) as T) : fallback;
}

const devFiles = () =>
  (files ??= Promise.all([
    json<{ data: DevFiles["items"] }>("data/en_US/item.json", { data: {} }),
    json<{ data: DevFiles["spells"] }>("data/en_US/summoner.json", { data: {} }),
    json<DevFiles["runes"]>("data/en_US/runesReforged.json", []),
    json<DevFiles["perks"]>("cdragon/perks.json", []),
  ]).then(([items, spells, runes, perks]) => ({ items: items.data, spells: spells.data, runes, perks })));

/** What the core would answer from the same files; `null` when the dev cache doesn't have it. */
export async function devDescription(kind: DescriptionKind, id: number): Promise<Description | null> {
  const { items, spells, runes, perks } = await devFiles();
  if (kind === "item") {
    const item = items[String(id)];
    return item ? described(richText(firstShown(item.description ?? "", item.plaintext ?? ""))) : null;
  }
  if (kind === "spell") {
    const spell = Object.values(spells).find((s) => Number(s.key) === id);
    const seconds = Number.parseFloat(spell?.cooldownBurn?.split("/")[0] ?? "");
    return spell ? described(richText(firstShown(spell.description ?? "")), seconds >= 1 ? Math.round(seconds) : undefined) : null;
  }
  if (kind === "rune") {
    const rune = runes.flatMap((tree) => tree.slots.flatMap((row) => row.runes)).find((r) => r.id === id);
    return rune ? described(richText(firstShown(rune.longDesc ?? "", rune.shortDesc ?? ""))) : null;
  }
  const shard = perks.find((p) => p.id === id && p.id >= 5000 && p.id < 6000 && p.name?.trim());
  return shard ? { name: shard.name ?? "", text: stressValue(richText(firstShown(shard.longDesc ?? "", shard.shortDesc ?? ""))) } : null;
}

/** A stat shard's leading value (`+9`, `+2.5%`, `+10 - 180`) stressed, like the core's `stress_value`. */
export function stressValue(lines: TextSpan[][]): TextSpan[][] {
  const first = lines[0]?.[0];
  const value = first && !first.tone ? /^\+[\d.,%]+(?:\s*[-–]\s*[\d.,%]+)?/.exec(first.text)?.[0] : undefined;
  if (!first || !value || value === first.text) return lines;
  lines[0]?.splice(0, 1, { text: value, tone: "strong" }, { text: first.text.slice(value.length) });
  return lines;
}
