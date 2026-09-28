import { type JSX, Show } from "solid-js";
import type { ClientStatus } from "../data/generated/ClientStatus";
import { Icon } from "../design/Icon";
import { Wordmark } from "../design/Logo";
import { liquid } from "../design/liquid/liquid";
import { t } from "../i18n";
import { Search } from "./search/Search";
import styles from "./TitleBar.module.css";

/** The label Tauri gives this window (what `getCurrentWindow()` reads). */
interface TauriInternals {
  __TAURI_INTERNALS__: { metadata: { currentWindow: { label: string } } };
}

/**
 * The window buttons send the same commands as `@tauri-apps/api/window`, without its window
 * class (3 KB of methods the app never calls; a class can't be tree-shaken).
 */
async function windowAction(action: "minimize" | "toggle_maximize" | "close") {
  const { invoke } = await import("@tauri-apps/api/core");
  const label = (window as unknown as TauriInternals).__TAURI_INTERNALS__.metadata.currentWindow.label;
  await invoke(`plugin:window|${action}`, { label });
}

export function TitleBar(props: { status: ClientStatus | undefined; native: boolean }): JSX.Element {
  const connection = () => props.status?.connection ?? "notRunning";
  const statusText = () => t().shell.connection[connection()];
  return (
    <header class={styles.bar} data-tauri-drag-region>
      <div class={styles.glass} aria-hidden="true" ref={(el) => liquid(el, "bar")} />
      <div class={styles.brand}>
        <Wordmark height={24} />
      </div>
      <div class={styles.center} data-tauri-drag-region>
        <Search />
      </div>
      <div class={styles.status} data-testid="client-status" title={statusText()}>
        <span class={`${styles.dot} ${styles[connection()] ?? ""}`} />
        <span class={styles.statusText}>{statusText()}</span>
      </div>
      <Show when={props.native} fallback={<div style={{ width: "var(--space-6)" }} />}>
        <div class={styles.controls}>
          <button class={styles.control} type="button" aria-label={t().shell.minimize} onClick={() => void windowAction("minimize")}>
            <Icon name="minimize" size={16} />
          </button>
          <button class={styles.control} type="button" aria-label={t().shell.maximize} onClick={() => void windowAction("toggle_maximize")}>
            <Icon name="maximize" size={14} />
          </button>
          <button
            class={`${styles.control} ${styles.close}`}
            type="button"
            aria-label={t().shell.close}
            onClick={() => void windowAction("close")}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </Show>
    </header>
  );
}
