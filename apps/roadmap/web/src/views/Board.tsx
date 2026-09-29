import { createMemo, createSignal, For, type JSX, onMount, Show } from "solid-js";
import { matches, shownStatuses } from "../lib/filters";
import { day } from "../lib/format";
import { plain } from "../lib/markdown";
import { beforeIdForLane, placeMove, progress, ratio } from "../lib/order";
import { areaName, currentVersion, data, features, liveIn, me, versionState } from "../state/data";
import { accept, move, reject } from "../state/ops";
import { openFeature, route } from "../state/route";
import { selected, setOverlay, setSelected, useGrid } from "../state/ui";
import { type Feature, STATUS_LABEL, type Status, type Version } from "../types";
import { Button } from "../ui/Button";
import { AreaDot, ClaudeBadge, Ring, StatusGlyph } from "../ui/Glyphs";
import { Icon } from "../ui/Icon";
import styles from "./Board.module.css";
import { createDrag, type DropTarget } from "./drag";
import { VersionMenu } from "./VersionMenu";

const STATE_LABEL = { released: "Released", active: "In progress", planned: "Planned" } as const;

/** The board reads what is being built first, then what is agreed, then what waits for a call. */
const LANE_ORDER: readonly Status[] = ["in_progress", "accepted", "proposed", "done", "rejected"];

/** Lanes folded by hand (`versionId:status`); done lanes of more than six start folded. */
const [folded, setFolded] = createSignal<Record<string, boolean>>({});

function isFolded(versionId: number, status: Status, size: number): boolean {
  const own = folded()[`${versionId}:${status}`];
  if (own !== undefined) return own;
  return status === "done" && size > 6 && route().filters.query.trim() === "";
}

/** The features a lane shows, in order. */
function laneOf(versionId: number, status: Status): Feature[] {
  const filters = route().filters;
  return liveIn(versionId).filter((f) => f.status === status && matches(f, filters, areaName));
}

export function Board(): JSX.Element {
  let board: HTMLDivElement | undefined;
  const owner = () => me()?.kind === "owner";
  const lanes = () => [...shownStatuses(route().filters)].sort((a, b) => LANE_ORDER.indexOf(a) - LANE_ORDER.indexOf(b));

  const drop = (id: number, target: DropTarget) => {
    const f = data.features[id];
    if (!f) return;
    const lane = laneOf(target.versionId, target.status);
    // Dropped on a folded lane's head: last in that lane.
    const index = isFolded(target.versionId, target.status, lane.length) ? lane.length : target.index;
    const beforeId = beforeIdForLane(lane, index, id);
    const status = target.status !== f.status ? target.status : undefined;
    const placed = placeMove(features(), id, target.versionId, beforeId).find((p) => p.id === id);
    if (!status && placed && placed.versionId === f.versionId && placed.position === f.position) return;
    void move(id, target.versionId, beforeId, status);
  };

  const drag = createDrag({
    board: () => board,
    scroller: () => null,
    enabled: owner,
    ghostClass: styles.ghost ?? "",
    onDrop: drop,
  });

  // The keyboard walks the board column by column, lane by lane.
  useGrid(() =>
    data.versions.map((v) =>
      lanes().flatMap((status) => {
        const lane = laneOf(v.id, status);
        return isFolded(v.id, status, lane.length) ? [] : lane.map((f) => f.id);
      }),
    ),
  );

  // A narrow window shows one column at a time: start on the version being built.
  onMount(() => {
    const current = currentVersion();
    if (!board || !current || board.scrollWidth <= board.clientWidth) return;
    const target = board.querySelector<HTMLElement>(`section[data-version="${current.id}"]`);
    if (target) board.scrollLeft += target.getBoundingClientRect().left - board.getBoundingClientRect().left;
  });

  return (
    <div class={styles.board} ref={board} onPointerDown={(event) => drag.onPointerDown(event)} data-testid="board">
      <div class={styles.track} style={{ "--versions": data.versions.length }}>
        <For each={data.versions}>
          {(v) => <Column version={v} lanes={lanes()} dragging={drag.dragging()} target={drag.target()} owner={owner()} />}
        </For>
      </div>
    </div>
  );
}

