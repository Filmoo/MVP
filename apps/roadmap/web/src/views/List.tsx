import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { matches } from "../lib/filters";
import { ago } from "../lib/format";
import { areaName, data, features, me, version } from "../state/data";
import { edit } from "../state/ops";
import { openFeature, route } from "../state/route";
import { selected, setSelected, useGrid } from "../state/ui";
import { type Feature, STATUS_LABEL, STATUSES } from "../types";
import { AreaDot, ClaudeBadge, StatusGlyph } from "../ui/Glyphs";
import { Icon } from "../ui/Icon";
import styles from "./List.module.css";

type Key = "title" | "status" | "area" | "version" | "by" | "updated";

const COLUMNS: { key: Key; label: string }[] = [
  { key: "title", label: "Feature" },
  { key: "status", label: "Status" },
  { key: "area", label: "Area" },
  { key: "version", label: "Version" },
  { key: "by", label: "Proposed by" },
  { key: "updated", label: "Updated" },
];

const [sort, setSort] = createSignal<{ key: Key; desc: boolean } | null>(null);

function compare(key: Key): (a: Feature, b: Feature) => number {
  const versionIndex = (f: Feature) => data.versions.findIndex((v) => v.id === f.versionId);
  const areaIndex = (f: Feature) => data.areas.findIndex((a) => a.key === f.area);
  switch (key) {
    case "title":
      return (a, b) => a.title.localeCompare(b.title);
    case "status":
      return (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
    case "area":
      return (a, b) => areaIndex(a) - areaIndex(b);
    case "version":
      return (a, b) => versionIndex(a) - versionIndex(b) || a.position - b.position;
    case "by":
      return (a, b) => a.proposedBy.localeCompare(b.proposedBy);
    case "updated":
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
  }
}

export function List(): JSX.Element {
  const rows = createMemo(() => {
    const filters = route().filters;
    const shown = features().filter((f) => matches(f, filters, areaName));
    const by = sort();
    const order = compare(by?.key ?? "version");
    shown.sort((a, b) => (by?.desc ? -1 : 1) * order(a, b) || compare("version")(a, b) || a.id - b.id);
    return shown;
  });
  useGrid(() => [rows().map((f) => f.id)]);
  return (
    <div class={styles.page} data-testid="list">
      {/* biome-ignore lint/a11y/useSemanticElements: an ARIA table of grid rows: each row lays its cells out per width, which <table> rows can't */}
      <div class={styles.table} role="table" aria-label="Features" aria-rowcount={rows().length}>
        {/* biome-ignore lint/a11y/useSemanticElements: a row of the ARIA table */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: the header row isn't a stop; its sort buttons are */}
        <div class={styles.header} role="row">
          <For each={COLUMNS}>
            {(column) => (
              // biome-ignore lint/a11y/useSemanticElements: a header cell of the ARIA table
              // biome-ignore lint/a11y/useFocusableInteractive: its sort button takes the focus
              <span role="columnheader" class={styles.cell} data-col={column.key} aria-sort={sortState(column.key)}>
                <button
                  type="button"
                  class={styles.sort}
                  onClick={() => {
                    const now = sort();
                    setSort(
                      now?.key === column.key ? (now.desc ? null : { key: column.key, desc: true }) : { key: column.key, desc: false },
                    );
                  }}
                >
                  {column.label}
                  <Show when={sort()?.key === column.key}>
                    <Icon name="chevronDown" size={14} class={sort()?.desc ? styles.desc : styles.asc} />
                  </Show>
                </button>
              </span>
            )}
          </For>
        </div>
        <For each={rows()} fallback={<p class={styles.empty}>No feature matches the filters.</p>}>
          {(f) => <Row feature={f} />}
        </For>
      </div>
    </div>
  );
}

function sortState(key: Key): "ascending" | "descending" | "none" {
  const now = sort();
  if (now?.key !== key) return "none";
  return now.desc ? "descending" : "ascending";
}

function Row(props: { feature: Feature }): JSX.Element {
  const f = () => props.feature;
  const [editing, setEditing] = createSignal(false);
  const owner = () => me()?.kind === "owner";
  const save = (input: HTMLInputElement) => {
    setEditing(false);
    const title = input.value.trim();
    if (title && title !== f().title) void edit(f().id, { title });
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of the ARIA table
    // biome-ignore lint/a11y/useFocusableInteractive: rows are a roving focus (tabindex 0 on the selected one)
    // biome-ignore lint/a11y/useKeyWithClickEvents: the page's keys act on the selected row (Enter opens it)
    <div
      class={styles.row}
      role="row"
      data-feature={f().id}
      data-status={f().status}
      aria-current={selected() === f().id ? "true" : undefined}
      tabindex={selected() === f().id ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) setSelected(f().id);
      }}
      onClick={() => {
        if (editing()) return;
        setSelected(f().id);
        openFeature(f().id);
      }}
    >
      <Cell col="title" class={styles.titleCell}>
        <StatusGlyph status={f().status} />
        <Show
          when={editing()}
          fallback={
            // biome-ignore lint/a11y/noStaticElementInteractions: a double click renames; E does it from the keyboard
            <span
              class={styles.title}
              onDblClick={(event) => {
                if (!owner()) return;
                event.stopPropagation();
                setEditing(true);
              }}
            >
              {f().title}
            </span>
          }
        >
          <input
            class={styles.titleInput}
            value={f().title}
            aria-label="Title"
            ref={(input) => queueMicrotask(() => input.select())}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") save(event.currentTarget);
              if (event.key === "Escape") setEditing(false);
            }}
            onBlur={(event) => {
              if (editing()) save(event.currentTarget);
            }}
          />
        </Show>
        <span class={styles.id}>#{f().id}</span>
        <span class={styles.mobileMeta}>
          {version(f().versionId)?.name} · {areaName(f().area)}
        </span>
      </Cell>
      <Cell col="status">{STATUS_LABEL[f().status]}</Cell>
      <Cell col="area">
        <AreaDot area={f().area} />
        {areaName(f().area)}
      </Cell>
      <Cell col="version" class="num">
        {version(f().versionId)?.name}
      </Cell>
      <Cell col="by">
        <Show when={f().proposedBy === "claude"} fallback="Owner">
          <ClaudeBadge />
        </Show>
      </Cell>
      <Cell col="updated" class="num" title={f().updatedAt}>
        {ago(f().updatedAt)}
      </Cell>
    </div>
  );
}

function Cell(props: { col: Key; class?: string | undefined; title?: string; children: JSX.Element }): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a cell of the ARIA table
    <span role="cell" class={`${styles.cell} ${props.class ?? ""}`} data-col={props.col} title={props.title}>
      {props.children}
    </span>
  );
}
