import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { matches, toggle } from "../lib/filters";
import { day } from "../lib/format";
import { plain } from "../lib/markdown";
import { progress, ratio } from "../lib/order";
import { area, areaColor, areaName, data, liveIn, versionState } from "../state/data";
import { openFeature, route, setFilters } from "../state/route";
import { selected, setSelected, useGrid } from "../state/ui";
import { type Feature, STATUS_LABEL, type Status, type Version } from "../types";
import { ClaudeBadge, Ring } from "../ui/Glyphs";
import styles from "./Roadmap.module.css";

/** Done work sits closest to its milestone; what's coming hangs below. */
const RANK: Record<Status, number> = { done: 0, in_progress: 1, accepted: 2, proposed: 3, rejected: 4 };
const STATE_LABEL = { released: "Released", active: "In progress", planned: "Planned" } as const;

/** Area (hovered in the legend) whose nodes stand out. */
const [lit, setLit] = createSignal<string | null>(null);

function nodesOf(versionId: number): Feature[] {
  const filters = route().filters;
  const areaOrder = (key: string) => area(key)?.position ?? 99;
  return liveIn(versionId)
    .filter((f) => matches(f, filters, areaName))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || areaOrder(a.area) - areaOrder(b.area) || a.position - b.position);
}

export function Roadmap(): JSX.Element {
  useGrid(() => data.versions.map((v) => nodesOf(v.id).map((f) => f.id)));
  const legend = createMemo(() =>
    data.areas.map((a) => ({
      ...a,
      count: Object.values(data.features).filter((f) => f.area === a.key && !f.removedAt && f.status !== "rejected").length,
    })),
  );
  return (
    <div class={styles.page} data-testid="roadmap">
      <fieldset class={styles.legend}>
        <legend class="visually-hidden">Areas</legend>
        <For each={legend()}>
          {(a) => (
            <button
              type="button"
              class={styles.chip}
              style={{ "--area": areaColor(a.key) }}
              aria-pressed={route().filters.areas.includes(a.key)}
              onPointerEnter={() => setLit(a.key)}
              onPointerLeave={() => setLit(null)}
              onFocus={() => setLit(a.key)}
              onBlur={() => setLit(null)}
              onClick={() => setFilters({ areas: toggle(route().filters.areas, a.key) }, false)}
            >
              <i class={styles.chipDot} />
              {a.name}
              <span class={`${styles.chipCount} num`}>{a.count}</span>
            </button>
          )}
        </For>
      </fieldset>
      <ol class={styles.stops} style={{ "--stops": data.versions.length }}>
        <For each={data.versions}>{(v, i) => <Stop version={v} index={i()} last={i() === data.versions.length - 1} />}</For>
      </ol>
    </div>
  );
}

function Stop(props: { version: Version; index: number; last: boolean }): JSX.Element {
  const counts = createMemo(() => progress(liveIn(props.version.id)));
  const nodes = createMemo(() => nodesOf(props.version.id));
  const state = () => versionState(props.version);
  return (
    <li class={styles.stop} data-state={state()} data-last={props.last} style={{ "--i": props.index }}>
      <div class={styles.milestone}>
        <span class={styles.ring}>
          <Ring size={64} stroke={5} done={ratio(counts())} active={counts().total ? counts().inProgress / counts().total : 0} />
          <span class={styles.ringName}>{props.version.name}</span>
        </span>
        <div class={styles.label}>
          <p class={styles.stateLine}>
            <span class={styles.state} data-state={state()}>
              {STATE_LABEL[state()]}
            </span>
            <span class="num">
              {counts().done}/{counts().total}
            </span>
          </p>
          <Show when={props.version.releasedOn ?? props.version.targetDate}>
            {(on) => <p class={styles.when}>{props.version.releasedOn ? day(on()) : `Target ${day(on())}`}</p>}
          </Show>
          <Show when={props.version.goal}>
            <p class={styles.goal} title={props.version.goal}>
              {props.version.goal}
            </p>
          </Show>
        </div>
      </div>
      <ol class={styles.thread} aria-label={`Version ${props.version.name}`}>
        <For each={nodes()} fallback={<li class={styles.none}>Nothing here matches.</li>}>
          {(f, i) => (
            <li
              class={styles.node}
              data-status={f.status}
              data-dim={lit() !== null && lit() !== f.area}
              style={{ "--area": areaColor(f.area), "--n": Math.min(i(), 24) }}
            >
              <button
                type="button"
                class={styles.nodeButton}
                data-feature={f.id}
                aria-current={selected() === f.id ? "true" : undefined}
                tabindex={selected() === f.id ? 0 : -1}
                title={`${f.title} · ${STATUS_LABEL[f.status]} · ${areaName(f.area)}${plain(f.description) ? `\n${plain(f.description)}` : ""}`}
                onFocus={() => setSelected(f.id)}
                onClick={() => {
                  setSelected(f.id);
                  openFeature(f.id);
                }}
              >
                <i class={styles.dot} aria-hidden="true" />
                <span class={styles.title}>{f.title}</span>
                <Show when={f.proposedBy === "claude" && f.status === "proposed"}>
                  <ClaudeBadge />
                </Show>
                <span class="visually-hidden">, {STATUS_LABEL[f.status]}</span>
              </button>
            </li>
          )}
        </For>
      </ol>
    </li>
  );
}
