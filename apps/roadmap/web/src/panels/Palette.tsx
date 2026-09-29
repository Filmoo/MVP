import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { signOut } from "../chrome/TopBar";
import { rank } from "../lib/fuzzy";
import { areaName, data, feature, features, load, me, proposals, version } from "../state/data";
import { accept, move, reject, remove, setStatus, undoLast } from "../state/ops";
import { clearFilters, go, openFeature, setFilters } from "../state/route";
import { selected, setOverlay, setSelected, setTitleEdit } from "../state/ui";
import { STATUS_LABEL } from "../types";
import { AreaDot, Kbd, StatusGlyph } from "../ui/Glyphs";
import { Icon, type IconName } from "../ui/Icon";
import { Modal } from "../ui/Layers";
import styles from "./Palette.module.css";

interface Item {
  id: string;
  label: string;
  group: string;
  icon?: IconName | undefined;
  hint?: string | undefined;
  /** Rendered instead of the icon (a feature's status and area). */
  glyph?: () => JSX.Element;
  run: () => void;
}

function commands(): Item[] {
  const owner = me()?.kind === "owner";
  const items: Item[] = [
    { id: "board", label: "Go to Board", group: "Go to", icon: "board", hint: "1", run: () => go({ view: "board" }) },
    { id: "roadmap", label: "Go to Roadmap", group: "Go to", icon: "roadmap", hint: "2", run: () => go({ view: "roadmap" }) },
    { id: "list", label: "Go to List", group: "Go to", icon: "list", hint: "3", run: () => go({ view: "list" }) },
    {
      id: "inbox",
      label: `Open proposals (${proposals().length})`,
      group: "Go to",
      icon: "inbox",
      hint: "I",
      run: () => go({ panel: "inbox" }),
    },
    { id: "activity", label: "Open the activity log", group: "Go to", icon: "activity", run: () => go({ panel: "activity" }) },
    { id: "clear", label: "Clear filters", group: "Filters", icon: "filter", run: clearFilters },
    {
      id: "rejected",
      label: "Show rejected features",
      group: "Filters",
      icon: "filter",
      run: () => setFilters({ statuses: ["rejected"] }, false),
    },
    {
      id: "claude",
      label: "Show Claude's proposals only",
      group: "Filters",
      icon: "sparkles",
      run: () => setFilters({ proposers: ["claude"], statuses: ["proposed"] }, false),
    },
    { id: "reload", label: "Reload the roadmap", group: "Roadmap", icon: "refresh", run: () => void load() },
    { id: "undo", label: "Undo the last change", group: "Roadmap", icon: "undo", hint: "Ctrl Z", run: () => void undoLast() },
    { id: "keys", label: "Keyboard shortcuts", group: "Roadmap", icon: "keyboard", hint: "?", run: () => setOverlay({ kind: "keys" }) },
    { id: "signout", label: "Sign out", group: "Roadmap", icon: "logout", run: () => void signOut() },
  ];
  if (owner) {
    items.unshift(
      {
        id: "new",
        label: "New feature",
        group: "Create",
        icon: "plus",
        hint: "N",
        run: () => setOverlay({ kind: "create", versionId: null, status: null }),
      },
      { id: "version", label: "New version", group: "Create", icon: "flag", run: () => setOverlay({ kind: "version", versionId: null }) },
    );
  }
  return items;
}

/** What can be done to the selected feature. */
function actions(): Item[] {
  const f = feature(selected());
  if (!f || f.removedAt || me()?.kind !== "owner") return [];
  const group = `“${f.title.length > 40 ? `${f.title.slice(0, 39)}…` : f.title}”`;
  const items: Item[] = [{ id: "open", label: "Open", group, icon: "arrowRight", hint: "Enter", run: () => openFeature(f.id) }];
  if (f.status === "proposed") {
    items.push(
      { id: "accept", label: "Accept", group, icon: "check", hint: "A", run: () => void accept(f.id) },
      { id: "reject", label: "Reject", group, icon: "x", hint: "R", run: () => void reject(f.id) },
    );
  }
  if (f.status !== "in_progress")
    items.push({
      id: "start",
      label: "Mark in progress",
      group,
      icon: "arrowRight",
      hint: "S",
      run: () => void setStatus(f.id, "in_progress"),
    });
  if (f.status !== "done")
    items.push({ id: "done", label: "Mark done", group, icon: "check", hint: "D", run: () => void setStatus(f.id, "done") });
  items.push(
    { id: "move", label: "Move to version…", group, icon: "flag", hint: "M", run: () => setOverlay({ kind: "palette", mode: "move" }) },
    {
      id: "rename",
      label: "Rename",
      group,
      icon: "edit",
      hint: "E",
      run: () => {
        openFeature(f.id);
        setTitleEdit((n) => n + 1);
      },
    },
    { id: "remove", label: "Remove", group, icon: "trash", hint: "Del", run: () => void remove(f.id) },
  );
  return items;
}

