import type { JSX } from "solid-js";
import { LineIcon } from "./Icon";

/**
 * More line icons of the Icon family (same grid, same stroke), for small things the stats pages
 * say with a picture: what a number is, a queue, a rank bracket, a trend. They load with the
 * views that use them, not with the first screen.
 */
const glyphs = {
  // Every lane at once: the whole map, mid across.
  roleAll: "M4 4h16v16H4zM8.5 15.5l7-7",
  // Stats (tier list, champion pages): what a number is, drawn small next to it.
  /** Win rate: a cup. */
  winRate: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v7M8 20h8",
  /** Pick rate: the logo's pointer, mid-click. */
  pick: "M9 9l10.5 4-4.5 2-2 4.5zM4 4l2 2M9 3v2.5M3 9h2.5",
  /** Ban rate. */
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  /** Games counted: a stack. */
  games: "M12 4 3 8.5l9 4.5 9-4.5zM3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5",
  /** A patch, as in a plaster. */
  patch:
    "M4.9 14.8 14.8 4.9a2.8 2.8 0 0 1 4 0l.3.3a2.8 2.8 0 0 1 0 4L9.2 19.1a2.8 2.8 0 0 1-4 0l-.3-.3a2.8 2.8 0 0 1 0-4zM9.5 12 12 9.5l2.5 2.5-2.5 2.5z",
  /** Ranked queues: a podium. */
  ranked: "M3 20v-5h6V9h6v4h6v7zM9 15v5M15 13v7",
  /** ARAM: the Howling Abyss' snow. */
  aram: "M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.8 4.8 12 7l2.2-2.2M9.8 19.2 12 17l2.2 2.2M6.7 6.4l.8 3-3 .8M17.3 17.6l-.8-3 3-.8M6.7 17.6l.8-3-3-.8M17.3 6.4l-.8 3 3 .8",
  /** A rank bracket (Emerald+…): a cut gem. */
  gem: "M6.5 4h11L21 9l-9 11L3 9zM3 9h18M9.5 4 8 9l4 11 4-11-1.5-5",
  trendUp: "M3 17l6-6 4 4 8-8M15 7h6v6",
  trendDown: "M3 7l6 6 4-4 8 8M15 17h6v-6",
  /** The logo's crown: the best of a list. */
  crown: "M4 18V8l4 3.5L12 5l4 6.5L20 8v10z",
  /** A tier list: a grade, then its row. */
  tierList: "M4 4.5h3.5V8H4zM10.5 6.25H20M4 10.25h3.5v3.5H4zM10.5 12H17M4 16h3.5v3.5H4zM10.5 17.75H14",
  /** MVP's manchot: its outline, and the logo's v as its white front. */
  penguin:
    "M12 3.2c1.9 0 3.3 1.5 3.3 3.4 0 .8-.2 1.5-.6 2.1 2.2 1.6 3.6 4.3 3.6 7.2 0 3.3-2.8 5.3-6.3 5.3s-6.3-2-6.3-5.3c0-2.9 1.4-5.6 3.6-7.2-.4-.6-.6-1.3-.6-2.1 0-1.9 1.4-3.4 3.3-3.4zM8.8 11.2l3.2 1.4 3.2-1.4c.6 3.2-.7 6.3-3.2 8-2.5-1.7-3.8-4.8-3.2-8zM6.2 12.6 4.6 16M17.8 12.6l1.6 3.4",
} as const;

export type GlyphName = keyof typeof glyphs;

/** A glyph's path, for controls that draw icons of both sets. */
export const glyphPath = (name: GlyphName): string => glyphs[name];

export function Glyph(props: {
  name: GlyphName;
  size?: 14 | 16 | 20 | 24 | undefined;
  class?: string | undefined;
  label?: string | undefined;
}): JSX.Element {
  return <LineIcon d={glyphs[props.name]} size={props.size} class={props.class} label={props.label} />;
}
