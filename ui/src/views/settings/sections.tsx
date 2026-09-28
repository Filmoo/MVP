import { createEffect, createMemo, createSignal, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import type { AppInfo } from "../../data/generated/AppInfo";
import type { Effects } from "../../data/generated/Effects";
import type { FlashKey } from "../../data/generated/FlashKey";
import type { ImportMode } from "../../data/generated/ImportMode";
import type { Language } from "../../data/generated/Language";
import type { Settings } from "../../data/generated/Settings";
import type { UpdateStatus } from "../../data/generated/UpdateStatus";
import { Button } from "../../design/Button";
import { osEnvironment, rendered, setEffects } from "../../design/backdrop";
import { Card } from "../../design/Card";
import { Choice, type ChoiceOption } from "../../design/Choice";
import { Icon } from "../../design/Icon";
import { Mark } from "../../design/Logo";
import { SettingList, SettingRow } from "../../design/SettingRow";
import { Slider } from "../../design/Slider";
import { Toggle } from "../../design/Toggle";
import { setLanguage, t } from "../../i18n";
import { FLASH_ID } from "../../lib/imports";
import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import { bracketOptions } from "../../lib/stats";
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
          <span>{t().settings.saveFailed(sentence(message()))}</span>
        </p>
      )}
    </Show>
  );
}

export function AutomationSettings(props: SectionProps & { autoAcceptPaused?: boolean }): JSX.Element {
  const words = () => t().settings.automation;
  return (
    <Card title={words().title}>
      <SettingList>
        <SettingRow title={words().autoAccept.title} description={words().autoAccept.text}>
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
        <SettingRow nested title={words().delay}>
          {(ids) => (
            <div class={styles.slider}>
              <Slider
                value={props.settings.autoAcceptDelaySeconds}
                min={0}
                max={MAX_AUTO_ACCEPT_DELAY}
                format={(n) => t().settings.seconds(n)}
                valueText={(n) => t().settings.spokenSeconds(n)}
                onChange={(autoAcceptDelaySeconds) => props.onChange({ autoAcceptDelaySeconds })}
                disabled={!props.settings.autoAccept}
                labelledBy={ids.label}
                testId="setting-auto-accept-delay"
              />
            </div>
          )}
        </SettingRow>
        <SettingRow title={words().bringToFront.title} description={words().bringToFront.text}>
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
        <SettingRow title={words().autoSwitch.title} description={words().autoSwitch.text}>
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
          <span>{words().paused}</span>
        </p>
      </Show>
      <SaveError message={props.error} />
    </Card>
  );
}

const importModes = (): ReadonlyArray<ChoiceOption<ImportMode>> => {
  const modes = t().settings.imports.modes;
  return [
    { value: "off", label: modes.off },
    { value: "oneClick", label: modes.oneClick },
    { value: "onLockIn", label: modes.onLockIn },
  ];
};

const flashKeys = (): ReadonlyArray<ChoiceOption<FlashKey>> => [
  { value: "auto", label: t().settings.imports.fromGames },
  { value: "d", label: "D" },
  { value: "f", label: "F" },
];

