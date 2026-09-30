/** Fuzzy matching for the command palette: letters in order, word starts and runs score higher. */
import { fold } from "./filters";

export interface Match {
  score: number;
  /** Indices of the matched characters in the text, for highlighting. */
  hits: number[];
}

/** `null` when the query's letters aren't all in the text, in order. */
export function fuzzy(query: string, text: string): Match | null {
  const phrase = fold(query).trim().replace(/\s+/g, " ");
  if (!phrase) return { score: 0, hits: [] };
  const t = fold(text);
  // The words as typed win outright, earlier and at a word start better.
  const at = t.indexOf(phrase);
  if (at >= 0) {
    const start = at === 0 || /[\s\-–—:“"(/]/.test(t[at - 1] ?? "");
    return { score: 1000 - at + (start ? 200 : 0) - t.length / 100, hits: [...Array(phrase.length).keys()].map((i) => i + at) };
  }
  const q = phrase.replace(/ /g, "");
  const hits: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index < 0) return null;
    const previous = hits[hits.length - 1];
    if (previous !== undefined && index === previous + 1) score += 6;
    if (index === 0 || /[\s\-–—:“"(/]/.test(t[index - 1] ?? "")) score += 8;
    score -= Math.min(index - from, 12) * 0.5;
    hits.push(index);
    from = index + 1;
  }
  return { score: score - t.length / 100, hits };
}

/** The best `limit` items for a query, best first (all of them, in order, without a query). */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 8): { item: T; match: Match }[] {
  const scored: { item: T; match: Match }[] = [];
  for (const item of items) {
    const match = fuzzy(query, text(item));
    if (match) scored.push({ item, match });
  }
  if (query.trim()) scored.sort((a, b) => b.match.score - a.match.score);
  return scored.slice(0, limit);
}
