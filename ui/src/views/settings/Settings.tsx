import { createResource, createSignal, type JSX, Match, onCleanup, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { Settings as SettingsData } from "../../data/generated/Settings";
import { useRemoteConfig, useUpdates } from "../../data/platform";
import { Card } from "../../design/Card";
import { ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { reportError } from "../../lib/errors";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Settings.module.css";
import { About, AppSettings, AutomationSettings, ImportSettings } from "./sections";

type Section = "automation" | "imports" | "app";

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
 */
function SettingsContent(props: { initial: SettingsData }): JSX.Element {
  const { transport } = useData();
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

  return (
    <div class={styles.grid}>
      <div class={styles.main}>
        <Widget name="settings-automation">
          <AutomationSettings
            settings={settings()}
            onChange={save("automation")}
            error={errors().automation}
            autoAcceptPaused={remote().killSwitches.autoAccept || !remote().features.autoAccept}
          />
        </Widget>
        <Widget name="settings-imports">
          <ImportSettings settings={settings()} onChange={save("imports")} error={errors().imports} />
        </Widget>
        <Widget name="settings-app">
          <AppSettings settings={settings()} onChange={save("app")} error={errors().app} installId={info()?.installId} />
        </Widget>
      </div>
      <Widget name="settings-about" class={styles.aside}>
        <About info={info()} update={updates.status()} onCheckUpdates={() => void updates.check()} onRestart={restart} />
      </Widget>
    </div>
  );
}

export default function Settings(): JSX.Element {
  const { transport } = useData();
  const [initial, { refetch }] = createResource(() => transport.call("get_settings"));
  return (
    <div class={page.page}>
      <h1 class={page.title}>{t().settings.title}</h1>
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
        <Match when={initial()}>{(loaded) => <SettingsContent initial={loaded()} />}</Match>
      </Switch>
    </div>
  );
}
