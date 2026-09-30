import { type JSX, Show } from "solid-js";
import { t } from "../i18n";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import styles from "./States.module.css";

/** `heading`: the state is the whole page, so its title is the page's h1. */
function Title(props: { heading?: boolean | undefined; children: string }): JSX.Element {
  return (
    <Show when={props.heading} fallback={<p class={styles.title}>{props.children}</p>}>
      <h1 class={styles.title}>{props.children}</h1>
    </Show>
  );
}

export function EmptyState(props: {
  icon: IconName;
  title: string;
  text?: string;
  action?: JSX.Element;
  heading?: boolean;
  /** A drawing instead of the icon (the penguin, where waiting or emptiness can be friendly). */
  art?: JSX.Element;
}): JSX.Element {
  return (
    <div class={styles.state} data-state="empty">
      <Show
        when={props.art}
        fallback={
          <div class={styles.icon}>
            <Icon name={props.icon} size={24} />
          </div>
        }
      >
        <div class={styles.art}>{props.art}</div>
      </Show>
      <Title heading={props.heading}>{props.title}</Title>
      <Show when={props.text}>
        <p class={styles.text}>{props.text}</p>
      </Show>
      <Show when={props.action}>
        <div class={styles.action}>{props.action}</div>
      </Show>
    </div>
  );
}

export function ErrorState(props: { title?: string; message: string; onRetry?: () => void; heading?: boolean }): JSX.Element {
  return (
    <div class={`${styles.state} ${styles.error}`} data-state="error" role="alert">
      <div class={styles.icon}>
        <Icon name="alert" size={24} />
      </div>
      <Title heading={props.heading}>{props.title ?? t().common.somethingWrong}</Title>
      <p class={styles.text}>{props.message}</p>
      <Show when={props.onRetry}>
        <div class={styles.action}>
          <Button onClick={() => props.onRetry?.()}>
            <Icon name="refresh" size={16} />
            {t().common.tryAgain}
          </Button>
        </div>
      </Show>
    </div>
  );
}

/** Placeholder block with the exact size of the content it stands for (no layout jump). */
export function Skeleton(props: { width?: string; height: string; radius?: "full" }): JSX.Element {
  return (
    <div
      class={styles.skeleton}
      data-state="loading"
      style={{
        width: props.width ?? "100%",
        height: props.height,
        ...(props.radius === "full" ? { "border-radius": "var(--radius-full)" } : {}),
      }}
    />
  );
}
