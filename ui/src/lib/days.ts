/** Groups items by local calendar day, newest first, with human labels. */
import { t } from "../i18n";

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `Today`, `Yesterday`, a weekday within the week, else `12 Sep` (French `Aujourd’hui`, `12 sept.`). */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return t().days.today;
  if (days === 1) return t().days.yesterday;
  if (days < 7) return t().days.weekday(new Date(ms));
  return t().days.date(new Date(ms));
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
