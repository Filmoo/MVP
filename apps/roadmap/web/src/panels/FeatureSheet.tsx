import { createEffect, createResource, createSignal, For, type JSX, on, Show } from "solid-js";
import { api } from "../api";
import { ago, day } from "../lib/format";
import { data, feature, me, put, setData, version } from "../state/data";
import { accept, edit, failed, move, reject, remove, restore, setStatus } from "../state/ops";
import { openFeature } from "../state/route";
import { toast } from "../state/toasts";
import { titleEdit } from "../state/ui";
import { type Feature, STATUS_LABEL, STATUSES, type Status } from "../types";
import { Button } from "../ui/Button";
import { AreaDot, Avatar, ClaudeBadge, StatusGlyph } from "../ui/Glyphs";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Layers";
import { Markdown } from "../ui/Markdown";
import styles from "./FeatureSheet.module.css";

/** What a link points at, from its address. */
function linkIcon(url: string): IconName {
  if (/\/commit\/[0-9a-f]{6,}/i.test(url)) return "commit";
  if (/\/pull\/\d+/.test(url)) return "pull";
  if (/\/(blob|tree)\/|\.md(#|$)/.test(url)) return "doc";
  return "link";
}

function linkText(url: string, label: string): string {
  if (label) return label;
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/^github\.com\/Filmoo\/MVP\//, "");
}

export function FeatureSheet(props: { id: number }): JSX.Element {
  const f = () => feature(props.id);
  const owner = () => me()?.kind === "owner";
  const [detail, { refetch }] = createResource(
    () => (props.id > 0 ? props.id : null),
    (id) => api.feature(id).catch(() => null),
  );
  // Refresh the history when the feature changes (status, move, edit): two changes in one
  // second keep the same `updatedAt`, so the fields themselves are watched too.
  const changes = () => {
    const x = f();
    return x
      ? [
          x.updatedAt,
          x.status,
          x.versionId,
          x.position,
          x.title,
          x.area,
          x.description.length,
          x.links.length,
          x.comments,
          x.removedAt,
        ].join("|")
      : "";
  };
  createEffect(on(changes, () => void refetch(), { defer: true }));

  return (
    <Show
      when={f()}
      fallback={
        <Sheet label="Feature" head={<h2 class={styles.title}>Not found</h2>} onClose={() => openFeature(null)}>
          <p class={styles.muted}>This feature doesn't exist (any more).</p>
        </Sheet>
      }
    >
      {(current) => (
        <Sheet
          label={current().title}
          testId="feature-sheet"
          onClose={() => openFeature(null)}
          head={<Head feature={current()} owner={owner()} />}
        >
          <Show when={current().removedAt}>
            <div class={styles.removed}>
              <Icon name="trash" />
              <span>Removed {ago(current().removedAt ?? "")}.</span>
              <Show when={owner()}>
                <Button size="sm" variant="secondary" icon="undo" onClick={() => void restore(current().id)}>
                  Restore
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={current().status === "proposed" && owner() && !current().removedAt}>
            <div class={styles.decide}>
              <p>
                <strong>{current().proposedBy === "claude" ? "Claude proposes this." : "A proposal."}</strong> Accept it into{" "}
                {version(current().versionId)?.name}, or reject it.
              </p>
              <div class={styles.decideButtons}>
                <Button variant="good" icon="check" kbd="A" onClick={() => void accept(current().id)}>
                  Accept
                </Button>
                <Button variant="secondary" icon="x" kbd="R" onClick={() => void reject(current().id)}>
                  Reject
                </Button>
              </div>
            </div>
          </Show>
          <Fields feature={current()} owner={owner()} />
          <Description feature={current()} owner={owner()} />
          <Links feature={current()} owner={owner()} onChange={() => void refetch()} />
          <section class={styles.section} aria-label="Comments">
            <h3 class={styles.heading}>
              Comments <span class={styles.count}>{detail()?.comments.length ?? current().comments}</span>
            </h3>
            <For each={detail()?.comments ?? []}>
              {(comment) => (
                <article class={styles.comment}>
                  <Avatar name={comment.author.name} kind={comment.author.kind} size={24} />
                  <div class={styles.commentBody}>
                    <p class={styles.commentHead}>
                      <strong>{comment.author.kind === "claude" ? "Claude" : comment.author.name}</strong>
                      <span title={comment.createdAt}>{ago(comment.createdAt)}</span>
                    </p>
                    <Markdown source={comment.body} />
                  </div>
                </article>
              )}
            </For>
            <Show when={!current().removedAt}>
              <CommentBox
                id={current().id}
                onSent={() => {
                  void refetch();
                }}
              />
            </Show>
          </section>
          <section class={styles.section} aria-label="History">
            <h3 class={styles.heading}>History</h3>
            <ol class={styles.history}>
              <For
                each={[...(detail()?.activity ?? [])].reverse()}
                fallback={<li class={styles.muted}>{detail.loading ? "Loading…" : "Nothing changed since it was added."}</li>}
              >
                {(entry) => (
                  <li>
                    <span class={styles.historyWho} data-kind={entry.actor.kind}>
                      {entry.actor.kind === "claude" ? "Claude" : entry.actor.kind === "system" ? "Seed" : entry.actor.name}
                    </span>
                    <span class={styles.historyWhat}>{entry.summary}</span>
                    <span class={styles.historyWhen} title={entry.at}>
                      {ago(entry.at)}
                    </span>
                  </li>
                )}
              </For>
            </ol>
          </section>
          <Show when={owner() && !current().removedAt}>
            <div class={styles.footer}>
              <Button
                variant="danger"
                icon="trash"
                kbd="Del"
                onClick={() => void remove(current().id).then((ok) => ok && openFeature(null))}
              >
                Remove
              </Button>
            </div>
          </Show>
        </Sheet>
      )}
    </Show>
  );
}

function Head(props: { feature: Feature; owner: boolean }): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  createEffect(
    on(
      titleEdit,
      (asked) => {
        if (asked > 0 && props.owner) setEditing(true);
      },
      { defer: true },
    ),
  );
  const save = (input: HTMLInputElement) => {
    setEditing(false);
    const title = input.value.trim();
    if (title && title !== props.feature.title) void edit(props.feature.id, { title });
  };
  return (
    <div class={styles.head}>
      <p class={styles.eyebrow}>
        <StatusGlyph status={props.feature.status} />
        {STATUS_LABEL[props.feature.status]}
        <span class={styles.dotSep}>·</span>#{props.feature.id}
        <Show when={props.feature.proposedBy === "claude"}>
          <ClaudeBadge />
        </Show>
      </p>
      <Show
        when={editing()}
        fallback={
          <h2 class={styles.title}>
            <Show when={props.owner} fallback={props.feature.title}>
              <button type="button" class={styles.titleButton} title="Rename (E)" onClick={() => setEditing(true)}>
                {props.feature.title}
              </button>
            </Show>
          </h2>
        }
      >
        <input
          class={styles.titleInput}
          value={props.feature.title}
          aria-label="Title"
          maxLength={200}
          ref={(input) => queueMicrotask(() => input.select())}
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
    </div>
  );
}

function Fields(props: { feature: Feature; owner: boolean }): JSX.Element {
  const f = () => props.feature;
  const locked = () => !props.owner || f().removedAt !== null;
  const [newArea, setNewArea] = createSignal(false);
  return (
    <dl class={styles.fields}>
      <dt class={styles.wideLabel}>Status</dt>
      <dd class={styles.wide}>
        <div class={styles.statuses} role="radiogroup" aria-label="Status">
          <For each={STATUSES}>
            {(status: Status) => (
              // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA radio group of buttons, like the app's Segmented control
              <button
                type="button"
                role="radio"
                class={styles.status}
                aria-checked={f().status === status}
                disabled={locked()}
                onClick={() => void setStatus(f().id, status)}
              >
                <StatusGlyph status={status} size={12} />
                {STATUS_LABEL[status]}
              </button>
            )}
          </For>
        </div>
      </dd>
      <dt>Version</dt>
      <dd>
        <select
          class={styles.select}
          aria-label="Version"
          disabled={locked()}
          value={String(f().versionId)}
          onChange={(event) => {
            const to = Number(event.currentTarget.value);
            if (to !== f().versionId) void move(f().id, to, null);
          }}
        >
          <For each={data.versions}>{(v) => <option value={String(v.id)}>{v.name}</option>}</For>
        </select>
      </dd>
      <dt class={styles.areaLabel}>
        <AreaDot area={f().area} />
        Area
      </dt>
      <dd class={styles.areaField}>
        <Show
          when={newArea()}
          fallback={
            <select
              class={styles.select}
              aria-label="Area"
              disabled={locked()}
              value={f().area}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "__new") {
                  event.currentTarget.value = f().area;
                  setNewArea(true);
                } else void edit(f().id, { area: value });
              }}
            >
              <For each={data.areas}>{(a) => <option value={a.key}>{a.name}</option>}</For>
              <option value="__new">New area…</option>
            </select>
          }
        >
          <input
            class={styles.input}
            placeholder="Area name"
            aria-label="New area"
            ref={(input) => queueMicrotask(() => input.focus())}
            onKeyDown={async (event) => {
              event.stopPropagation();
              if (event.key === "Escape") setNewArea(false);
              if (event.key === "Enter") {
                const name = event.currentTarget.value.trim();
                setNewArea(false);
                if (!name) return;
                try {
                  const created = await api.createArea(name);
                  setData("areas", (all) => [...all, created]);
                  void edit(f().id, { area: created.key });
                } catch (error) {
                  failed(`add the area ${name}`, error);
                }
              }
            }}
            onBlur={() => setNewArea(false)}
          />
        </Show>
      </dd>
      <dt>Dates</dt>
      <dd class={styles.dates}>
        <span>Added {day(f().createdAt)}</span>
        <Show when={f().startedAt}>{(at) => <span>Started {day(at())}</span>}</Show>
        <Show when={f().doneAt}>{(at) => <span>Done {day(at())}</span>}</Show>
        <span title={f().updatedAt}>Changed {ago(f().updatedAt)}</span>
      </dd>
    </dl>
  );
}

