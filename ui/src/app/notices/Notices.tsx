import { For, type JSX, onMount, Show } from "solid-js";
import type { Banner } from "../../data/generated/Banner";
import type { UpdateStatus } from "../../data/generated/UpdateStatus";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { requiredStep } from "../../lib/updates";
import { Widget } from "../../widgets/Widget";
import styles from "./Notices.module.css";

/**
 * What `app/Banners.tsx` shows when there is something to say, loaded only then (most sessions
 * never need it): server notices, the "Update ready — Restart" prompt, the "update required" card.
 */

export type Ready = Extract<UpdateStatus, { state: "ready" }>;

/** One notice: patch day, service issues, maintenance. English until the French UI lands. */
function Notice(props: { banner: Banner; onDismiss: (id: string) => void; onOpen: (id: string) => void }): JSX.Element {
  return (
    <li class={`${styles.banner} ${styles[props.banner.severity]}`} data-testid="banner" data-severity={props.banner.severity} data-refract>
      <Icon name={props.banner.severity === "warn" ? "alert" : "info"} size={16} class={styles.icon} />
      <p class={styles.text}>{props.banner.text.en}</p>
      <Show when={props.banner.link}>
        <button type="button" class={styles.link} onClick={() => props.onOpen(props.banner.id)}>
          More info
        </button>
      </Show>
      <Show when={props.banner.dismissible}>
        <button type="button" class={styles.close} aria-label="Dismiss" onClick={() => props.onDismiss(props.banner.id)}>
          <Icon name="close" size={14} />
        </button>
      </Show>
    </li>
  );
}

/** "Update ready — Restart": never forced, never shown during a game. */
function UpdateReady(props: { update: Ready; onRestart: () => void; onLater: () => void }): JSX.Element {
  return (
    <li class={`${styles.banner} ${styles.update}`} data-testid="update-ready" data-refract>
      <Icon name="download" size={16} class={styles.icon} />
      <p class={styles.text}>
        <strong class={styles.strong}>{props.update.mandatory ? "Important update ready" : "Update ready"}</strong>
        {" — "}
        <span class="num">MVP {props.update.version}</span> installs when you restart, or when you quit.
      </p>
      <Button variant="primary" onClick={props.onRestart} testId="update-restart">
        Restart
      </Button>
      <Show when={!props.update.mandatory}>
        <button type="button" class={styles.close} aria-label="Later" onClick={() => props.onLater()}>
          <Icon name="close" size={14} />
        </button>
      </Show>
    </li>
  );
}

export interface NoticeListProps {
  banners: readonly Banner[];
  ready: Ready | undefined;
  onDismiss: (id: string) => void;
  onOpen: (id: string) => void;
  onRestart: () => void;
  onLater: () => void;
}

/** The notices strip at the top of the page (also measured alone by the perf suite). */
export function NoticeList(props: NoticeListProps): JSX.Element {
  return (
    <ul class={styles.list} aria-label="Notices" aria-live="polite">
      <Show when={props.ready}>{(ready) => <UpdateReady update={ready()} onRestart={props.onRestart} onLater={props.onLater} />}</Show>
      <For each={props.banners}>{(banner) => <Notice banner={banner} onDismiss={props.onDismiss} onOpen={props.onOpen} />}</For>
    </ul>
  );
}

export function NoticesStrip(props: NoticeListProps): JSX.Element {
  return (
    <Widget name="banners" class={styles.strip}>
      <NoticeList {...props} />
    </Widget>
  );
}

export interface UpdateRequiredProps {
  message: string;
  update: UpdateStatus;
  inGame: boolean;
  onRestart: () => void;
  onCheck: () => void;
}

/**
 * This version is no longer supported: the app waits politely behind this until the player
 * updates. The title bar stays usable (move, minimize, close).
 */
export function UpdateRequiredDialog(props: UpdateRequiredProps): JSX.Element {
  let root: HTMLDivElement | undefined;
  // Keyboard users land on the way out.
  onMount(() => root?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
  const step = () => requiredStep(props.update, props.inGame);
  return (
    <div ref={root} class={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="update-required-title">
      <Card class={styles.dialogCard}>
        <div class={styles.dialogBody} data-testid="update-required">
          <div class={styles.dialogIcon}>
            <Icon name="download" size={24} />
          </div>
          <h2 class={styles.dialogTitle} id="update-required-title">
            Update MVP to keep going
          </h2>
          <p class={styles.dialogText}>{props.message}</p>
          <Show when={step().text}>
            <p class={styles.dialogStatus} data-testid="update-required-status">
              {step().text}
            </p>
          </Show>
          <Show when={step().action}>
            {(action) => (
              <div class={styles.dialogAction}>
                <Button
                  variant={action() === "restart" ? "primary" : "secondary"}
                  onClick={action() === "restart" ? props.onRestart : props.onCheck}
                  testId={`update-required-${action()}`}
                >
                  <Show when={action() === "check"}>
                    <Icon name="refresh" size={16} />
                  </Show>
                  {step().label}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </Card>
    </div>
  );
}

export function UpdateBlocker(props: UpdateRequiredProps): JSX.Element {
  return (
    <Widget name="update-required" class={styles.blocker}>
      <UpdateRequiredDialog {...props} />
    </Widget>
  );
}
