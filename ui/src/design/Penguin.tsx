import { createUniqueId, type JSX, Show } from "solid-js";

/*
 * MVP's totem: a manchot (an emperor, standing tall), drawn from the logo. The logo's v (the
 * pointer mid-click) is its white front, notch and point included, like a tuxedo's; the
 * crown's gold is the emperor's neck, flowing down into it; it stands on the logo's ripple (the
 * right-click to move). Solid shapes in tokens only, a rim of light like the app's glass (bright
 * top left, faint bottom right), strokes that stay at least a pixel wide from 16 to 96 px.
 */
const BODY =
  "M32 5.5c6.2 0 10.2 4.6 10.2 10.5 0 2.3-.5 4.4-1.4 6.2 4.6 4.3 7.4 10.7 7.4 17.8 0 9-7.3 15-16.2 15s-16.2-6-16.2-15c0-7.1 2.8-13.5 7.4-17.8-.9-1.8-1.4-3.9-1.4-6.2C21.8 10.1 25.8 5.5 32 5.5z";
const FLIPPERS = "M21.4 27.5c-4.6 3.7-7 9.1-7.6 15.4 3.4-1.4 6.3-4.6 8.2-8.9zM42.6 27.5c4.6 3.7 7 9.1 7.6 15.4-3.4-1.4-6.3-4.6-8.2-8.9z";
/** The logo's pointer (Logo.tsx `POINTER`), its sides let out a little into a belly. */
const FRONT = "M21.2 23.4 32 28.2l10.8-4.8c2.2 9.8-1.8 21.4-10.8 28-9-6.6-13-18.2-10.8-28z";
/** The emperor's gold, from behind the eyes down the neck into the front's top corners. */
const GOLD = "M24 19.4c-1.3 1.3-1.6 3.2-.9 4.8l-1.9-.4c-.4-1.9.6-3.7 2.8-4.4zM40 19.4c1.3 1.3 1.6 3.2.9 4.8l1.9-.4c.4-1.9-.6-3.7-2.8-4.4z";
const BEAK = "M29.6 18.4c1.5-.6 3.3-.6 4.8 0L32 22.6z";
/** The logo's crown (Logo.tsx `CROWN`). */
const CROWN = "M-17 12V-9l8 8 9-13 9 13 8-8v21z";

export function Penguin(props: {
  /** Pixels, 16 to 96. */
  size: number;
  /** Wears the logo's crown (the MVP). */
  crown?: boolean;
  /** Where it looks: at you, or up and away (waiting for something). */
  gaze?: "front" | "away";
  /** Its name when it stands alone; decorative otherwise. */
  label?: string;
  class?: string | undefined;
}): JSX.Element {
  const id = createUniqueId();
  // Strokes in viewBox units that stay at least a screen pixel wide (the box is 64 units).
  const px = (units: number, minPx: number) => Math.max(units, (minPx * 64) / props.size);
  const small = () => props.size < 28;
  const away = () => props.gaze === "away";
  return (
    <svg
      class={props.class}
      width={props.size}
      height={props.size}
      viewBox="0 0 64 64"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
      data-free-style
    >
      <defs>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stop-color="var(--bg-4)" />
          <stop offset="0.55" stop-color="var(--bg-1)" />
          <stop offset="1" stop-color="var(--bg-0)" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--text-1)" />
          <stop offset="0.45" stop-color="var(--text-3)" />
          <stop offset="1" stop-color="var(--line-2)" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="57.6" rx="18" ry="4.2" fill="none" stroke="var(--accent)" stroke-width={px(2.4, 1.25)} />
      <g stroke={`url(#${id}-rim)`} stroke-width={px(1.4, 1)} stroke-linejoin="round" fill={`url(#${id}-ink)`}>
        <path d={FLIPPERS} />
        <path d={BODY} />
      </g>
      {/* The logo's v, rounded at its corners like the logo's (a round-joined stroke of its own colour). */}
      <path d={FRONT} fill="var(--text-1)" stroke="var(--text-1)" stroke-width="1.6" stroke-linejoin="round" />
      <path d={GOLD} fill="var(--warn)" />
      <path d={BEAK} fill="var(--tier-s)" />
      <Show when={!small()}>
        <g fill="var(--text-1)">
          <circle cx="27.8" cy="14.4" r="1.7" />
          <circle cx="36.2" cy="14.4" r="1.7" />
        </g>
        <g fill="var(--bg-0)">
          <circle cx={away() ? 28.4 : 27.9} cy={away() ? 13.7 : 14.7} r="0.85" />
          <circle cx={away() ? 36.8 : 36.3} cy={away() ? 13.7 : 14.7} r="0.85" />
        </g>
      </Show>
      <g fill="var(--tier-s)">
        <ellipse cx="27" cy="56.4" rx="3.6" ry="1.6" />
        <ellipse cx="37" cy="56.4" rx="3.6" ry="1.6" />
      </g>
      <Show when={props.crown}>
        <path
          d={CROWN}
          transform="translate(33.5 3.6) rotate(8) scale(0.3)"
          fill="var(--warn)"
          stroke="var(--bg-1)"
          stroke-width="6"
          stroke-linejoin="round"
        />
      </Show>
    </svg>
  );
}
