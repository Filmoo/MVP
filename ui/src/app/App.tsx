import { createResource, For, type JSX, lazy, Match, onCleanup, Suspense, Switch } from "solid-js";
import { useData } from "../data/context";
import { Icon } from "../design/Icon";
import { dismissIssue, issues, reportError } from "../lib/errors";
import { Home } from "../views/home/Home";
import { Planned } from "../views/Planned";
import styles from "./App.module.css";
import { path } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const Settings = lazy(() => import("../views/settings/Settings"));

function Toasts(): JSX.Element {
  return (
    <div class={styles.toasts} aria-live="polite">
      <For each={issues()}>
        {(issue) => (
          <div class={styles.toast} role="status" data-testid="toast">
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

  return (
    <div class={styles.shell}>
      <TitleBar status={status()} native={transport.kind === "tauri"} />
      <Sidebar />
      <main class={styles.main} data-view={path()}>
        <Suspense>
          <Switch fallback={<Planned title="Page not found" />}>
            <Match when={path() === "/"}>
              <Home />
            </Match>
            <Match when={path() === "/draft"}>
              <Planned title="Draft helper" />
            </Match>
            <Match when={path() === "/live"}>
              <Planned title="Live game" />
            </Match>
            <Match when={path() === "/champions"}>
              <Planned title="Champions" />
            </Match>
            <Match when={path() === "/tier-list"}>
              <Planned title="Tier list" />
            </Match>
            <Match when={path() === "/settings"}>
              <Settings />
            </Match>
          </Switch>
        </Suspense>
      </main>
      <Toasts />
    </div>
  );
}
