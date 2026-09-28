import { createEffect, createResource, For, type JSX, lazy, Match, on, onCleanup, onMount, Suspense, Switch } from "solid-js";
import { useData } from "../data/context";
import { Backdrop, setEffects } from "../design/backdrop";
import { Icon } from "../design/Icon";
import { liquid } from "../design/liquid/liquid";
import { dismissIssue, issues, notify, reportError } from "../lib/errors";
import { listenForLockInImports } from "../lib/lock-in-toasts";
import { Home } from "../views/home/Home";
import { Planned } from "../views/Planned";
import styles from "./App.module.css";
import { followPointerOnGlass } from "./glass";
import { navigate, path } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const Settings = lazy(() => import("../views/settings/Settings"));
const Draft = lazy(() => import("../views/draft/Draft"));
const Live = lazy(() => import("../views/live/Live"));
const Player = lazy(() => import("../views/player/Player"));
const Champions = lazy(() => import("../views/champions/Champions"));
const TierList = lazy(() => import("../views/tierlist/TierList"));
const Harness = lazy(() => import("../widgets/Harness"));
const Banners = lazy(() => import("./Banners"));

function Toasts(): JSX.Element {
  return (
    <div class={styles.toasts} aria-live="polite">
      <For each={issues()}>
        {(issue) => (
          <div
            class={`${styles.toast} ${styles[issue.tone]} glass-rim`}
            role="status"
            data-testid="toast"
            data-tone={issue.tone}
            ref={(el) => liquid(el, "panel")}
          >
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
  const { transport, gameData } = useData();
  const [status, { mutate }] = createResource(() =>
    transport.call("client_status").catch((error: unknown) => {
      reportError(error, "client_status");
      return undefined;
    }),
  );
  onCleanup(transport.listen("client-status", (next) => mutate(next)));
  onCleanup(followPointerOnGlass());
  // The core keeps the lasting visual effects choice; the first frame used the local copy.
  transport
    .call("get_settings")
    .then((settings) => setEffects(settings.effects))
    .catch(() => {
      // Settings unreadable: the Settings page says so; keep the local choice meanwhile.
    });
  onCleanup(transport.listen("settings", (settings) => setEffects(settings.effects)));
  // Draft and Live open on their own when the game moves on: have their code ready, once, at start.
  onMount(() => {
    void Draft.preload();
    void Live.preload();
  });

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
  onCleanup(
    listenForLockInImports(transport, () => ({
      champion: (id) => gameData()?.champions.get(id)?.name,
      spell: (id) => gameData()?.spells.get(id)?.name,
    })),
  );

  return (
    <div class={styles.shell} data-ambient-host>
      <Backdrop />
      <TitleBar status={status()} native={transport.kind === "tauri"} />
      <Sidebar />
      <main class={styles.main} data-view={path()}>
        <Banners status={status()} />
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
              <TierList />
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
