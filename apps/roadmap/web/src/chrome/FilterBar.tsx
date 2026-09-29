import { For, type JSX, Show } from "solid-js";
import { isFiltered, matches, toggle } from "../lib/filters";
import { count } from "../lib/format";
import { areaName, data, features, me } from "../state/data";
import { clearFilters, route, setFilters } from "../state/route";
import { setOverlay } from "../state/ui";
import { type Proposer, STATUS_LABEL, STATUSES } from "../types";
import { Button } from "../ui/Button";
import { AreaDot, StatusGlyph } from "../ui/Glyphs";
import { Icon } from "../ui/Icon";
import { Dropdown, layers } from "../ui/Layers";
import styles from "./FilterBar.module.css";
import { SearchField } from "./TopBar";

const PROPOSER_LABEL: Record<Proposer, string> = { owner: "The owner", claude: "Claude" };

function Check(): JSX.Element {
  return <Icon name="check" class={layers.check} />;
}

export function FilterBar(): JSX.Element {
  const filters = () => route().filters;
  const live = () => features().filter((f) => !f.removedAt);
  const shown = () => live().filter((f) => matches(f, filters(), areaName));
  const summary = (names: string[], all: string) => (names.length === 0 ? all : names.length === 1 ? names[0] : `${names.length} selected`);
  return (
    <div class={styles.bar} role="toolbar" aria-label="Filters">
      <SearchField class={styles.search} />
      <Dropdown
        label="Areas"
        trigger={(open, toggleOpen) => (
          <button type="button" class={styles.filter} data-active={filters().areas.length > 0} aria-expanded={open()} onClick={toggleOpen}>
            <Icon name="filter" size={14} />
            Area
            <Show when={filters().areas.length > 0}>
              <span class={styles.value}>{summary(filters().areas.map(areaName), "")}</span>
            </Show>
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        {() => (
          <For each={data.areas}>
            {(area) => (
              <button
                type="button"
                role="menuitemcheckbox"
                class={layers.option}
                aria-checked={filters().areas.includes(area.key)}
                onClick={() => setFilters({ areas: toggle(filters().areas, area.key) }, false)}
              >
                <AreaDot area={area.key} />
                {area.name}
                <span class={layers.optionCount}>{live().filter((f) => f.area === area.key && f.status !== "rejected").length}</span>
                <Check />
              </button>
            )}
          </For>
        )}
      </Dropdown>
      <Dropdown
        label="Statuses"
        trigger={(open, toggleOpen) => (
          <button
            type="button"
            class={styles.filter}
            data-active={filters().statuses.length > 0}
            aria-expanded={open()}
            onClick={toggleOpen}
          >
            Status
            <Show when={filters().statuses.length > 0}>
              <span class={styles.value}>
                {summary(
                  filters().statuses.map((s) => STATUS_LABEL[s]),
                  "",
                )}
              </span>
            </Show>
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        {() => (
          <>
            <For each={STATUSES}>
              {(status) => (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  class={layers.option}
                  aria-checked={filters().statuses.includes(status)}
                  onClick={() => setFilters({ statuses: toggle(filters().statuses, status) }, false)}
                >
                  <StatusGlyph status={status} />
                  {STATUS_LABEL[status]}
                  <span class={layers.optionCount}>{live().filter((f) => f.status === status).length}</span>
                  <Check />
                </button>
              )}
            </For>
            <div class={layers.caption}>None ticked: all but rejected</div>
          </>
        )}
      </Dropdown>
      <Dropdown
        label="Proposed by"
        trigger={(open, toggleOpen) => (
          <button
            type="button"
            class={styles.filter}
            data-active={filters().proposers.length > 0}
            aria-expanded={open()}
            onClick={toggleOpen}
          >
            Proposed by
            <Show when={filters().proposers.length > 0}>
              <span class={styles.value}>
                {summary(
                  filters().proposers.map((p) => PROPOSER_LABEL[p]),
                  "",
                )}
              </span>
            </Show>
            <Icon name="chevronDown" size={14} />
          </button>
        )}
      >
        {() => (
          <For each={["owner", "claude"] as const}>
            {(proposer) => (
              <button
                type="button"
                role="menuitemcheckbox"
                class={layers.option}
                aria-checked={filters().proposers.includes(proposer)}
                onClick={() => setFilters({ proposers: toggle(filters().proposers, proposer) }, false)}
              >
                <Show when={proposer === "claude"} fallback={<Icon name="user" size={14} />}>
                  <Icon name="sparkles" size={14} />
                </Show>
                {PROPOSER_LABEL[proposer]}
                <span class={layers.optionCount}>{live().filter((f) => f.proposedBy === proposer && f.status !== "rejected").length}</span>
                <Check />
              </button>
            )}
          </For>
        )}
      </Dropdown>
      <Show when={isFiltered(filters())}>
        <button type="button" class={styles.clear} onClick={clearFilters}>
          Clear filters
        </button>
      </Show>
      <p class={styles.summary} aria-live="polite">
        <Show when={isFiltered(filters())} fallback={<strong class="num">{count(shown().length, "feature")}</strong>}>
          <strong class="num">{shown().length}</strong> of{" "}
          <span class="num">{count(live().filter((f) => f.status !== "rejected").length, "feature")}</span>
        </Show>
        {" · "}
        <span class="num">{live().filter((f) => f.status === "done").length}</span> done
      </p>
      <Show when={me()?.kind === "owner"}>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          class={styles.version}
          onClick={() => setOverlay({ kind: "version", versionId: null })}
        >
          Version
        </Button>
      </Show>
    </div>
  );
}
