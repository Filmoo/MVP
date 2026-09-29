import { createMemo, createResource, createSignal, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { Settings as SettingsData } from "../../data/generated/Settings";
import { useRemoteConfig, useUpdates } from "../../data/platform";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import type { RowMatch } from "../../design/SettingRow";
import { ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { reportError } from "../../lib/errors";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Settings.module.css";
import { findSettings, type SearchId, settingsIndex } from "./search";
import { About, AppSettings, AutomationSettings, flashName, ImportSettings, NoMatch, SearchMatch, StatsSettings } from "./sections";

type Section = "automation" | "imports" | "stats" | "app";

/** Same boxes as the loaded page, so nothing jumps when settings arrive. */
function SettingsSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.main}>
        <Card title={t().settings.automation.title}>
          <Skeleton height="296px" />
        </Card>
        <Card title={t().settings.imports.title}>
          <Skeleton height="360px" />
        </Card>
        <Card title={t().settings.stats.title}>
          <Skeleton height="96px" />
        </Card>
        <Card title={t().settings.app.title}>
          <Skeleton height="413px" />
        </Card>
      </div>
      <div class={styles.aside}>
        <Card title={t().settings.about.title}>
          <Skeleton height="438px" />
        </Card>
      </div>
    </div>
  );
}

/**
 * Settings are owned by the core. A change shows at once, is saved by the core, and flips back
 * (with the reason, in its card) if saving failed.
 *
 * The search only hides what it doesn't find: every card stays mounted, so nothing it holds
 * resets (a save error, a copy's status, the window following the visual effects setting).
 */
function SettingsContent(props: { initial: SettingsData; query: string; onClear: () => void }): JSX.Element {
  const { transport, gameData } = useData();
  const [settings, setSettings] = createSignal(props.initial);
  const [errors, setErrors] = createSignal<Partial<Record<Section, string>>>({});
  const [info] = createResource(() => transport.call("app_info").catch(() => undefined));
  const remote = useRemoteConfig();
  const updates = useUpdates();
  const restart = () => {
    updates.restart().catch((error: unknown) => {
      reportError(t().updates.restartFailed(error instanceof Error ? error.message : String(error)), "update");
    });
  };
  // Changed elsewhere (another window, the tray, the core normalizing a value).
  onCleanup(transport.listen("settings", (next) => setSettings(next)));

  // Writes only the fields of one change: a later change may already be on screen.
  const apply = (keys: Array<keyof SettingsData>, source: SettingsData) =>
    setSettings((current) => ({ ...current, ...Object.fromEntries(keys.map((k) => [k, source[k]])) }));

  const save = (section: Section) => async (patch: Partial<SettingsData>) => {
    const keys = Object.keys(patch) as Array<keyof SettingsData>;
    const before = settings();
    const next = { ...before, ...patch };
    setSettings(next);
    try {
      apply(keys, await transport.call("update_settings", { settings: next }));
      setErrors((e) => ({ ...e, [section]: undefined }));
    } catch (error) {
      apply(keys, before);
      setErrors((e) => ({ ...e, [section]: error instanceof Error ? error.message : String(error) }));
    }
  };

  const index = createMemo(() => settingsIndex(t(), flashName(gameData())));
  const found = createMemo(() => findSettings(props.query, index()));
  const match = (id: SearchId): RowMatch => {
    const all = found();
    return all ? (all.get(id) ?? null) : undefined;
  };
  const hidden = (id: SearchId) => (match(id) === null ? styles.hidden : "");
  const nothing = () => found()?.size === 0;
  // Only About is found: it takes the settings' place rather than leaving them empty beside it.
  const aboutOnly = () => !!match("about") && (["automation", "imports", "stats", "app"] as const).every((id) => match(id) === null);

  return (
    <SearchMatch.Provider value={match}>
      <div class={`${styles.grid} ${aboutOnly() ? styles.aboutOnly : ""}`}>
        <div class={styles.main}>
          <Show when={nothing()}>
            <Widget name="settings-no-match">
              <NoMatch query={props.query} onClear={props.onClear} />
            </Widget>
          </Show>
          <Widget name="settings-automation" class={hidden("automation")} hideable>
            <AutomationSettings
              settings={settings()}
              onChange={save("automation")}
              error={errors().automation}
              autoAcceptPaused={remote().killSwitches.autoAccept || !remote().features.autoAccept}
            />
          </Widget>
          <Widget name="settings-imports" class={hidden("imports")} hideable>
            <ImportSettings settings={settings()} onChange={save("imports")} error={errors().imports} />
          </Widget>
          <Widget name="settings-stats" class={hidden("stats")} hideable>
            <StatsSettings settings={settings()} onChange={save("stats")} error={errors().stats} />
          </Widget>
          <Widget name="settings-app" class={hidden("app")} hideable>
            <AppSettings settings={settings()} onChange={save("app")} error={errors().app} installId={info()?.installId} />
          </Widget>
        </div>
        <Widget name="settings-about" class={`${styles.aside} ${hidden("about")}`} hideable>
          <About info={info()} update={updates.status()} onCheckUpdates={() => void updates.check()} onRestart={restart} />
        </Widget>
      </div>
    </SearchMatch.Provider>
  );
}

export default function Settings(): JSX.Element {
  const { transport } = useData();
  const [initial, { refetch }] = createResource(() => transport.call("get_settings"));
  // The search lives with the page: leaving Settings forgets it.
  const [query, setQuery] = createSignal("");
  let field: HTMLInputElement | undefined;
  const clear = () => {
    setQuery("");
    field?.focus();
  };
  // Ctrl+F looks in the page, as a browser's find does (Ctrl+K stays the title bar's search).
  const onKey = (e: KeyboardEvent) => {
    if (field?.isConnected && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      field.focus();
      field.select();
    }
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
  return (
    <div class={`${page.page} ${styles.page}`}>
      <div class={styles.head}>
        <h1 class={page.title}>{t().settings.title}</h1>
        <Show when={initial.state !== "errored"}>
          {/* Escape empties it, then leaves it; the browser's own button clears it too. */}
          <search class={styles.search}>
            <Icon name="search" size={16} class={styles.searchIcon} />
            <input
              ref={field}
              type="search"
              class={styles.searchInput}
              placeholder={t().settings.search.label}
              aria-label={t().settings.search.label}
              aria-keyshortcuts="Control+F"
              spellcheck={false}
              autocomplete="off"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                if (query()) setQuery("");
                else e.currentTarget.blur();
              }}
              data-testid="settings-search"
            />
            <span class={styles.kbd} aria-hidden="true">
              {t().settings.search.shortcut}
            </span>
          </search>
        </Show>
      </div>
      <Switch>
        <Match when={initial.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                title={t().settings.loadFailed}
                message={String(initial.error?.message ?? initial.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={initial.state === "pending" || initial.state === "unresolved"}>
          <SettingsSkeleton />
        </Match>
        <Match when={initial()}>{(loaded) => <SettingsContent initial={loaded()} query={query()} onClear={clear} />}</Match>
      </Switch>
    </div>
  );
}
