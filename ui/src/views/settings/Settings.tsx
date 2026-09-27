import { createResource, createSignal, type JSX, Match, onCleanup, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { Settings as SettingsData } from "../../data/generated/Settings";
import { Card } from "../../design/Card";
import { ErrorState, Skeleton } from "../../design/States";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Settings.module.css";
import { About, AppSettings, AutomationSettings } from "./sections";

type Section = "automation" | "app";

/** Same boxes as the loaded page, so nothing jumps when settings arrive. */
function SettingsSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.main}>
        <Card title="Automation">
          <Skeleton height="296px" />
        </Card>
        <Card title="App">
          <Skeleton height="148px" />
        </Card>
      </div>
      <div class={styles.aside}>
        <Card title="About">
          <Skeleton height="320px" />
        </Card>
      </div>
    </div>
  );
}

/**
 * Settings are owned by the core. A change shows at once, is saved by the core, and flips back
 * (with the reason, in its card) if saving failed.
 */
function SettingsContent(props: { initial: SettingsData }): JSX.Element {
  const { transport } = useData();
  const [settings, setSettings] = createSignal(props.initial);
  const [errors, setErrors] = createSignal<Partial<Record<Section, string>>>({});
  const [info] = createResource(() => transport.call("app_info").catch(() => undefined));
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

  return (
    <div class={styles.grid}>
      <div class={styles.main}>
        <Widget name="settings-automation">
          <AutomationSettings settings={settings()} onChange={save("automation")} error={errors().automation} />
        </Widget>
        <Widget name="settings-app">
          <AppSettings settings={settings()} onChange={save("app")} error={errors().app} />
        </Widget>
      </div>
      <Widget name="settings-about" class={styles.aside}>
        <About info={info()} />
      </Widget>
    </div>
  );
}

export default function Settings(): JSX.Element {
  const { transport } = useData();
  const [initial, { refetch }] = createResource(() => transport.call("get_settings"));
  return (
    <div class={page.page}>
      <h1 class={page.title}>Settings</h1>
      <Switch>
        <Match when={initial.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                title="Couldn't load your settings"
                message={String(initial.error?.message ?? initial.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={initial.state === "pending" || initial.state === "unresolved"}>
          <SettingsSkeleton />
        </Match>
        <Match when={initial()}>{(loaded) => <SettingsContent initial={loaded()} />}</Match>
      </Switch>
    </div>
  );
}
