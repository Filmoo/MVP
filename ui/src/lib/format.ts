/** Pure formatting helpers. Everything user-visible and numeric goes through here. */

export function kdaRatio(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return kills + assists === 0 ? "0.00" : "Perfect";
  return ((kills + assists) / deaths).toFixed(2);
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function winRate(wins: number, losses: number): number | null {
  const games = wins + losses;
  return games === 0 ? null : wins / games;
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function perMinute(value: number, seconds: number): string {
  return seconds > 0 ? (value / (seconds / 60)).toFixed(1) : "0.0";
}

const UNITS: Array<[limitSeconds: number, divisor: number, unit: string]> = [
  [60, 1, "s"],
  [3_600, 60, "m"],
  [86_400, 3_600, "h"],
  [604_800, 86_400, "d"],
  [2_629_800, 604_800, "w"],
  [31_557_600, 2_629_800, "mo"],
];

/** Compact relative time: `5m ago`, `3h ago`, `2d ago`. */
export function timeAgo(epochMs: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - epochMs) / 1_000);
  if (seconds < 45) return "just now";
  for (const [limit, divisor, unit] of UNITS) {
    if (seconds < limit) return `${Math.floor(seconds / divisor)}${unit} ago`;
  }
  return `${Math.floor(seconds / 31_557_600)}y ago`;
}

const QUEUES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  480: "Swiftplay",
  490: "Quickplay",
  700: "Clash",
  900: "ARURF",
  1700: "Arena",
  1900: "URF",
};

export function queueName(queueId: number): string {
  return QUEUES[queueId] ?? "Custom";
}

/** Games shorter than this are remakes and are excluded from stats. */
export const REMAKE_MAX_SECONDS = 300;

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
