import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Button } from "./Button";
import styles from "./Layers.module.css";

export { styles as layers };

/** A panel on the right (full screen on phones); Escape is handled by the page's keys. */
export function Sheet(props: {
  label: string;
  head: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
  testId?: string;
}): JSX.Element {
  return (
    <aside class={styles.sheet} aria-label={props.label} data-testid={props.testId}>
      <header class={styles.sheetHead}>
        <div class={styles.sheetTitle}>{props.head}</div>
        <Button variant="ghost" square icon="close" aria-label="Close" title="Close (Esc)" onClick={() => props.onClose()} />
      </header>
      <div class={styles.sheetBody}>{props.children}</div>
    </aside>
  );
}

/** A centered dialog over a dimmed page; a click outside or Escape closes it. */
export function Modal(props: { label: string; onClose: () => void; children: JSX.Element; class?: string | undefined }): JSX.Element {
  let scrim: HTMLDivElement | undefined;
  let dialog: HTMLDivElement | undefined;
  // The keyboard goes into the dialog (a field inside may take it right after).
  onMount(() => dialog?.focus({ preventScroll: true }));
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop: a click outside or Escape anywhere in the dialog closes it
    <div
      ref={scrim}
      class={styles.scrim}
      onPointerDown={(event) => {
        if (event.target === scrim) props.onClose();
      }}
      onKeyDown={keys}
    >
      <div
        ref={dialog}
        class={`${styles.modal} ${props.class ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabindex="-1"
      >
        {props.children}
      </div>
    </div>
  );
}

/** A button that opens a small panel; the panel closes on a click outside or Escape. */
export function Dropdown(props: {
  trigger: (open: () => boolean, toggle: () => void) => JSX.Element;
  children: (close: () => void) => JSX.Element;
  align?: "start" | "end";
  label: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let root: HTMLSpanElement | undefined;
  const close = () => {
    setOpen(false);
    watch(false);
  };
  const outside = (event: PointerEvent) => {
    if (root && !root.contains(event.target as Node)) close();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open()) {
      event.stopPropagation();
      close();
      root?.querySelector("button")?.focus();
    }
  };
  // Listeners live only while the panel is open.
  const watch = (on: boolean) => {
    if (on) document.addEventListener("pointerdown", outside, true);
    else document.removeEventListener("pointerdown", outside, true);
  };
  onCleanup(() => watch(false));
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape from anywhere in the menu closes it
    <span ref={root} class={styles.dropdown} onKeyDown={onEscape}>
      {props.trigger(open, () => {
        const next = !open();
        setOpen(next);
        watch(next);
      })}
      <Show when={open()}>
        <PanelFocus>
          <div class={styles.panel} data-align={props.align ?? "start"} role="menu" aria-label={props.label}>
            {props.children(close)}
          </div>
        </PanelFocus>
      </Show>
    </span>
  );
}

/** Moves the focus into a panel that just opened. */
function PanelFocus(props: { children: JSX.Element }): JSX.Element {
  let box: HTMLDivElement | undefined;
  onMount(() => box?.querySelector<HTMLElement>("[role=menuitemcheckbox], [role=menuitem], button, input")?.focus());
  return <div ref={box}>{props.children}</div>;
}
