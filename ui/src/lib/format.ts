/**
 * Formatting helpers, in the current language (`Intl`: `54.6%` / `54,6 %`, `3,244` / `3 244`).
 * Everything user-visible and numeric goes through here.
 */
import { intlLocale, lang, t } from "../i18n";

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A cached `Intl.NumberFormat` of the current language. */
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

/** A number with exactly `digits` decimals: `8.0`, French `8,0`. */
export function decimal(value: number, digits = 1): string {
  return numberFormat({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** A whole number with its thousands grouped: `3,244`, French `3 244`. */
export function integer(value: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(Math.round(value));
}

/** KDA ratio, `null` for a perfect game (no deaths, some kills or assists). */
export function kda(kills: number, deaths: number, assists: number): number | null {
  if (deaths === 0) return kills + assists === 0 ? 0 : null;
  return (kills + assists) / deaths;
}

export function kdaRatio(kills: number, deaths: number, assists: number): string {
  const value = kda(kills, deaths, assists);
  return value === null ? t().format.perfect : decimal(value, 2);
}

/** A share (0.546) as a percentage: `55%` / `55 %`, or `54.6%` / `54,6 %` with a decimal. */
export function percent(value: number, digits = 0): string {
  return numberFormat({ style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** A percentage given out of 100 (54.6): `54.6%` / `54,6 %`. */
export function percentOf100(value: number, digits = 1): string {
  return percent(value / 100, digits);
}

export function winRate(wins: number, losses: number): number | null {
  const games = wins + losses;
  return games === 0 ? null : wins / games;
}

/** `29:02`, the same in both languages. */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function perMinute(value: number, seconds: number): string {
  return decimal(seconds > 0 ? value / (seconds / 60) : 0, 1);
}

const UNITS: Array<[limitSeconds: number, divisor: number, unit: Intl.RelativeTimeFormatUnit]> = [
  [60, 1, "second"],
  [3_600, 60, "minute"],
  [86_400, 3_600, "hour"],
  [604_800, 86_400, "day"],
  [2_629_800, 604_800, "week"],
  [31_557_600, 2_629_800, "month"],
];

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/**
 * `-3 hour` in the current language: compact in English (`3h ago`); in French short up to weeks
 * (`il y a 3 h`, `hier`), in words for months and years (`il y a 3 mois`, `l’an dernier`).
 */
function relative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  const french = lang() === "fr";
  const long = french && (unit === "month" || unit === "year");
  const key = `${intlLocale()}|${long}`;
  let format = relativeFormats.get(key);
  if (!format) {
    format = new Intl.RelativeTimeFormat(
      intlLocale(),
      french ? { style: long ? "long" : "short", numeric: "auto" } : { style: "narrow", numeric: "always" },
    );
    relativeFormats.set(key, format);
  }
  const text = format.format(value, unit);
  // Never split at a line end: `il y a 3 h` wraps as one (ICU leaves plain spaces, even before
  // `sem.`); `avant-hier` gets a non-breaking hyphen, which tabular figures don't widen either.
  return french ? text.replace(/ /g, "\u00A0").replace(/-/g, "\u2011") : text;
}

/** Compact relative time: `5m ago`, `3h ago`, `2d ago`; French `il y a 5 min`, `hier` (never split across lines). */
export function timeAgo(epochMs: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - epochMs) / 1_000);
  if (seconds < 45) return t().format.justNow;
  for (const [limit, divisor, unit] of UNITS) {
    if (seconds < limit) return relative(-Math.floor(seconds / divisor), unit);
  }
  return relative(-Math.floor(seconds / 31_557_600), "year");
}

export function queueName(queueId: number): string {
  const names: Partial<Record<number, string>> = t().queues;
  return names[queueId] ?? t().queues.custom;
}

/** Games shorter than this are remakes and are excluded from stats. */
export const REMAKE_MAX_SECONDS = 300;

/** `+3.1` / `−2.1` (true minus sign) for percentage-point deltas; French `+3,1`. */
export function signedPoints(points: number, digits = 1): string {
  const rounded = Number(points.toFixed(digits));
  if (rounded === 0) return decimal(0, digits);
  return `${rounded > 0 ? "+" : "−"}${decimal(Math.abs(rounded), digits)}`;
}

/** Game counts: `812`, `3,244`, `127K`, `1.9M` (a decimal only from a million up); French `3 244`, `127 k`. */
export function games(n: number): string {
  if (n < 10_000) return integer(n);
  return numberFormat({ notation: "compact" }).format(n);
}

/** "a", "a and b", "a, b and c" (French "a, b et c"). */
export function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${t().format.and} ${words.at(-1)}`;
}
