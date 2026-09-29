import { For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import styles from "./App.module.css";
import { FilterBar } from "./chrome/FilterBar";
import { Toasts } from "./chrome/Toasts";
import { TopBar } from "./chrome/TopBar";
import { onKey } from "./keys";
import { Activity } from "./panels/Activity";
import { CreateDialog, ShortcutsDialog, VersionDialog } from "./panels/Dialogs";
import { FeatureSheet } from "./panels/FeatureSheet";
import { Inbox } from "./panels/Inbox";
import { Palette } from "./panels/Palette";
import { data, load, me, reloadIfStale, signedOutReason, signIn } from "./state/data";
import { route } from "./state/route";
import { overlay, setOverlay } from "./state/ui";
import { Button } from "./ui/Button";
import { Mark } from "./ui/Icon";
import { Board } from "./views/Board";
import { List } from "./views/List";
import { Roadmap } from "./views/Roadmap";

export function App(): JSX.Element {
  onMount(() => void signIn());
  return (
    <Switch>
      <Match when={me() === undefined}>
        <div class={styles.center} aria-busy="true">
          <Mark size={40} />
        </div>
      </Match>
      <Match when={me() === null}>
        <SignIn />
      </Match>
      <Match when={me()}>
        <Shell />
      </Match>
    </Switch>
  );
}

function SignIn(): JSX.Element {
  return (
    <main class={styles.center}>
      <section class={styles.signIn} aria-labelledby="sign-in-title">
        <Mark size={48} />
        <p class={styles.eyebrow}>MVP Roadmap</p>
        <h1 id="sign-in-title" class={styles.signInTitle}>
          Every feature, by version
        </h1>
        <p class={styles.signInText}>Private to the admins of the MVP repository. Sign in with the GitHub account that administers it.</p>
        <Show when={signedOutReason()}>{(why) => <p class={styles.reason}>{why()}</p>}</Show>
        <a class={styles.signInButton} href="/auth/login">
          Sign in with GitHub
        </a>
      </section>
    </main>
  );
}

function Shell(): JSX.Element {
  onMount(() => {
    void load();
    const visible = () => {
      if (document.visibilityState === "visible") reloadIfStale();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", reloadIfStale);
    document.addEventListener("visibilitychange", visible);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", reloadIfStale);
      document.removeEventListener("visibilitychange", visible);
    });
  });
  return (
    <div class={styles.shell}>
      <TopBar />
      <FilterBar />
      <main class={styles.main} data-view={route().view}>
        <Switch>
          <Match when={data.error && !data.loaded}>
            <div class={styles.center}>
              <div class={styles.state}>
                <h2>The roadmap didn't load</h2>
                <p>{data.error}</p>
                <Button variant="primary" icon="refresh" onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            </div>
          </Match>
          <Match when={!data.loaded}>
            <div class={styles.skeleton} role="status" aria-busy="true" aria-label="Loading the roadmap">
              <For each={[0, 1, 2, 3]}>{() => <div class={styles.ghostColumn} />}</For>
            </div>
          </Match>
          <Match when={data.versions.length === 0}>
            <div class={styles.center}>
              <div class={styles.state}>
                <h2>No versions yet</h2>
                <p>A roadmap starts with a version: 0.1, Next, Later…</p>
                <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: "version", versionId: null })}>
                  New version
                </Button>
              </div>
            </div>
          </Match>
          <Match when={route().view === "board"}>
            <Board />
          </Match>
          <Match when={route().view === "roadmap"}>
            <Roadmap />
          </Match>
          <Match when={route().view === "list"}>
            <List />
          </Match>
        </Switch>
      </main>
      <Show when={data.loaded && route().panel === "inbox"}>
        <Inbox />
      </Show>
      <Show when={data.loaded && route().panel === "activity"}>
        <Activity />
      </Show>
      <Show when={data.loaded ? route().feature : null}>{(id) => <FeatureSheet id={id()} />}</Show>
      <Switch>
        <Match when={overlay()?.kind === "palette" && overlay()}>{(o) => <Palette mode={(o() as { mode: "all" | "move" }).mode} />}</Match>
        <Match when={overlay()?.kind === "create" && overlay()}>
          {(o) => {
            const create = o() as { versionId: number | null; status: "proposed" | null };
            return <CreateDialog versionId={create.versionId} status={create.status} />;
          }}
        </Match>
        <Match when={overlay()?.kind === "version" && overlay()}>
          {(o) => <VersionDialog versionId={(o() as { versionId: number | null }).versionId} />}
        </Match>
        <Match when={overlay()?.kind === "keys"}>
          <ShortcutsDialog />
        </Match>
      </Switch>
      <Toasts />
    </div>
  );
}