function featureItems(): Item[] {
  return features()
    .filter((f) => !f.removedAt)
    .map((f) => ({
      id: `feature-${f.id}`,
      label: f.title,
      group: "Features",
      hint: `${version(f.versionId)?.name ?? ""} · ${STATUS_LABEL[f.status]}`,
      glyph: () => <StatusGlyph status={f.status} />,
      run: () => {
        setSelected(f.id);
        openFeature(f.id);
      },
    }));
}

function versionItems(): Item[] {
  const f = feature(selected());
  if (!f) return [];
  return data.versions.map((v) => ({
    id: `version-${v.id}`,
    label: `Move to ${v.name}`,
    group: `Move “${f.title}”`,
    icon: "flag" as IconName,
    hint: v.id === f.versionId ? "here now" : v.goal.slice(0, 40) || undefined,
    run: () => {
      if (v.id !== f.versionId) void move(f.id, v.id, null);
    },
  }));
}

export function Palette(props: { mode: "all" | "move" }): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const results = createMemo(() => {
    const q = query();
    if (props.mode === "move") return rank(versionItems(), q, (i) => i.label, 20).map((r) => r.item);
    // Each group once, the group with the best match first ("tier" finds features first,
    // "move to" the action on the selected feature).
    const groups = [
      rank(actions(), q, (i) => i.label, q ? 6 : 12),
      rank(commands(), q, (i) => `${i.label} ${i.group}`, q ? 6 : 30),
      q ? rank(featureItems(), q, (i) => i.label, 10) : [],
    ].filter((group) => group.length > 0);
    if (q) groups.sort((a, b) => (b[0]?.match.score ?? 0) - (a[0]?.match.score ?? 0));
    return groups.flatMap((group) => group.map((r) => r.item));
  });
  const run = (item: Item | undefined) => {
    if (!item) return;
    setOverlay(null);
    item.run();
  };
  let list: HTMLDivElement | undefined;
  const show = (index: number) => {
    const count = results().length;
    if (count === 0) return;
    const next = (index + count) % count;
    setActive(next);
    list?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  return (
    <Modal label="Command palette" onClose={() => setOverlay(null)} class={styles.palette}>
      <div class={styles.field}>
        <Icon name="search" class={styles.fieldIcon} />
        <input
          class={styles.input}
          placeholder={props.mode === "move" ? "Move to which version?" : "Type a command or a feature"}
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results()[active()] ? `palette-${results()[active()]?.id}` : undefined}
          ref={(input) => queueMicrotask(() => input.focus())}
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              show(active() + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              show(active() - 1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(results()[active()]);
            }
          }}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div class={styles.results} id="palette-results" role="listbox" ref={list}>
        <For each={results()} fallback={<p class={styles.empty}>Nothing matches “{query()}”.</p>}>
          {(item, i) => (
            <>
              <Show when={i() === 0 || results()[i() - 1]?.group !== item.group}>
                <p class={styles.group}>{item.group}</p>
              </Show>
              {/* biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, the focus stays in the input (aria-activedescendant) */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys for every option */}
              <div
                id={`palette-${item.id}`}
                class={styles.item}
                role="option"
                data-index={i()}
                aria-selected={active() === i()}
                onPointerMove={() => setActive(i())}
                onClick={() => run(item)}
              >
                <span class={styles.icon}>
                  <Show when={item.glyph} fallback={<Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>}>
                    {(glyph) => glyph()()}
                  </Show>
                </span>
                <span class={styles.label}>{item.label}</span>
                <Show when={item.id.startsWith("feature-")}>
                  <AreaDot area={feature(Number(item.id.slice(8)))?.area ?? ""} />
                  <span class={styles.area}>{areaName(feature(Number(item.id.slice(8)))?.area ?? "")}</span>
                </Show>
                <Show when={item.hint}>
                  <span class={styles.hint}>{item.hint}</span>
                </Show>
              </div>
            </>
          )}
        </For>
      </div>
    </Modal>
  );
}
