import { createResource, createSignal, For, type JSX, Show } from "solid-js";
import { api } from "../api";
import { ago } from "../lib/format";
import { failed } from "../state/ops";
import { go, openFeature } from "../state/route";
import type { AuditEntry } from "../types";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Glyphs";
import { Sheet } from "../ui/Layers";
import styles from "./Activity.module.css";

const WHO: Record<string, string> = { claude: "Claude", system: "The server" };

/** The audit log: every change, who made it and when, newest first. */
export function Activity(): JSX.Element {
  const [older, setOlder] = createSignal<AuditEntry[]>([]);
  const [next, setNext] = createSignal<number | null>(null);
  const [first] = createResource(async () => {
    const page = await api.audit();
    setNext(page.next);
    return page.entries;
  });
  const more = async () => {
    const before = next();
    if (before === null) return;
    try {
      const page = await api.audit(before);
      setOlder((all) => [...all, ...page.entries]);
      setNext(page.next);
    } catch (error) {
      failed("load older entries", error);
    }
  };
  return (
    <Sheet
      label="Activity log"
      testId="activity"
      onClose={() => go({ panel: null })}
      head={
        <div>
          <h2 class={styles.title}>Activity</h2>
          <p class={styles.sub}>Every change, sign-in and token, as the server logged it.</p>
        </div>
      }
    >
      <Show when={!first.error} fallback={<p class={styles.sub}>The log didn't load: {String(first.error)}</p>}>
        <ol class={styles.list}>
          <For each={[...(first() ?? []), ...older()]} fallback={<li class={styles.sub}>Loading…</li>}>
            {(entry) => (
              <li class={styles.entry}>
                <Avatar name={entry.actor.name} kind={entry.actor.kind} size={26} />
                <div class={styles.body}>
                  <p class={styles.line}>
                    <strong data-kind={entry.actor.kind}>{WHO[entry.actor.kind] ?? entry.actor.name}</strong>{" "}
                    <Show when={entry.featureId !== null} fallback={<span>{entry.summary}</span>}>
                      <button type="button" class={styles.link} onClick={() => openFeature(entry.featureId)}>
                        {entry.summary}
                      </button>
                    </Show>
                  </p>
                  <p class={styles.meta}>
                    <span title={entry.at}>{ago(entry.at)}</span> · <code>{entry.action}</code>
                  </p>
                </div>
              </li>
            )}
          </For>
        </ol>
        <Show when={next() !== null}>
          <div class={styles.more}>
            <Button size="sm" variant="secondary" onClick={() => void more()}>
              Older entries
            </Button>
          </div>
        </Show>
      </Show>
    </Sheet>
  );
}
