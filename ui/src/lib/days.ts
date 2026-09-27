/** Groups items by local calendar day, newest first, with human labels. */

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `Today`, `Yesterday`, a weekday within the week, else `12 Sep`. */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Intl.DateTimeFormat("en", { weekday: "long" }).format(ms);
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export interface DayGroup<T> {
  key: number;
  label: string;
  items: T[];
}

/** Consecutive runs of the same day, in input order (inputs are newest first). */
export function groupByDay<T>(items: readonly T[], at: (item: T) => number, now = Date.now()): Array<DayGroup<T>> {
  const groups: Array<DayGroup<T>> = [];
  for (const item of items) {
    const key = startOfDay(at(item));
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(at(item), now), items: [item] });
  }
  return groups;
}
