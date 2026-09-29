import { type JSX, Show } from "solid-js";
import { areaColor } from "../state/data";
import { STATUS_LABEL, type Status } from "../types";
import styles from "./Glyphs.module.css";
import { Icon } from "./Icon";

/** A status as a small disc: dashed (proposed), ring (accepted), half (in progress), full (done). */
export function StatusGlyph(props: { status: Status; size?: number }): JSX.Element {
  const size = () => props.size ?? 14;
  return (
    <svg
      class={styles.status}
      data-status={props.status}
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      role="img"
      aria-label={STATUS_LABEL[props.status]}
    >
      <Show when={props.status === "proposed"}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2.2" />
      </Show>
      <Show when={props.status === "accepted"}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
      </Show>
      <Show when={props.status === "in_progress"}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
      </Show>
      <Show when={props.status === "done"}>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--bg-1)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
      <Show when={props.status === "rejected"}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M4 12 12 4" stroke="currentColor" stroke-width="1.6" />
      </Show>
    </svg>
  );
}

/** An area's colour. */
export function AreaDot(props: { area: string }): JSX.Element {
  return <i class={styles.dot} style={{ "--area": areaColor(props.area) }} aria-hidden="true" />;
}

export function Kbd(props: { children: JSX.Element }): JSX.Element {
  return <kbd class={styles.kbd}>{props.children}</kbd>;
}

export function ClaudeBadge(): JSX.Element {
  return (
    <span class={styles.claude} title="Proposed by Claude">
      <Icon name="sparkles" size={14} />
      Claude
    </span>
  );
}

/** Progress as a ring: done (mint), then in progress (lavender) after it. */
export function Ring(props: { size: number; stroke?: number; done: number; active: number; children?: JSX.Element }): JSX.Element {
  const stroke = () => props.stroke ?? 4;
  const r = () => (props.size - stroke()) / 2;
  const full = () => 2 * Math.PI * r();
  const arc = (share: number) => ({ "--full": `${full()}`, "--offset": `${full() * (1 - Math.min(Math.max(share, 0), 1))}` });
  return (
    <svg class={styles.ring} width={props.size} height={props.size} viewBox={`0 0 ${props.size} ${props.size}`} aria-hidden="true">
      <circle class={styles.ringTrack} cx={props.size / 2} cy={props.size / 2} r={r()} fill="none" stroke-width={stroke()} />
      <circle
        class={styles.ringActive}
        cx={props.size / 2}
        cy={props.size / 2}
        r={r()}
        fill="none"
        stroke-width={stroke()}
        stroke-linecap="round"
        stroke-dasharray={`${full()}`}
        style={{ ...arc(props.active), "--turn": `${props.done * 360}deg` }}
      />
      <circle
        class={styles.ringDone}
        cx={props.size / 2}
        cy={props.size / 2}
        r={r()}
        fill="none"
        stroke-width={stroke()}
        stroke-linecap="round"
        stroke-dasharray={`${full()}`}
        style={arc(props.done)}
      />
    </svg>
  );
}

/** A GitHub avatar, or initials. */
export function Avatar(props: { name: string; url?: string | undefined; kind?: string | undefined; size: number }): JSX.Element {
  const initials = () =>
    props.name
      .split(/[\s-]+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  return (
    <span
      class={styles.avatar}
      data-kind={props.kind}
      style={{ width: `${props.size}px`, height: `${props.size}px`, "font-size": `${Math.round(props.size * 0.42)}px` }}
      aria-hidden="true"
    >
      <Show
        when={props.kind === "claude"}
        fallback={
          <Show when={props.url} fallback={initials()}>
            {(url) => <img src={url()} alt="" />}
          </Show>
        }
      >
        <Icon name="sparkles" size={14} />
      </Show>
    </span>
  );
}
