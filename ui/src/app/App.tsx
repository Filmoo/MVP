import { createEffect, createResource, For, type JSX, lazy, Match, on, onCleanup, Suspense, Switch } from "solid-js";
import { useData } from "../data/context";
import { Icon } from "../design/Icon";
import { dismissIssue, issues, notify, reportError } from "../lib/errors";
import { Home } from "../views/home/Home";
import { Planned } from "../views/Planned";
import styles from "./App.module.css";
import { navigate, path } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const Settings = lazy(() => import("../views/settings/Settings"));
const Draft = lazy(() => import("../views/draft/Draft"));
const Live = lazy(() => import("../views/live/Live"));
const Player = lazy(() => import("../views/player/Player"));
const Champions = lazy(() => import("../views/champions/Champions"));
const Harness = lazy(() => import("../widgets/Harness"));

function Toasts(): JSX.Element {
  return (
    <div class={styles.toasts} aria-live="polite">
      <For each={issues()}>
        {(issue) => (
          <div class={`${styles.toast} ${styles[issue.tone]}`} role="status" data-testid="toast" data-tone={issue.tone}>
            <Icon name={issue.tone === "success" ? "check" : "alert"} size={16} class={styles.toastIcon} />
            <span>{issue.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismissIssue(issue.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

export function App(): JSX.Element {
  const { transport } = useData();
  const [status, { mutate }] = createResource(() =>
    transport.call("client_status").catch((error: unknown) => {
      reportError(error, "client_status");
      return undefined;
    }),
  );
  onCleanup(transport.listen("client-status", (next) => mutate(next)));

  // The core moves the UI along with the game. It hears about every view shown, so it never
  // switches away from a page the player opened themselves.
  onCleanup(transport.listen("navigate", (to) => navigate(to)));
  createEffect(
    on(path, (current) => {
      transport.call("view_changed", { path: current }).catch(() => {
        // Only a hint for the core: nothing to tell the player.
      });
    }),
  );
  onCleanup(
    transport.listen("auto-accept", (outcome) => {
      if (outcome.kind === "accepted") notify("Match accepted");
      else reportError(`Couldn't accept the match: ${outcome.message}`, "auto-accept");
    }),
  );

  return (
    <div class={styles.shell}>
      <TitleBar status={status()} native={transport.kind === "tauri"} />
      <Sidebar />
      <main class={styles.main} data-view={path()}>
        <Suspense>
          <Switch
            fallback={
              <Planned
                title="Page not found"
                icon="alert"
                stateTitle="Nothing here"
                description="This page doesn't exist. Pick a section in the menu."
              />
            }
          >
            <Match when={path() === "/"}>
              <Home />
            </Match>
            <Match when={path() === "/draft"}>
              <Draft />
            </Match>
            <Match when={path() === "/live"}>
              <Live />
            </Match>
            <Match when={path().startsWith("/player/")}>
              <Player />
            </Match>
            <Match when={path() === "/champions"}>
              <Champions />
            </Match>
            <Match when={path() === "/tier-list"}>
              <Planned title="Tier list" icon="tiers" description="Champion strength by role and rank bracket, for the current patch." />
            </Match>
            <Match when={path() === "/settings"}>
              <Settings />
            </Match>
            <Match when={path() === "/__harness" && transport.kind === "mock"}>
              <Harness />
            </Match>
          </Switch>
        </Suspense>
      </main>
      <Toasts />
    </div>
  );
}
