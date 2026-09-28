/**
 * The Settings page's search: which settings a query finds, and where in their words. Pure.
 *
 * Every word of the query must be found in a setting or in its card's title, folded like the
 * title bar's champion search (`lib/fuzzy`: case, accents and punctuation don't matter):
 * - best, as typed at the start of a word (running over the next ones too: "autoaccept"), or as
 *   its singular ("runes" finds "Rune page");
 * - only when that word is found nowhere so: as typed inside a word (3 letters or more), with
 *   letters left out (the title bar's matcher), or with a typo, a wrong, missing, extra or
 *   swapped letter (two from 8 letters; the first letter is right).
 * Words of one or two letters ("on", "à", "d") only count when nothing longer is typed. Besides
 * what the page shows, a setting is found by what players call it (`settings.search.keywords`,
 * in each language) and by its control's labels ("Emerald+", "Light", "Open log folder").
 */
import type { Marks } from "../../design/Marked";
import type { Messages } from "../../i18n";
import { fold, matchScore } from "../../lib/fuzzy";

/** Everything the search finds: cards, their settings, About's sections. */
export type SearchId =
  | "automation"
  | "autoAccept"
  | "delay"
  | "bringToFront"
  | "autoSwitch"
  | "imports"
  | "runes"
  | "itemSet"
  | "spells"
  | "flashKey"
  | "stats"
  | "bracket"
  | "app"
  | "language"
  | "closeToTray"
  | "launchAtStartup"
  | "crashReports"
  | "reportId"
  | "effects"
  | "about"
  | "updates"
  | "data"
  | "help"
  | "legal";

export interface Entry {
  id: SearchId;
  /** On screen, marked where the query is found. */
  title: string;
  text?: string | undefined;
  /** Not on screen: what players call it, its control's labels. */
  also?: string | undefined;
}

/** A card: found whole by its own words, or for some of its groups (a setting, then the ones nested under it). */
export interface SearchCard extends Entry {
  groups: Entry[][];
}

/** What a query shows: every card, setting and section it keeps, with what to mark in each. */
export type Found = Map<SearchId, { title: Marks; text: Marks }>;

/** The Settings page as the search reads it, in `w`'s words; `flash`: Flash's name in the game's language. */
export function settingsIndex(w: Messages, flash: string): SearchCard[] {
  const { automation: a, imports: i, stats: s, app: p, about: b, search } = w.settings;
  const keywords: Partial<Record<SearchId, string>> = search.keywords;
  /** A setting or section: its words on screen, then what players call it and its control's labels. */
  const row = (id: SearchId, words: { title: string; text?: string }, ...labels: string[]): Entry => ({
    id,
    title: words.title,
    text: words.text,
    also: [keywords[id], ...labels].join(", "),
  });
  return [
    {
      id: "automation",
      title: a.title,
      groups: [
        [row("autoAccept", a.autoAccept), row("delay", { title: a.delay })],
        [row("bringToFront", a.bringToFront)],
        [row("autoSwitch", a.autoSwitch)],
      ],
    },
    {
      id: "imports",
      title: i.title,
      also: Object.values(i.modes).join(", "),
      groups: [
        [row("runes", i.runes)],
        [row("itemSet", i.itemSet)],
        [row("spells", i.spells), row("flashKey", { title: i.flashKey.title(flash), text: i.flashKey.text(flash) })],
      ],
    },
    { id: "stats", title: s.title, groups: [[row("bracket", { title: s.bracket, text: s.bracketText }, ...Object.values(w.brackets))]] },
    {
      id: "app",
      title: p.title,
      groups: [
        [row("language", p.language)],
        [row("closeToTray", p.closeToTray)],
        [row("launchAtStartup", p.launchAtStartup)],
        [row("crashReports", p.crashReports), row("reportId", p.reportId)],
        [row("effects", p.effects, ...Object.values(p.effects.levels))],
      ],
    },
    {
      id: "about",
      title: b.title,
      groups: [
        [row("updates", { title: b.updates }, w.updates.check)],
        [row("data", { title: b.dataTitle, text: b.data })],
        [row("help", { title: b.helpTitle, text: b.help }, b.copy, b.openLogs)],
        [row("legal", { title: b.legalTitle, text: b.legal })],
      ],
    },
  ];
}

/** A text as the search reads it: its letters and digits folded, where each came from, where words start. */
interface Folded {
  f: string;
  at: number[];
  starts: number[];
}

/** Texts change with the language only: each is folded once. */
const foldedTexts = new Map<string, Folded>();

function folded(text: string): Folded {
  let done = foldedTexts.get(text);
  if (!done) {
    done = { f: "", at: [], starts: [] };
    for (const word of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
      done.starts.push(done.f.length);
      for (let i = 0; i < word[0].length; i++) {
        for (const letter of fold(word[0].charAt(i))) {
          done.f += letter;
          done.at.push(word.index + i);
        }
      }
    }
    foldedTexts.set(text, done);
  }
  return done;
}

