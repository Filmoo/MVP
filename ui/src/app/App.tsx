import { createEffect, For, type JSX, lazy, Match, on, onCleanup, onMount, Suspense, Switch } from "solid-js";
import { useData } from "../data/context";
import { createFollowed } from "../data/follow";
import type { Settings as SettingsData } from "../data/generated/Settings";
import { Backdrop, setEffects } from "../design/backdrop";
import { Icon } from "../design/Icon";
import { liquid } from "../design/liquid/liquid";
import { loadViewWords, setLanguage, t } from "../i18n";
import { dismissIssue, issues, notify, reportError } from "../lib/errors";
import { listenForLockInImports } from "../lib/lock-in-toasts";
import { setSettingsBracket } from "../lib/settings";
import { Home } from "../views/home/Home";
import { provideDetails } from "../views/home/RecentMatches";
import { Planned } from "../views/Planned";
import styles from "./App.module.css";
import { followPointerOnGlass } from "./glass";
import { navigate, path } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

/** A view besides Home: its code and its words (`loadViewWords`) load together. */
const withWords =
  <T,>(load: () => Promise<T>) =>
  () =>
    Promise.all([load(), loadViewWords()]).then(([module]) => module);

const Settings = lazy(withWords(() => import("../views/settings/Settings")));
const Draft = lazy(withWords(() => import("../views/draft/Draft")));
const Live = lazy(withWords(() => import("../views/live/Live")));
// The player page's chunk also carries an opened match row's code (the whole game, a grade's
// why), which Home's match history needs too: it loads them from here.
const playerPage = withWords(() => import("../views/player/Player"));
const Player = lazy(playerPage);
provideDetails(playerPage);
const Champions = lazy(withWords(() => import("../views/champions/Champions")));
const TierList = lazy(withWords(() => import("../views/tierlist/TierList")));
// Test-only page of mock builds (the desktop build leaves it out with the mock).
const Harness = __MVP_MOCK__ ? lazy(withWords(() => import("../widgets/Harness"))) : () => null;
const Banners = lazy(withWords(() => import("./Banners")));

function Toasts(): JSX.Element {
  return (
    <div class={styles.toasts} aria-live="polite">
      <For each={issues()}>
        {(issue) => (
          <div class={`${styles.toast} ${styles[issue.tone]} glass-rim`} role="status" data-testid="toast" data-tone={issue.tone}>
            <div class={styles.toastGlass} aria-hidden="true" ref={(el) => liquid(el, "panel")} />
            <Icon name={issue.tone === "success" ? "check" : "alert"} size={16} class={styles.toastIcon} />
            <span>{issue.message}</span>
            <button type="button" aria-label={t().common.dismiss} onClick={() => dismissIssue(issue.id)}>
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
  const [status] = createFollowed(
    () =>
      transport.call("client_status").catch((error: unknown) => {
        reportError(error, "client_status");
        return undefined;
      }),
    (set) => transport.listen("client-status", set),
  );
  onCleanup(followPointerOnGlass());
  // The core keeps the lasting visual effects and language choices; the first frame used the
  // local copies. The stats pages start from the settings' bracket.
  const apply = (settings: SettingsData) => {
    setEffects(settings.effects);
    void setLanguage(settings.language);
    setSettingsBracket(settings.statsBracket);
  };
  transport
    .call("get_settings")
    .then(apply)
    .catch(() => {
      // Settings unreadable: the Settings page says so; keep the local choices meanwhile.
    });
  onCleanup(transport.listen("settings", apply));
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
      if (outcome.kind === "accepted") notify(t().shell.matchAccepted);
      else reportError(t().shell.acceptFailed(outcome.message), "auto-accept");
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
        {/* Nothing to see while a view's code loads, but the page says it is loading (tests wait). */}
        <Suspense fallback={<div data-state="loading" hidden />}>
          <Switch
            fallback={
              <Planned
                title={t().shell.notFound.title}
                icon="alert"
                stateTitle={t().shell.notFound.state}
                description={t().shell.notFound.text}
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