function Column(props: {
  version: Version;
  lanes: readonly Status[];
  dragging: number | null;
  target: DropTarget | null;
  owner: boolean;
}): JSX.Element {
  const all = createMemo(() => liveIn(props.version.id));
  const counts = createMemo(() => progress(all()));
  const state = () => versionState(props.version);
  const shown = () => props.lanes.reduce((sum, status) => sum + laneOf(props.version.id, status).length, 0);
  return (
    <section
      class={`${styles.column} glass-rim`}
      data-state={state()}
      data-version={props.version.id}
      aria-label={`Version ${props.version.name}`}
    >
      <header class={styles.head}>
        <div class={styles.titleRow}>
          <h2 class={styles.name}>{props.version.name}</h2>
          <span class={styles.state} data-state={state()}>
            {STATE_LABEL[state()]}
            <Show when={props.version.releasedOn}>{(on) => <> · {day(on())}</>}</Show>
          </span>
          <span class={styles.ring} title={`${counts().done} of ${counts().total} done`}>
            <Ring size={44} stroke={4} done={ratio(counts())} active={counts().total ? counts().inProgress / counts().total : 0} />
            <span class={`${styles.ringValue} num`}>{Math.round(ratio(counts()) * 100)}%</span>
          </span>
          <Show when={props.owner}>
            <VersionMenu version={props.version} />
          </Show>
        </div>
        <Show when={props.version.goal}>
          <p class={styles.goal} title={props.version.goal}>
            {props.version.goal}
          </p>
        </Show>
        <p class={styles.meta}>
          <span class="num">
            <strong>{counts().done}</strong>/{counts().total} done
          </span>
          <Show when={counts().inProgress}>
            <span class="num">{counts().inProgress} in progress</span>
          </Show>
          <Show when={counts().proposed}>
            <span class="num">{counts().proposed} proposed</span>
          </Show>
          <Show when={props.version.targetDate}>{(on) => <span>Target {day(on())}</span>}</Show>
        </p>
      </header>
      <div class={styles.body}>
        <For each={props.lanes.filter((status) => laneOf(props.version.id, status).length > 0)}>
          {(status) => (
            <Lane
              version={props.version}
              status={status}
              dragging={props.dragging}
              target={targetIn(props.target, props.version.id, status)}
              owner={props.owner}
            />
          )}
        </For>
        <Show when={shown() === 0 && props.dragging === null}>
          <p class={styles.empty}>{all().length === 0 ? "Nothing planned here yet." : "Nothing here matches the filters."}</p>
        </Show>
        {/* While dragging, the lanes this version doesn't have yet wait below the others, so
            nothing above moves under the pointer. */}
        <Show when={props.dragging !== null && props.owner}>
          <For each={props.lanes.filter((status) => laneOf(props.version.id, status).length === 0)}>
            {(status) => (
              <div
                class={styles.dropZone}
                data-lane={status}
                data-version={props.version.id}
                data-target={targetIn(props.target, props.version.id, status) !== null}
              >
                <StatusGlyph status={status} size={12} />
                {STATUS_LABEL[status]}
              </div>
            )}
          </For>
        </Show>
        <Show when={props.owner && !props.version.releasedOn}>
          <button
            type="button"
            class={styles.add}
            onClick={() => setOverlay({ kind: "create", versionId: props.version.id, status: null })}
            aria-label={`Add a feature to ${props.version.name}`}
          >
            <Icon name="plus" /> Add a feature
          </button>
        </Show>
      </div>
    </section>
  );
}

function targetIn(target: DropTarget | null, versionId: number, status: Status): DropTarget | null {
  return target?.versionId === versionId && target.status === status ? target : null;
}

