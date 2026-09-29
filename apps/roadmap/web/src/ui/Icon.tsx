import type { JSX } from "solid-js";

/** Line icons on a 24 grid with a 1.75 stroke, the app's family (ui/src/design/Icon.tsx). */
const paths = {
  board: "M4 4h5v16H4zM10.5 4h5v10h-5zM17 4h3v7h-3z",
  roadmap: "M3 12h18M6 12a2 2 0 1 0 0 .01M12 12a2 2 0 1 0 0 .01M18 12a2 2 0 1 0 0 .01M6 14v5M12 14v3M18 14v6",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  inbox: "M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1.5 2.5h5L16 13h5",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  comment: "M4 5h16v11H9l-5 4z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  logout: "M15 17l5-5-5-5M20 12H9M12 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  x: "M18 6 6 18M6 6l12 12",
  doc: "M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h6M9.5 16h6",
  commit: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 12h6M15 12h6",
  pull: "M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 21V9a4 4 0 0 0-4-4h-3M13 2l-3 3 3 3M18 21",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
} as const;

export type IconName = keyof typeof paths;

export function Icon(props: { name: IconName; size?: 14 | 16 | 18 | 20; class?: string | undefined; label?: string }): JSX.Element {
  const size = () => props.size ?? 16;
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
    >
      <path d={paths[props.name]} />
    </svg>
  );
}

/** MVP's mark (ui/src/design/Logo.tsx): the v, its ripple, its crown. */
export function Mark(props: { size: number }): JSX.Element {
  return (
    <svg width={props.size} height={props.size} viewBox="-60 -50 120 170" role="img" aria-label="MVP">
      <ellipse cx="0" cy="98" rx="37" ry="10" fill="none" stroke="var(--accent)" stroke-width="7" />
      <path d="M-40 0 L0 18 L40 0 L0 95 Z" fill="var(--text-1)" stroke="var(--bg-1)" stroke-width="9" stroke-linejoin="round" />
      <path
        d="M-17 12 V-9 L-9 -1 L0 -14 L9 -1 L17 -9 V12 Z"
        transform="translate(0 -28) scale(1.3)"
        fill="var(--warn)"
        stroke="var(--bg-1)"
        stroke-width="5"
        stroke-linejoin="round"
      />
    </svg>
  );
}
