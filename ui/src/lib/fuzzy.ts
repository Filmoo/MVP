/** Loose, instant matching of short queries against names (champion search). Pure. */

/** Lower case, accents and punctuation dropped: "Kai'Sa" → "kaisa", "Nunu & Willump" → "nunuwillump". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function words(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every character of `query` appears in `text`, in order: fewer gaps score higher. */
function subsequence(query: string, text: string): number | null {
  let at = 0;
  let gaps = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, at);
    if (found < 0) return null;
    gaps += found - at;
    at = found + 1;
  }
  return gaps;
}

/**
 * How well `query` matches `name` (higher is better), `null` when it doesn't.
 * Exact > prefix > word prefix > initials ("mf" → Miss Fortune) > substring > loose subsequence.
 */
export function matchScore(query: string, name: string): number | null {
  const q = fold(query);
  if (!q) return null;
  const n = fold(name);
  if (n === q) return 1_000;
  if (n.startsWith(q)) return 900 - n.length;
  const parts = words(name);
  if (parts.slice(1).some((w) => w.startsWith(q))) return 800 - n.length;
  if (q.length >= 2 && parts.length > 1 && parts.map((w) => w[0]).join("") === q) return 750;
  const index = n.indexOf(q);
  if (index >= 0) return 600 - index;
  // Typos and skipped letters, only for queries long enough to mean something.
  if (q.length >= 3 && n[0] === q[0]) {
    const gaps = subsequence(q, n);
    if (gaps !== null && gaps <= q.length * 2) return 300 - gaps;
  }
  return null;
}

/** The best `limit` matches, best first; ties keep alphabetical order. */
export function bestMatches<T>(query: string, items: readonly T[], name: (item: T) => string, limit: number): T[] {
  const scored: Array<{ item: T; score: number; label: string }> = [];
  for (const item of items) {
    const label = name(item);
    const score = matchScore(query, label);
    if (score !== null) scored.push({ item, score, label });
  }
  scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return scored.slice(0, limit).map((s) => s.item);
}