/**
 * How much of the start of `t` spells `q` with at most one typo (two from 8 letters): a wrong,
 * missing, extra or swapped letter, never the first one. 0 when it doesn't.
 */
function near(q: string, t: string): number {
  const most = q.length > 7 ? 2 : q.length > 3 ? 1 : 0;
  if (!most || q[0] !== t[0]) return 0;
  // Optimal string alignment: row[j] is the distance from q's first i letters to t's first j.
  let older: number[] = [];
  let row = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= q.length; i++) {
    const next = [i];
    for (let j = 1; j <= t.length; j++) {
      const swap = q[i - 1] === t[j - 2] && q[i - 2] === t[j - 1] ? (older[j - 2] as number) + 1 : Number.POSITIVE_INFINITY;
      next[j] = Math.min(
        (row[j] as number) + 1,
        (next[j - 1] as number) + 1,
        (row[j - 1] as number) + (q[i - 1] === t[j - 1] ? 0 : 1),
        swap,
      );
    }
    older = row;
    row = next;
  }
  let best = 0;
  row.forEach((d, j) => {
    if (d < (row[best] as number)) best = j;
  });
  return (row[best] as number) <= most ? best : 0;
}

/**
 * How well `q` (folded) is found in `text`: 2 as typed at a word's start, 1 inside a word or with
 * a typo, 0 not at all; and where.
 */
type Hit = [level: number, marks: Array<[number, number]>];

function locate(q: string, text = ""): Hit {
  const { f, at, starts } = folded(text);
  const hit: Hit = [0, []];
  const found = (level: number, from: number, to: number) => {
    if (level > hit[0]) {
      hit[0] = level;
      hit[1] = [];
    }
    if (level === hit[0]) hit[1].push([at[from] as number, (at[to - 1] as number) + 1]);
  };
  const singular = q.length > 3 && q.endsWith("s") ? q.slice(0, -1) : q;
  starts.forEach((start, n) => {
    const typed = f.startsWith(q, start) ? q : f.startsWith(singular, start) ? singular : "";
    if (typed) found(2, start, start + typed.length);
    else if (q.length > 2 && hit[0] < 2) {
      const word = f.slice(start, starts[n + 1]);
      const typo = near(q, f.slice(start, start + q.length + 2)) || (matchScore(q, word) === null ? 0 : word.length);
      if (typo) found(1, start, start + typo);
    }
  });
  if (q.length > 2 && hit[0] < 2) for (let i = f.indexOf(q); i >= 0; i = f.indexOf(q, i + 1)) found(1, i, i + q.length);
  return hit;
}

/** In order, overlaps joined. */
function joined(marks: Array<[number, number]>): Marks {
  const out: Array<[number, number]> = [];
  for (const [from, to] of marks.sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** What `query` finds on the page `cards` describe; `null` while there's nothing to look for. */
export function findSettings(query: string, cards: readonly SearchCard[]): Found | null {
  const words = query
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .map(fold)
    .filter(Boolean);
  const long = words.filter((w) => w.length > 2);
  const terms = long.length ? long : words;
  if (!terms.length) return null;
  // Every word in every text; each word counts at the best level it reaches anywhere.
  const best = terms.map(() => 0);
  const hits = new Map<Entry, Hit[][]>();
  for (const entry of cards.flatMap((card) => [card, ...card.groups.flat()])) {
    const each = terms.map((q, j) =>
      [entry.title, entry.text, entry.also].map((text) => {
        const hit = locate(q, text);
        best[j] = Math.max(best[j] as number, hit[0]);
        return hit;
      }),
    );
    hits.set(entry, each);
  }
  const at = (entry: Entry, j: number) => (hits.get(entry) as Hit[][])[j] as Hit[];
  const has = (entry: Entry, j: number) => at(entry, j).some(([level]) => level > 0 && level === best[j]);
  const marks = (entry: Entry, text: number) =>
    joined(
      terms.flatMap((_, j) => {
        const [level, where] = at(entry, j)[text] as Hit;
        return level > 0 && level === best[j] ? where : [];
      }),
    );
  const found: Found = new Map();
  const show = (entry: Entry) => found.set(entry.id, { title: marks(entry, 0), text: marks(entry, 1) });
  for (const card of cards) {
    const whole = terms.every((_, j) => has(card, j));
    const groups = card.groups.filter((group) => whole || group.some((row) => terms.every((_, j) => has(row, j) || has(card, j))));
    if (groups.length) {
      show(card);
      groups.flat().forEach(show);
    }
  }
  return found;
}
