import { For, type JSX, Show } from "solid-js";
import { dismiss, toasts } from "../state/toasts";
import { Icon } from "../ui/Icon";
import styles from "./Toasts.module.css";

export function Toasts(): JSX.Element {
  return (
    <div class={styles.stack} aria-live="polite" role="status">
      <For each={toasts()}>
        {(toast) => (
          <div class={styles.toast} data-tone={toast.tone}>
            <Show when={toast.tone === "error"}>
              <Icon name="x" class={styles.errorIcon} />
            </Show>
            <span class={styles.text}>{toast.text}</span>
            <Show when={toast.action}>
              {(action) => (
                <button
                  type="button"
                  class={styles.action}
                  onClick={() => {
                    dismiss(toast.id);
                    action().run();
                  }}
                >
                  <Icon name="undo" size={14} />
                  {action().label}
                </button>
              )}
            </Show>
            <button type="button" class={styles.close} aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
