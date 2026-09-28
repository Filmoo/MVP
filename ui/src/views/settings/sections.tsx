import { type JSX, Show } from "solid-js";
import type { AppInfo } from "../../data/generated/AppInfo";
import type { FlashKey } from "../../data/generated/FlashKey";
import type { ImportMode } from "../../data/generated/ImportMode";
import type { Settings } from "../../data/generated/Settings";
import { Card } from "../../design/Card";
import { Choice, type ChoiceOption } from "../../design/Choice";
import { Icon } from "../../design/Icon";
import { Mark } from "../../design/Logo";
import { SettingList, SettingRow } from "../../design/SettingRow";
import { Slider } from "../../design/Slider";
import { Toggle } from "../../design/Toggle";
import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
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

const IMPORT_MODES: ReadonlyArray<ChoiceOption<ImportMode>> = [
  { value: "off", label: "Off" },
  { value: "oneClick", label: "One click" },
  { value: "onLockIn", label: "On lock-in" },
];

const FLASH_KEYS: ReadonlyArray<ChoiceOption<FlashKey>> = [
  { value: "auto", label: "From your games" },
  { value: "d", label: "D" },
  { value: "f", label: "F" },
];

/** Build imports into the League client: when each part is imported, and where Flash goes. */
export function ImportSettings(props: SectionProps): JSX.Element {
  const mode = (title: string, description: string, key: "importRunes" | "importItemSet" | "importSpells", testId: string) => (
    <SettingRow title={title} description={description}>
      {(ids) => (
        <Choice
          value={props.settings[key]}
          options={IMPORT_MODES}
          onChange={(next) => {
            const patch: Partial<Settings> = {};
            patch[key] = next;
            props.onChange(patch);
          }}
          labelledBy={ids.label}
          describedBy={ids.description}
          testId={testId}
        />
      )}
    </SettingRow>
  );
  return (
    <Card title="Imports">
      <SettingList>
        {mode(
          "Rune page",
          "Writes the build's runes into MVP's own page, named “MVP”, and selects it. Your pages are never changed.",
          "importRunes",
          "setting-import-runes",
        )}
        {mode(
          "Item set",
          "Adds the build to the in-game shop as MVP's set for the champion. Your item sets are never changed.",
          "importItemSet",
          "setting-import-item-set",
        )}
        {mode(
          "Summoner spells",
          "Sets the build's spells in champion select, never in its last 5 seconds.",
          "importSpells",
          "setting-import-spells",
        )}
        <SettingRow nested title="Flash key" description="Flash always goes on this key, whatever the build lists.">
          {(ids) => (
            <Choice
              value={props.settings.flashKey}
              options={FLASH_KEYS}
              onChange={(flashKey) => props.onChange({ flashKey })}
              labelledBy={ids.label}
              describedBy={ids.description}
              disabled={props.settings.importSpells === "off"}
              testId="setting-flash-key"
            />
          )}
        </SettingRow>
      </SettingList>
      <p class={styles.footnote}>One click: buttons in Draft. On lock-in: also by itself, once, when you lock in your champion.</p>
      <SaveError message={props.error} />
    </Card>
  );
}

export function AppSettings(props: SectionProps): JSX.Element {
  return (
    <Card title="App">
      <SettingList>
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
