import type { JSX } from "solid-js";

/**
 * Line icons (24×24 grid, 1.75 stroke): one visual family. These ship with the first screen;
 * `Glyph` (design/Glyph.tsx) holds more of the same family that load with the views using them.
 */
const paths = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  draft: "M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2",
  live: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  champions: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  // A tier list: a grade, then its row.
  tiers: "M4 4.5h3.5V8H4zM10.5 6.25H20M4 10.25h3.5v3.5H4zM10.5 12H17M4 16h3.5v3.5H4zM10.5 17.75H14",
  settings: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  minimize: "M5 12h14",
  maximize: "M5 5h14v14H5z",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  hidden:
    "M9.9 4.2A10.4 10.4 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.2 3.3M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20",
  enter: "M20 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  import: "M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-5M12 8h.01",
  download: "M12 4v11M7 10.5l5 5 5-5M5 20h14",
  back: "M15 5l-7 7 7 7",
  chevronDown: "M6 9l6 6 6-6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
} as const;

export type IconName = keyof typeof paths;

interface LineProps {
  size?: 14 | 16 | 20 | 24 | undefined;
  class?: string | undefined;
  label?: string | undefined;
}

/** A line icon of this family from its path (`Icon` and `Glyph` draw through it). */
export function LineIcon(props: LineProps & { d: string }): JSX.Element {
  const size = () => props.size ?? 20;
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
      data-free-style
    >
      <path d={props.d} />
    </svg>
  );
}

export function Icon(props: LineProps & { name: IconName }): JSX.Element {
  return <LineIcon d={paths[props.name]} size={props.size} class={props.class} label={props.label} />;
}