function Description(props: { feature: Feature; owner: boolean }): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  let area: HTMLTextAreaElement | undefined;
  const save = () => {
    const text = area?.value ?? "";
    setEditing(false);
    if (text.trimEnd() !== props.feature.description) void edit(props.feature.id, { description: text });
  };
  return (
    <section class={styles.section} aria-label="Description">
      <h3 class={styles.heading}>
        Description
        <Show when={props.owner && !editing() && !props.feature.removedAt}>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </Show>
      </h3>
      <Show
        when={editing()}
        fallback={
          <Show when={props.feature.description.trim()} fallback={<p class={styles.muted}>No description yet.</p>}>
            <Markdown source={props.feature.description} />
          </Show>
        }
      >
        <textarea
          ref={(el) => {
            area = el;
            queueMicrotask(() => el.focus());
          }}
          class={styles.textarea}
          rows={8}
          aria-label="Description (markdown)"
          value={props.feature.description}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) save();
            if (event.key === "Escape") setEditing(false);
          }}
        />
        <div class={styles.formButtons}>
          <span class={styles.muted}>Markdown · Ctrl+Enter saves</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </Show>
    </section>
  );
}

function Links(props: { feature: Feature; owner: boolean; onChange: () => void }): JSX.Element {
  const [adding, setAdding] = createSignal(false);
  let url: HTMLInputElement | undefined;
  let label: HTMLInputElement | undefined;
  const add = async () => {
    const address = url?.value.trim() ?? "";
    if (!address) return;
    try {
      const link = await api.link(props.feature.id, address, label?.value.trim() ?? "");
      put({ ...props.feature, links: [...props.feature.links, link] });
      setAdding(false);
      props.onChange();
    } catch (error) {
      failed("add the link", error);
    }
  };
  const unlink = async (id: number) => {
    const before = props.feature.links;
    put({ ...props.feature, links: before.filter((l) => l.id !== id) });
    try {
      await api.unlink(props.feature.id, id);
      toast("Link removed");
      props.onChange();
    } catch (error) {
      put({ ...props.feature, links: before });
      failed("remove the link", error);
    }
  };
  return (
    <section class={styles.section} aria-label="Links">
      <h3 class={styles.heading}>
        Links <span class={styles.count}>{props.feature.links.length}</span>
        <Show when={props.owner && !adding() && !props.feature.removedAt}>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
            Link
          </Button>
        </Show>
      </h3>
      <ul class={styles.links}>
        <For each={props.feature.links} fallback={<li class={styles.muted}>No commit, pull request or doc linked yet.</li>}>
          {(link) => (
            <li class={styles.link}>
              <Icon name={linkIcon(link.url)} />
              <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                {linkText(link.url, link.label)}
              </a>
              <Show when={props.owner}>
                <Button
                  size="sm"
                  variant="ghost"
                  square
                  icon="close"
                  aria-label={`Remove the link ${link.label || link.url}`}
                  onClick={() => void unlink(link.id)}
                />
              </Show>
            </li>
          )}
        </For>
      </ul>
      <Show when={adding()}>
        <form
          class={styles.linkForm}
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") setAdding(false);
          }}
        >
          <input
            ref={(el) => {
              url = el;
              queueMicrotask(() => el.focus());
            }}
            class={styles.input}
            type="url"
            placeholder="https://github.com/Filmoo/MVP/commit/…"
            aria-label="Link address"
            required
          />
          <input ref={label} class={styles.input} placeholder="Label (optional)" aria-label="Link label" />
          <div class={styles.formButtons}>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit">
              Add link
            </Button>
          </div>
        </form>
      </Show>
    </section>
  );
}

function CommentBox(props: { id: number; onSent: () => void }): JSX.Element {
  const [sending, setSending] = createSignal(false);
  let box: HTMLTextAreaElement | undefined;
  const send = async () => {
    const body = box?.value.trim() ?? "";
    if (!body || sending()) return;
    setSending(true);
    try {
      await api.comment(props.id, body);
      if (box) box.value = "";
      const current = feature(props.id);
      if (current) put({ ...current, comments: current.comments + 1 });
      props.onSent();
    } catch (error) {
      failed("send the comment", error);
    } finally {
      setSending(false);
    }
  };
  return (
    <div class={styles.commentBox}>
      <textarea
        ref={box}
        class={styles.textarea}
        rows={2}
        placeholder="Write a comment (markdown)"
        aria-label="Comment"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void send();
          if (event.key === "Escape") event.currentTarget.blur();
        }}
      />
      <div class={styles.formButtons}>
        <span class={styles.muted}>Ctrl+Enter sends</span>
        <Button size="sm" variant="primary" icon="comment" disabled={sending()} onClick={() => void send()}>
          Comment
        </Button>
      </div>
    </div>
  );
}
