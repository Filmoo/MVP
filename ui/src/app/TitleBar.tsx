import { type JSX, Show } from "solid-js";
import type { ClientStatus } from "../data/generated/ClientStatus";
import { Icon } from "../design/Icon";
import { Wordmark } from "../design/Logo";
import { liquid } from "../design/liquid/liquid";
import { Search } from "./search/Search";
import styles from "./TitleBar.module.css";

const statusText: Record<ClientStatus["connection"], string> = {
  connected: "League client connected",
  connecting: "Connecting to League…",
  notRunning: "Waiting for League client",
};

async function windowAction(action: "minimize" | "toggleMaximize" | "close") {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

export function TitleBar(props: { status: ClientStatus | undefined; native: boolean }): JSX.Element {
  const connection = () => props.status?.connection ?? "notRunning";
  return (
    <header class={styles.bar} data-tauri-drag-region>
      <div class={styles.glass} aria-hidden="true" ref={(el) => liquid(el, "bar")} />
      <div class={styles.brand}>
        <Wordmark height={24} />
      </div>
      <div class={styles.center} data-tauri-drag-region>
        <Search />
      </div>
      <div class={styles.status} data-testid="client-status" title={statusText[connection()]}>
        <span class={`${styles.dot} ${styles[connection()] ?? ""}`} />
        <span class={styles.statusText}>{statusText[connection()]}</span>
      </div>
      <Show when={props.native} fallback={<div style={{ width: "var(--space-6)" }} />}>
        <div class={styles.controls}>
          <button class={styles.control} type="button" aria-label="Minimize" onClick={() => void windowAction("minimize")}>
            <Icon name="minimize" size={16} />
          </button>
          <button class={styles.control} type="button" aria-label="Maximize" onClick={() => void windowAction("toggleMaximize")}>
            <Icon name="maximize" size={14} />
          </button>
          <button class={`${styles.control} ${styles.close}`} type="button" aria-label="Close" onClick={() => void windowAction("close")}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </Show>
    </header>
  );
}
