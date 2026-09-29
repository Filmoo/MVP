import { createSignal, For, type JSX, Show } from "solid-js";
import { ago } from "../lib/format";
import { areaName, data, proposals } from "../state/data";
import { accept, reject } from "../state/ops";
import { go, openFeature } from "../state/route";
import { selected, setSelected, useGrid } from "../state/ui";
import type { Feature } from "../types";
import { Button } from "../ui/Button";
import { AreaDot, Kbd } from "../ui/Glyphs";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Layers";
import { Markdown } from "../ui/Markdown";
import styles from "./Inbox.module.css";

/** Claude's proposals waiting for the owner: accept (into a version) or reject, one click each. */
export function Inbox(): JSX.Element {
  useGrid(() => [proposals().map((f) => f.id)]);
  return (
    <Sheet
      label="Proposals"
      testId="inbox"
      onClose={() => go({ panel: null })}
      head={
        <div class={styles.head}>
          <h2 class={styles.title}>
            Proposals <span class={`${styles.count} num`}>{proposals().length}</span>
          </h2>
          <p class={styles.sub}>Claude's suggestions, waiting for your call.</p>
        </div>
      }
    >
      <Show
        when={proposals().length > 0}
        fallback={
          <div class={styles.empty}>
            <Icon name="check" size={20} />
            <p>Inbox zero: nothing waits for you.</p>
            <p class={styles.hint}>Claude adds proposals with scripts/roadmap.mjs propose.</p>
          </div>
        }
      >
        <p class={styles.keys}>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move · <Kbd>A</Kbd> accept · <Kbd>R</Kbd> reject · <Kbd>Enter</Kbd> open
        </p>
        <ol class={styles.list}>
          <For each={proposals()}>{(f) => <Proposal feature={f} />}</For>
        </ol>
      </Show>
    </Sheet>
  );
}

function Proposal(props: { feature: Feature }): JSX.Element {
  const f = () => props.feature;
  const [into, setInto] = createSignal(f().versionId);
  return (
    <li
      class={styles.item}
      data-feature={f().id}
      aria-current={selected() === f().id ? "true" : undefined}
      tabindex={selected() === f().id ? 0 : -1}
      onFocusIn={() => setSelected(f().id)}
    >
      <div class={styles.itemHead}>
        <h3 class={styles.itemTitle}>{f().title}</h3>
        <span class={styles.when} title={f().createdAt}>
          {ago(f().createdAt)}
        </span>
      </div>
      <p class={styles.meta}>
        <AreaDot area={f().area} />
        {areaName(f().area)}
        <span>·</span>#{f().id}
      </p>
      <Show when={f().description.trim()}>
        <Markdown source={f().description} class={styles.description} />
      </Show>
      <div class={styles.actions}>
        <label class={styles.into}>
          <span>Into</span>
          <select
            class={styles.select}
            aria-label={`Version for ${f().title}`}
            value={String(into())}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setInto(Number(event.currentTarget.value))}
          >
            <For each={data.versions}>{(v) => <option value={String(v.id)}>{v.name}</option>}</For>
          </select>
        </label>
        <Button
          variant="good"
          size="sm"
          icon="check"
          onClick={(event) => {
            event.stopPropagation();
            void accept(f().id, into());
          }}
        >
          Accept
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="x"
          onClick={(event) => {
            event.stopPropagation();
            void reject(f().id);
          }}
        >
          Reject
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="arrowRight"
          onClick={(event) => {
            event.stopPropagation();
            openFeature(f().id);
          }}
        >
          Open
        </Button>
      </div>
    </li>
  );
}
