import { type JSX, Show } from "solid-js";
import type { AppInfo } from "../../data/generated/AppInfo";
import type { Settings } from "../../data/generated/Settings";
import type { UpdateStatus } from "../../data/generated/UpdateStatus";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { Icon } from "../../design/Icon";
import { Mark } from "../../design/Logo";
import { SettingList, SettingRow } from "../../design/SettingRow";
import { Slider } from "../../design/Slider";
import { Toggle } from "../../design/Toggle";
import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import { aboutLine } from "../../lib/updates";
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

export function AutomationSettings(props: SectionProps & { autoAcceptPaused?: boolean }): JSX.Element {
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
      <Show when={props.autoAcceptPaused}>
        <p class={styles.paused} role="status" data-testid="auto-accept-paused">
          <Icon name="info" size={16} class={styles.pausedIcon} />
          <span>
            Auto-accept is paused for everyone while we fix an issue with the League client. Your choice is kept and works again as soon as
            it's fixed.
          </span>
        </p>
      </Show>
      <SaveError message={props.error} />
    </Card>
  );
}

export function AppSettings(props: SectionProps & { installId?: string | null | undefined }): JSX.Element {
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
        <SettingRow
          title="Send crash reports"
          description="When MVP crashes or a panel fails, it sends what went wrong and the app and Windows versions to MVP's server. Player names, IDs and file paths are removed first, and reports are deleted after 30 days."
        >
          {(ids) => (
            <Toggle
              checked={props.settings.crashReports}
              onChange={(crashReports) => props.onChange({ crashReports })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-crash-reports"
            />
          )}
        </SettingRow>
        <Show when={props.settings.crashReports && props.installId}>
          {(id) => (
            <SettingRow
              nested
              title="Report ID"
              description="Random, and not linked to your Riot account: with it, your reports can be deleted on request."
            >
              {() => (
                <span class={`${styles.installId} num`} data-testid="install-id">
                  {id()}
                </span>
              )}
            </SettingRow>
          )}
        </Show>
      </SettingList>
      <SaveError message={props.error} />
    </Card>
  );
}

const PLATFORMS: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", web: "Browser preview" };

/** Settings → About: the app's own update, with the one action that fits. */
function Updates(props: { update: UpdateStatus; onCheck: () => void; onRestart: () => void }): JSX.Element {
  const line = () => aboutLine(props.update);
  return (
    <section class={styles.note}>
      <h3 class={styles.noteTitle}>Updates</h3>
      <div class={styles.update}>
        <p data-testid="update-status">{line().text}</p>
        <Show when={line().action}>
          {(action) => (
            <Button
              variant={action() === "restart" ? "primary" : "secondary"}
              onClick={action() === "restart" ? props.onRestart : props.onCheck}
              disabled={line().busy}
              testId={action() === "restart" ? "update-restart-settings" : "update-check"}
            >
              {line().label}
            </Button>
          )}
        </Show>
      </div>
    </section>
  );
}

export function About(props: {
  info: AppInfo | undefined;
  /** Omitted: no update section (e.g. before the core answered). */
  update?: UpdateStatus | undefined;
  onCheckUpdates?: () => void;
  onRestart?: () => void;
}): JSX.Element {
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
        <Show when={props.update}>
          {(update) => <Updates update={update()} onCheck={() => props.onCheckUpdates?.()} onRestart={() => props.onRestart?.()} />}
        </Show>
        <section class={styles.note}>
          <h3 class={styles.noteTitle}>Your data</h3>
          <p>
            MVP reads the League client on this computer and keeps your settings here, with no account. Player searches and loading-screen
            cards go through MVP's server, which asks Riot. Crash reports are sent only if you turn them on. Game names and icons come from
            Riot's Data Dragon.
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
