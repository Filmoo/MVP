import { createEffect, type JSX, on, Show } from "solid-js";
import type { AppInfo } from "../../data/generated/AppInfo";
import type { Effects } from "../../data/generated/Effects";
import type { Settings } from "../../data/generated/Settings";
import { rendered, setEffects } from "../../design/backdrop";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { Mark } from "../../design/Logo";
import { SettingList, SettingRow } from "../../design/SettingRow";
import { Slider } from "../../design/Slider";
import { Toggle } from "../../design/Toggle";
import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import { Choice } from "./Choice";
import styles from "./Settings.module.css";

export interface SectionProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** Why the last change in this section couldn't be saved. */
  error?: string | undefined;
}

/** Core errors are lower-case fragments; shown after a sentence, they start with a capital. */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The save failed: the control already flipped back; this says why, where it happened. */
function SaveError(props: { message: string | undefined }): JSX.Element {
  return (
    <Show when={props.message}>
      {(message) => (
        <p class={styles.saveError} role="alert">
          <Icon name="alert" size={16} class={styles.saveErrorIcon} />
          <span>Couldn't save this change. {sentence(message())}</span>
        </p>
      )}
    </Show>
  );
}

const seconds = (n: number) => `${n} s`;
const spokenSeconds = (n: number) => (n === 1 ? "1 second" : `${n} seconds`);

export function AutomationSettings(props: SectionProps): JSX.Element {
  return (
    <Card title="Automation">
      <SettingList>
        <SettingRow
          title="Auto-accept matches"
          description="Accepts the match found pop-up for you, after a delay so you still see it. Declining in the client always wins."
        >
          {(ids) => (
            <Toggle
              checked={props.settings.autoAccept}
              onChange={(autoAccept) => props.onChange({ autoAccept })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-auto-accept"
            />
          )}
        </SettingRow>
        <SettingRow nested title="Delay before accepting">
          {(ids) => (
            <div class={styles.slider}>
              <Slider
                value={props.settings.autoAcceptDelaySeconds}
                min={0}
                max={MAX_AUTO_ACCEPT_DELAY}
                format={seconds}
                valueText={spokenSeconds}
                onChange={(autoAcceptDelaySeconds) => props.onChange({ autoAcceptDelaySeconds })}
                disabled={!props.settings.autoAccept}
                labelledBy={ids.label}
                testId="setting-auto-accept-delay"
              />
            </div>
          )}
        </SettingRow>
        <SettingRow title="Bring MVP to the front" description="Shows the window as soon as your champion select starts.">
          {(ids) => (
            <Toggle
              checked={props.settings.bringToFrontOnChampSelect}
              onChange={(bringToFrontOnChampSelect) => props.onChange({ bringToFrontOnChampSelect })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-bring-to-front"
            />
          )}
        </SettingRow>
        <SettingRow
          title="Switch views with the game"
          description="Draft in champion select, Live once the game loads, Home when it ends. Pages you open yourself stay open."
        >
          {(ids) => (
            <Toggle
              checked={props.settings.autoSwitchView}
              onChange={(autoSwitchView) => props.onChange({ autoSwitchView })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-auto-switch-view"
            />
          )}
        </SettingRow>
      </SettingList>
      <SaveError message={props.error} />
    </Card>
  );
}

const EFFECTS: ReadonlyArray<{ value: Effects; label: string }> = [
  { value: "auto", label: "Full" },
  { value: "light", label: "Light" },
  { value: "off", label: "Off" },
];

/** Why "Full" isn't drawn right now (design/backdrop fallbacks). */
const FALLBACK: Record<string, string> = {
  "no-webgl": "this PC has no graphics acceleration for the window",
  slow: "your graphics card can't draw it cheaply",
  "context-lost": "the graphics driver restarted; it comes back on its own",
};

export function AppSettings(props: SectionProps): JSX.Element {
  // The window follows what's saved, including a change that couldn't be saved and flipped back.
  createEffect(
    on(
      () => props.settings.effects,
      (effects) => setEffects(effects),
      { defer: true },
    ),
  );
  const fallback = () => (props.settings.effects === "auto" && rendered().rendering !== "shader" ? rendered().reason : undefined);
  return (
    <Card title="App">
      <SettingList>
        <SettingRow
          title="Visual effects"
          description="Full: glass that bends the light, when your graphics card draws it easily. Light: a soft blur. Off: flat, the lightest."
        >
          {(ids) => (
            <Choice
              options={EFFECTS}
              value={props.settings.effects}
              onChange={(effects) => props.onChange({ effects })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-effects"
            />
          )}
        </SettingRow>
        <Show when={fallback()}>
          {(reason) => (
            <p class={styles.effectsNote} data-testid="effects-fallback">
              Showing Light for now: {FALLBACK[reason()] ?? reason()}.
            </p>
          )}
        </Show>
        <SettingRow
          title="Close to tray"
          description="Closing the window keeps MVP running in the tray, so automations keep working. Quit from the tray icon."
        >
          {(ids) => (
            <Toggle
              checked={props.settings.closeToTray}
              onChange={(closeToTray) => props.onChange({ closeToTray })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-close-to-tray"
            />
          )}
        </SettingRow>
        <SettingRow title="Launch at startup" description="Starts MVP with Windows, quietly in the tray.">
          {(ids) => (
            <Toggle
              checked={props.settings.launchAtStartup}
              onChange={(launchAtStartup) => props.onChange({ launchAtStartup })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-launch-at-startup"
            />
          )}
        </SettingRow>
      </SettingList>
      <SaveError message={props.error} />
    </Card>
  );
}

const PLATFORMS: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", web: "Browser preview" };

export function About(props: { info: AppInfo | undefined }): JSX.Element {
  return (
    <Card title="About">
      <div class={styles.about}>
        <div class={styles.identity}>
          <div class={styles.mark}>
            <Mark size={32} />
          </div>
          <div class={styles.identityText}>
            <span class={styles.appName}>MVP</span>
            <span class={styles.version}>
              <Show when={props.info} fallback="Version unknown">
                {(info) => (
                  <>
                    Version <span class="num">{info().version}</span> · {PLATFORMS[info().platform] ?? info().platform}
                  </>
                )}
              </Show>
            </span>
          </div>
        </div>
        <section class={styles.note}>
          <h3 class={styles.noteTitle}>Your data</h3>
          <p>
            MVP reads the League client on this computer only, and keeps your settings here. No account, nothing about you is sent anywhere.
            Game names and icons come from Riot's Data Dragon.
          </p>
        </section>
        <section class={styles.note}>
          <h3 class={styles.noteTitle}>Legal</h3>
          <p>
            MVP isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in
            producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks
            of Riot Games, Inc.
          </p>
        </section>
      </div>
    </Card>
  );
}