function Lane(props: {
  version: Version;
  status: Status;
  dragging: number | null;
  target: DropTarget | null;
  owner: boolean;
}): JSX.Element {
  const cards = () => laneOf(props.version.id, props.status);
  // A folded lane stays folded while dragging (dropped on its head, a card goes last).
  const closed = () => isFolded(props.version.id, props.status, cards().length);
  const key = () => `${props.version.id}:${props.status}`;
  /** Where the drop line shows, drawn by the card itself so nothing moves: before it, or after the last. */
  const drop = (feature: Feature): "before" | "after" | undefined => {
    const target = props.target;
    if (!target) return undefined;
    const others = cards().filter((f) => f.id !== props.dragging);
    if (others[target.index]?.id === feature.id) return "before";
    if (target.index >= others.length && others[others.length - 1]?.id === feature.id) return "after";
    return undefined;
  };
  return (
    <div class={styles.lane} data-lane={props.status} data-version={props.version.id} data-target={props.target !== null}>
      <button
        type="button"
        class={styles.laneHead}
        aria-expanded={!closed()}
        onClick={() => setFolded((all) => ({ ...all, [key()]: !closed() }))}
      >
        <StatusGlyph status={props.status} size={12} />
        {STATUS_LABEL[props.status]}
        <span class={styles.laneCount}>{cards().length}</span>
        <Icon name="chevronDown" size={14} class={styles.laneChevron} />
      </button>
      <Show when={!closed()}>
        <div class={styles.cards}>
          <For each={cards()}>{(f) => <Card feature={f} lifted={props.dragging === f.id} drop={drop(f)} owner={props.owner} />}</For>
        </div>
      </Show>
    </div>
  );
}

export function Card(props: { feature: Feature; lifted?: boolean; drop?: "before" | "after" | undefined; owner: boolean }): JSX.Element {
  const f = () => props.feature;
  const isSelected = () => selected() === f().id;
  const open = () => {
    setSelected(f().id);
    openFeature(f().id);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: cards are a roving focus; the page's keys act on the selected one (Enter opens it)
    <article
      class={styles.card}
      data-feature={f().id}
      data-draggable={props.owner ? "" : undefined}
      data-status={f().status}
      data-lifted={props.lifted === true}
      data-drop={props.drop}
      aria-current={isSelected() ? "true" : undefined}
      tabindex={isSelected() ? 0 : -1}
      aria-label={`${f().title}, ${STATUS_LABEL[f().status]}, ${areaName(f().area)}`}
      title={plain(f().description) || undefined}
      onClick={open}
      onFocus={() => setSelected(f().id)}
    >
      <div class={styles.cardTop}>
        <StatusGlyph status={f().status} />
        <h3 class={styles.cardTitle}>{f().title}</h3>
        <span class={styles.cardId}>#{f().id}</span>
      </div>
      <div class={styles.cardMeta}>
        <span class={styles.area}>
          <AreaDot area={f().area} />
          {areaName(f().area)}
        </span>
        <Show when={f().proposedBy === "claude"}>
          <Show when={f().status === "proposed"} fallback={<ClaudeBadge />}>
            <span class={styles.claude} title="Proposed by Claude">
              <Icon name="sparkles" size={14} label="Proposed by Claude" />
            </span>
          </Show>
        </Show>
        <Show when={f().links.length > 0 || f().comments > 0}>
          <span class={styles.counts}>
            <Show when={f().links.length > 0}>
              <span title={`${f().links.length} link(s)`}>
                <Icon name="link" size={14} />
                {f().links.length}
              </span>
            </Show>
            <Show when={f().comments > 0}>
              <span title={`${f().comments} comment(s)`}>
                <Icon name="comment" size={14} />
                {f().comments}
              </span>
            </Show>
          </span>
        </Show>
      </div>
      <Show when={props.owner && f().status === "proposed" && f().id > 0}>
        <div class={styles.decide}>
          <Button
            size="sm"
            variant={isSelected() ? "good" : "goodSoft"}
            icon="check"
            onClick={(event) => {
              event.stopPropagation();
              void accept(f().id);
            }}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="x"
            onClick={(event) => {
              event.stopPropagation();
              void reject(f().id);
            }}
          >
            Reject
          </Button>
        </div>
      </Show>
    </article>
  );
}
