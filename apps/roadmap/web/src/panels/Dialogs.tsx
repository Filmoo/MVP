import { createSignal, For, type JSX } from "solid-js";
import { currentVersion, data, version } from "../state/data";
import { create } from "../state/ops";
import { openFeature } from "../state/route";
import { setOverlay, setSelected } from "../state/ui";
import { createVersion, updateVersion } from "../state/versions";
import type { Status } from "../types";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Glyphs";
import { Modal } from "../ui/Layers";
import styles from "./Dialogs.module.css";

/** A new feature: title first, everything else has a sensible default. */
export function CreateDialog(props: { versionId: number | null; status: "proposed" | null }): JSX.Element {
  const [title, setTitle] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [versionId, setVersionId] = createSignal(props.versionId ?? currentVersion()?.id ?? data.versions[0]?.id ?? 0);
  const [area, setArea] = createSignal(data.areas[0]?.key ?? "");
  const [status, setStatus] = createSignal<Status>(props.status ?? "accepted");
  const [description, setDescription] = createSignal("");
  const [another, setAnother] = createSignal(false);
  let titleInput: HTMLInputElement | undefined;

  const submit = async () => {
    if (!title().trim() || busy()) return;
    setBusy(true);
    const created = await create({ title: title(), description: description(), versionId: versionId(), area: area(), status: status() });
    setBusy(false);
    if (!created) return;
    if (another()) {
      setTitle("");
      setDescription("");
      titleInput?.focus();
    } else {
      setOverlay(null);
      setSelected(created.id);
      openFeature(created.id);
    }
  };

  return (
    <Modal label="New feature" onClose={() => setOverlay(null)}>
      <form
        class={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 class={styles.title}>New feature</h2>
        <input
          ref={(el) => {
            titleInput = el;
            queueMicrotask(() => el.focus());
          }}
          class={styles.titleInput}
          placeholder="What should MVP do?"
          aria-label="Title"
          maxLength={200}
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <div class={styles.row}>
          <label class={styles.field}>
            <span>Version</span>
            <select value={String(versionId())} onChange={(event) => setVersionId(Number(event.currentTarget.value))}>
              <For each={data.versions}>{(v) => <option value={String(v.id)}>{v.name}</option>}</For>
            </select>
          </label>
          <label class={styles.field}>
            <span>Area</span>
            <select value={area()} onChange={(event) => setArea(event.currentTarget.value)}>
              <For each={data.areas}>{(a) => <option value={a.key}>{a.name}</option>}</For>
            </select>
          </label>
          <label class={styles.field}>
            <span>Status</span>
            <select value={status()} onChange={(event) => setStatus(event.currentTarget.value as Status)}>
              <option value="accepted">Accepted</option>
              <option value="proposed">Proposed</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </label>
        </div>
        <textarea
          class={styles.textarea}
          rows={4}
          placeholder="Description (markdown, optional)"
          aria-label="Description"
          value={description()}
          onInput={(event) => setDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div class={styles.buttons}>
          <label class={styles.check}>
            <input type="checkbox" checked={another()} onChange={(event) => setAnother(event.currentTarget.checked)} />
            Add another
          </label>
          <span class={styles.hint}>
            <Kbd>Enter</Kbd> adds
          </span>
          <Button variant="ghost" onClick={() => setOverlay(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!title().trim() || busy()}>
            Add to {version(versionId())?.name ?? "the roadmap"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** A version's name, goal and dates. */
export function VersionDialog(props: { versionId: number | null }): JSX.Element {
  const existing = () => (props.versionId === null ? undefined : version(props.versionId));
  const [name, setName] = createSignal(existing()?.name ?? "");
  const [goal, setGoal] = createSignal(existing()?.goal ?? "");
  const [target, setTarget] = createSignal(existing()?.targetDate ?? "");
  const [released, setReleased] = createSignal(existing()?.releasedOn ?? "");
  const [busy, setBusy] = createSignal(false);
  const submit = async () => {
    if (!name().trim() || busy()) return;
    setBusy(true);
    const fields = { name: name().trim(), goal: goal().trim(), targetDate: target() || null, releasedOn: released() || null };
    const saved = existing() ? await updateVersion(existing()?.id ?? 0, fields) : await createVersion(fields);
    setBusy(false);
    if (saved) setOverlay(null);
  };
  return (
    <Modal label={existing() ? "Edit version" : "New version"} onClose={() => setOverlay(null)}>
      <form
        class={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 class={styles.title}>{existing() ? `Version ${existing()?.name}` : "New version"}</h2>
        <label class={styles.field}>
          <span>Name</span>
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            class={styles.input}
            placeholder="0.5"
            maxLength={40}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label class={styles.field}>
          <span>Goal</span>
          <textarea
            class={styles.textarea}
            rows={2}
            maxLength={500}
            value={goal()}
            onInput={(event) => setGoal(event.currentTarget.value)}
          />
        </label>
        <div class={styles.row}>
          <label class={styles.field}>
            <span>Target date</span>
            <input class={styles.input} type="date" value={target()} onInput={(event) => setTarget(event.currentTarget.value)} />
          </label>
          <label class={styles.field}>
            <span>Released on</span>
            <input class={styles.input} type="date" value={released()} onInput={(event) => setReleased(event.currentTarget.value)} />
          </label>
        </div>
        <div class={styles.buttons}>
          <Button variant="ghost" onClick={() => setOverlay(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name().trim() || busy()}>
            {existing() ? "Save" : "Add version"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl K", "Command palette"],
  ["/", "Search"],
  ["N", "New feature"],
  ["1 · 2 · 3", "Board, Roadmap, List"],
  ["I", "Claude's proposals"],
  ["← ↑ → ↓ or H J K L", "Move between features"],
  ["Enter", "Open the feature"],
  ["E", "Rename it"],
  ["A · R", "Accept, reject a proposal"],
  ["S · D", "Mark in progress, done"],
  ["Alt + ← →", "Move to the previous, next version"],
  ["Alt + ↑ ↓", "Move up, down in its lane"],
  ["M", "Move to a version…"],
  ["Delete", "Remove (undo with Ctrl Z)"],
  ["Ctrl Z", "Undo the last change"],
  ["Esc", "Close, then clear the selection"],
];

export function ShortcutsDialog(): JSX.Element {
  return (
    <Modal label="Keyboard shortcuts" onClose={() => setOverlay(null)}>
      <div class={styles.form}>
        <h2 class={styles.title}>Keyboard shortcuts</h2>
        <dl class={styles.keys}>
          <For each={SHORTCUTS}>
            {([keys, what]) => (
              <>
                <dt>
                  <Kbd>{keys}</Kbd>
                </dt>
                <dd>{what}</dd>
              </>
            )}
          </For>
        </dl>
        <p class={styles.hint}>Shortcuts wait while you type in a field.</p>
      </div>
    </Modal>
  );
}