/** Build imports into the League client: when each part is imported, and where Flash goes. */
export function ImportSettings(props: SectionProps): JSX.Element {
  const { gameData } = useData();
  const words = () => t().settings.imports;
  // Flash as the game names it in the player's language (`Saut éclair`).
  const flash = () => gameData()?.spells.get(FLASH_ID)?.name ?? "Flash";
  const mode = (row: () => { title: string; text: string }, key: "importRunes" | "importItemSet" | "importSpells", testId: string) => (
    <SettingRow title={row().title} description={row().text}>
      {(ids) => (
        <Choice
          value={props.settings[key]}
          options={importModes()}
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
    <Card title={words().title}>
      <SettingList>
        {mode(() => words().runes, "importRunes", "setting-import-runes")}
        {mode(() => words().itemSet, "importItemSet", "setting-import-item-set")}
        {mode(() => words().spells, "importSpells", "setting-import-spells")}
        <SettingRow nested title={words().flashKey.title(flash())} description={words().flashKey.text(flash())}>
          {(ids) => (
            <Choice
              value={props.settings.flashKey}
              options={flashKeys()}
              onChange={(flashKey) => props.onChange({ flashKey })}
              labelledBy={ids.label}
              describedBy={ids.description}
              disabled={props.settings.importSpells === "off"}
              testId="setting-flash-key"
            />
          )}
        </SettingRow>
      </SettingList>
      <p class={styles.footnote}>{words().footnote}</p>
      <SaveError message={props.error} />
    </Card>
  );
}

/** Whose games the stats count: the draft's numbers, imported builds, the stats pages' start. */
export function StatsSettings(props: SectionProps): JSX.Element {
  const words = () => t().settings.stats;
  return (
    <Card title={words().title}>
      <SettingList>
        <SettingRow title={words().bracket} description={words().bracketText}>
          {(ids) => (
            <Choice
              value={props.settings.statsBracket}
              options={bracketOptions()}
              onChange={(statsBracket) => props.onChange({ statsBracket })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-stats-bracket"
            />
          )}
        </SettingRow>
      </SettingList>
      <SaveError message={props.error} />
    </Card>
  );
}

const effectLevels = (): ReadonlyArray<ChoiceOption<Effects>> => {
  const levels = t().settings.app.effects.levels;
  return [
    { value: "full", label: levels.full },
    { value: "light", label: levels.light },
    { value: "off", label: levels.off },
  ];
};

/** Each language in its own words, whatever the UI's language. */
const LANGUAGES: ReadonlyArray<ChoiceOption<Language>> = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
];

export function AppSettings(props: SectionProps & { installId?: string | null | undefined }): JSX.Element {
  // The window follows what's saved, including a change that couldn't be saved and flipped back.
  createEffect(
    on(
      () => props.settings.effects,
      (effects) => setEffects(effects),
      { defer: true },
    ),
  );
  // Only when the language itself changes (a settings change re-reads `props.settings`).
  const language = createMemo(() => props.settings.language);
  createEffect(on(language, (next) => void setLanguage(next), { defer: true }));
  // The default shows as what it draws: Light while Windows asks for less transparency, else Full.
  const shownEffects = (): Effects => {
    const chosen = props.settings.effects;
    if (chosen !== "auto") return chosen;
    return osEnvironment().reducedTransparency ? "light" : "full";
  };
  // Why the glass is off when Full was chosen or is the default: Windows' switch, or the GPU.
  const effectsNote = () => {
    const chosen = props.settings.effects;
    const reason = rendered().reason;
    if (!(chosen === "auto" || chosen === "full") || rendered().rendering === "shader" || !reason) return undefined;
    const words = t().settings.app.effects;
    return reason === "reduced-transparency" ? words.windowsOff : words.fallback(words.reasons[reason] ?? reason);
  };
  const words = () => t().settings.app;
  return (
    <Card title={words().title}>
      <SettingList>
        <SettingRow title={words().language.title} description={words().language.text}>
          {(ids) => (
            <Choice
              options={LANGUAGES}
              value={props.settings.language}
              onChange={(language) => props.onChange({ language })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-language"
            />
          )}
        </SettingRow>
        <SettingRow title={words().closeToTray.title} description={words().closeToTray.text}>
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
        <SettingRow title={words().launchAtStartup.title} description={words().launchAtStartup.text}>
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
        <SettingRow title={words().crashReports.title} description={words().crashReports.text}>
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
            <SettingRow nested title={words().reportId.title} description={words().reportId.text}>
              {() => (
                <span class={`${styles.installId} num`} data-testid="install-id">
                  {id()}
                </span>
              )}
            </SettingRow>
          )}
        </Show>
        <SettingRow
          title={words().effects.title}
          description={words().effects.text}
          note={effectsNote() && <span data-testid="effects-fallback">{effectsNote()}</span>}
        >
          {(ids) => (
            <Choice
              options={effectLevels()}
              value={shownEffects()}
              onChange={(effects) => props.onChange({ effects })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-effects"
            />
          )}
        </SettingRow>
      </SettingList>
      <SaveError message={props.error} />
    </Card>
  );
}

/** Settings → About: the app's own update, with the one action that fits. */
function Updates(props: { update: UpdateStatus; onCheck: () => void; onRestart: () => void }): JSX.Element {
  const line = () => aboutLine(props.update);
  return (
    <section class={styles.note}>
      <h3 class={styles.noteTitle}>{t().settings.about.updates}</h3>
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

/** The clipboard, or the old way when the webview refuses it (no secure context, no focus). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = styles.offscreen ?? "";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy refused");
  }
}

/** Settings → About: what to send when something doesn't work. */
function Help(): JSX.Element {
  const { transport } = useData();
  const [copied, setCopied] = createSignal<"no" | "yes" | "failed">("no");
  const copy = async () => {
    try {
      await copyText(await transport.call("diagnostics"));
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <section class={styles.note}>
      <h3 class={styles.noteTitle}>{t().settings.about.helpTitle}</h3>
      <p>{t().settings.about.help}</p>
      <div class={styles.helpActions}>
        <Button variant="secondary" onClick={() => void copy()} testId="copy-diagnostics">
          {t().settings.about.copy}
        </Button>
        <Button variant="ghost" onClick={() => void transport.call("open_logs").catch(() => undefined)} testId="open-logs">
          {t().settings.about.openLogs}
        </Button>
      </div>
      <p role="status" class={styles.helpStatus} data-testid="copy-status">
        {copied() === "yes" ? t().settings.about.copied : copied() === "failed" ? t().settings.about.copyFailed : ""}
      </p>
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
    <Card title={t().settings.about.title}>
      <div class={styles.about}>
        <div class={styles.identity}>
          <div class={styles.mark}>
            <Mark size={32} />
          </div>
          <div class={styles.identityText}>
            <span class={styles.appName}>MVP</span>
            <span class={styles.version}>
              <Show when={props.info} fallback={t().settings.about.unknownVersion}>
                {(info) => (
                  <>
                    {t().settings.about.version} <span class="num">{info().version}</span> ·{" "}
                    {t().settings.about.platforms[info().platform] ?? info().platform}
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
          <h3 class={styles.noteTitle}>{t().settings.about.dataTitle}</h3>
          <p>{t().settings.about.data}</p>
        </section>
        <Help />
        <section class={styles.note}>
          <h3 class={styles.noteTitle}>{t().settings.about.legalTitle}</h3>
          <p>{t().settings.about.legal}</p>
        </section>
      </div>
    </Card>
  );
}
