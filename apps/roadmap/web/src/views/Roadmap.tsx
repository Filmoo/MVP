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

/** Stations whose done work was unfolded by hand. */
const [unfolded, setUnfolded] = createSignal<Record<number, boolean>>({});
/** Past this many done features, a station shows them as one row. */
const DONE_FOLD = 6;

function nodesOf(versionId: number): Feature[] {
  const filters = route().filters;
  const areaOrder = (key: string) => area(key)?.position ?? 99;
  return liveIn(versionId)
    .filter((f) => matches(f, filters, areaName))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || areaOrder(a.area) - areaOrder(b.area) || a.position - b.position);
}

function doneFolded(versionId: number, done: number): boolean {
  return done > DONE_FOLD && !unfolded()[versionId] && route().filters.query.trim() === "";
}

/** The nodes a station shows: its done work left out while folded. */
function shownOf(versionId: number): Feature[] {
  const nodes = nodesOf(versionId);
  const done = nodes.filter((f) => f.status === "done").length;
  return doneFolded(versionId, done) ? nodes.filter((f) => f.status !== "done") : nodes;
}

export function Roadmap(): JSX.Element {
  useGrid(() => data.versions.map((v) => shownOf(v.id).map((f) => f.id)));
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
  const done = createMemo(() => nodesOf(props.version.id).filter((f) => f.status === "done").length);
  const folded = () => doneFolded(props.version.id, done());
  const nodes = createMemo(() => shownOf(props.version.id));
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
              <Show when={props.version.releasedOn}>{(on) => <> · {day(on())}</>}</Show>
            </span>
            <span class="num">
              {counts().done}/{counts().total}
            </span>
            <Show when={!props.version.releasedOn && props.version.targetDate}>
              {(on) => <span class={styles.when}>Target {day(on())}</span>}
            </Show>
          </p>
          <p class={styles.goal} title={props.version.goal || undefined}>
            {props.version.goal}
          </p>
        </div>
      </div>
      <ol class={styles.thread} aria-label={`Version ${props.version.name}`}>
        <Show when={done() > DONE_FOLD && route().filters.query.trim() === ""}>
          <li class={styles.node} data-status="done" data-summary>
            <button
              type="button"
              class={styles.nodeButton}
              aria-expanded={!folded()}
              onClick={() => setUnfolded((all) => ({ ...all, [props.version.id]: folded() }))}
            >
              <i class={styles.dot} aria-hidden="true" />
              <span class={styles.title}>{done()} done</span>
              <span class={styles.fold}>{folded() ? "Show" : "Hide"}</span>
            </button>
          </li>
        </Show>
        <For
          each={nodes()}
          fallback={
            <Show when={done() === 0 || !folded()}>
              <li class={styles.none}>Nothing here matches.</li>
            </Show>
          }
        >
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
