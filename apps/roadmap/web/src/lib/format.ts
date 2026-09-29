/** Dates and times as the owner reads them (English, day month). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-28` or an RFC 3339 time → "28 Sep" (with the year when it isn't `year`). */
export function day(value: string, year = new Date().getUTCFullYear()): string {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  const text = `${d} ${MONTHS[m - 1] ?? ""}`;
  return y === year ? text : `${text} ${y}`;
}

/** How long ago, in words: "just now", "5 min ago", "3 h ago", "yesterday", then a date. */
export function ago(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return day(iso, new Date(now).getUTCFullYear());
}

/** A plural in words: `count(3, "feature")` → "3 features". */
export function count(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}
