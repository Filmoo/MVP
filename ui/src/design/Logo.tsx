import type { JSX } from "solid-js";

/*
 * MVP brand, drawn on a 100-unit x-height. The v is a pointer mid-click, the ripple is the
 * right-click to move, and the crown sits where the dot of an i would.
 * Letters use currentColor so the logo follows the surface it sits on.
 */
const CROWN = "M-17 12 V-9 L-9 -1 L0 -14 L9 -1 L17 -9 V12 Z";
const POINTER = "M-40 0 L0 18 L40 0 L0 95 Z";

function Crown(props: { x: number; y: number; scale?: number }): JSX.Element {
  return (
    <path
      d={CROWN}
      transform={`translate(${props.x} ${props.y}) scale(${props.scale ?? 1})`}
      fill="var(--warn)"
      stroke="var(--logo-ink, var(--bg-1))"
      stroke-width="5"
      stroke-linejoin="round"
    />
  );
}

function Ripple(props: { x: number; y: number }): JSX.Element {
  return <ellipse cx={props.x} cy={props.y} rx="37" ry="10" fill="none" stroke="var(--accent)" stroke-width="7" />;
}

/** Full "mvp" wordmark. */
export function Wordmark(props: { height: number; class?: string | undefined }): JSX.Element {
  return (
    <svg class={props.class} height={props.height} viewBox="-12 -44 372 192" role="img" aria-label="MVP" fill="none" stroke-linecap="round">
      <path d="M10 88 V42 A29 29 0 0 1 68 42 V88 M68 42 A29 29 0 0 1 126 42 V88" stroke="currentColor" stroke-width="20" />
      <Ripple x={194} y={100} />
      <path d={POINTER} transform="translate(194 2)" fill="currentColor" stroke="currentColor" stroke-width="8" stroke-linejoin="round" />
      <path d="M265 12 V132 M265 50 A40 40 0 1 0 345 50 A40 40 0 1 0 265 50" stroke="currentColor" stroke-width="20" />
      <Crown x={194} y={-26} scale={1.3} />
    </svg>
  );
}

/** The v on its own: pick the spot, crown the play. Square, for small places. */
export function Mark(props: { size: number; class?: string | undefined }): JSX.Element {
  return (
    <svg class={props.class} width={props.size} height={props.size} viewBox="-60 -50 120 170" role="img" aria-label="MVP">
      <ellipse cx="0" cy="98" rx="37" ry="10" fill="none" stroke="var(--accent)" stroke-width="7" />
      <path d={POINTER} fill="var(--text-1)" stroke="currentColor" stroke-width="9" stroke-linejoin="round" />
      <Crown x={0} y={-28} scale={1.3} />
    </svg>
  );
}
