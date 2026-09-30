import type { JSX } from "solid-js";
import { LineIcon } from "./Icon";

/**
 * More line icons of the Icon family (same grid, same stroke), for small things the stats pages
 * say with a picture: what a number is, a queue, a view. They load with the views that use them,
 * not with the first screen.
 */
const glyphs = {
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
  /** ARAM: Mayhem: an augment's spark, and a smaller one. */
  mayhem: "M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9zM18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z",
  /** The logo's crown: the best of a list. */
  crown: "M4 18V8l4 3.5L12 5l4 6.5L20 8v10z",
  /** The meta map: strength against popularity, champions as dots. */
  map: "M4 4v16h16M8.5 14.5h.01M11.5 9.5h.01M15.5 12.5h.01M17 6.5h.01M11 16.5h.01",
  /** Shelves: rows of champions. */
  shelves: "M4 5h4v4H4zM10 5h4v4h-4zM16 5h4v4h-4zM4 15h4v4H4zM10 15h4v4h-4z",
  /** A table. */
  table: "M4 5h16v14H4zM4 10h16M4 14.5h16M9.5 5v14",
} as const;

export type GlyphName = keyof typeof glyphs;

export function Glyph(props: {
  name: GlyphName;
  size?: 14 | 16 | 20 | 24 | undefined;
  class?: string | undefined;
  label?: string | undefined;
}): JSX.Element {
  return <LineIcon d={glyphs[props.name]} size={props.size} class={props.class} label={props.label} />;
}
