import { createContext, createEffect, createMemo, createSignal, createUniqueId, type JSX, on, Show, useContext } from "solid-js";
import { useData } from "../../data/context";
import type { AppInfo } from "../../data/generated/AppInfo";
import type { Effects } from "../../data/generated/Effects";
import type { FlashKey } from "../../data/generated/FlashKey";
import type { Language } from "../../data/generated/Language";
import type { Settings } from "../../data/generated/Settings";
import type { UpdateStatus } from "../../data/generated/UpdateStatus";
import type { GameDataView } from "../../data/static-data";
import { Button } from "../../design/Button";
import { osEnvironment, rendered, setEffects } from "../../design/backdrop";
import { Card } from "../../design/Card";
import { Choice, type ChoiceOption } from "../../design/Choice";
import { Icon } from "../../design/Icon";
import { Mark } from "../../design/Logo";
import { Marked } from "../../design/Marked";
import { type RowMatch, SettingList, SettingRow } from "../../design/SettingRow";
import { Slider } from "../../design/Slider";
import { EmptyState } from "../../design/States";
import { Toggle } from "../../design/Toggle";
import { setLanguage, t } from "../../i18n";
import { FLASH_ID } from "../../lib/imports";
import { MAX_AUTO_ACCEPT_DELAY } from "../../lib/settings";
import { bracketOptions } from "../../lib/stats";
import { aboutLine } from "../../lib/updates";
import styles from "./Settings.module.css";
import type { SearchId } from "./search";

/** What the page's search found in a card, a setting or a section of About (`undefined`: no search). */
export const SearchMatch = createContext<(id: SearchId) => RowMatch>(() => undefined);

/** A card's title, marked where the page's search found it. */
function Title(props: { id: SearchId; text: string }): JSX.Element {
  const match = useContext(SearchMatch);
  return <Marked text={props.text} marks={match(props.id)?.title} />;
}

/** Flash as the game names it in the player's language (`Saut éclair`). */
export const flashName = (data: GameDataView | undefined): string => data?.spells.get(FLASH_ID)?.name ?? "Flash";

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
  const match = useContext(SearchMatch);
  return (
    <Card title={<Title id="automation" text={words().title} />}>
      <SettingList>
        <SettingRow title={words().autoAccept.title} description={words().autoAccept.text} match={match("autoAccept")}>
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
        <SettingRow nested title={words().delay} match={match("delay")}>
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
        <SettingRow title={words().bringToFront.title} description={words().bringToFront.text} match={match("bringToFront")}>
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
        <SettingRow title={words().autoSwitch.title} description={words().autoSwitch.text} match={match("autoSwitch")}>
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

const flashKeys = (): ReadonlyArray<ChoiceOption<FlashKey>> => [
  { value: "auto", label: t().settings.imports.fromGames },
  { value: "d", label: "D" },
  { value: "f", label: "F" },
];

/**
 * Build imports into the League client: which parts also import by themselves, once, at the
 * first lock-in (their buttons in Draft and on champion pages always work), and where Flash goes.
 */
export function ImportSettings(props: SectionProps): JSX.Element {
  const { gameData } = useData();
  const words = () => t().settings.imports;
  const match = useContext(SearchMatch);
  const flash = () => flashName(gameData());
  const auto = (
    id: SearchId,
    row: () => { title: string; text: string },
    key: "autoImportRunes" | "autoImportItemSet" | "autoImportSpells",
    testId: string,
  ) => (
    <SettingRow title={row().title} description={row().text} match={match(id)}>
      {(ids) => {
        // The switch reads "Auto import", then the part: "Auto import Rune page". Its words flip it too.
        const label = createUniqueId();
        const control = createUniqueId();
        return (
          <div class={styles.auto}>
            <label class={styles.autoLabel} id={label} for={control}>
              {words().auto}
            </label>
            <Toggle
              id={control}
              checked={props.settings[key]}
              onChange={(on) => {
                const patch: Partial<Settings> = {};
                patch[key] = on;
                props.onChange(patch);
              }}
              labelledBy={`${label} ${ids.label}`}
              describedBy={ids.description}
              testId={testId}
            />
          </div>
        );
      }}
    </SettingRow>
  );
  return (
    <Card title={<Title id="imports" text={words().title} />}>
      <SettingList>
        {auto("runes", () => words().runes, "autoImportRunes", "setting-import-runes")}
        {auto("itemSet", () => words().itemSet, "autoImportItemSet", "setting-import-item-set")}
        {auto("spells", () => words().spells, "autoImportSpells", "setting-import-spells")}
        <SettingRow nested title={words().flashKey.title(flash())} description={words().flashKey.text(flash())} match={match("flashKey")}>
          {(ids) => (
            <Choice
              value={props.settings.flashKey}
              options={flashKeys()}
              onChange={(flashKey) => props.onChange({ flashKey })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-flash-key"
            />
          )}
        </SettingRow>
      </SettingList>
      <p class={styles.footnote}>
        <span class={styles.footnoteText}>{words().footnote}</span>
      </p>
      <SaveError message={props.error} />
    </Card>
  );
}

/** Whose games the stats count: the draft's numbers, imported builds, the stats pages' start. */
export function StatsSettings(props: SectionProps & { mayhemPaused?: boolean }): JSX.Element {
  const words = () => t().settings.stats;
  const match = useContext(SearchMatch);
  return (
    <Card title={<Title id="stats" text={words().title} />}>
      <SettingList>
        <SettingRow title={words().bracket} description={words().bracketText} match={match("bracket")}>
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
        {/* Opt-in, off by default: ARAM: Mayhem's pick rates come from the games players share. */}
        <SettingRow title={words().shareMayhem.title} description={words().shareMayhem.text} match={match("shareMayhem")}>
          {(ids) => (
            <Toggle
              checked={props.settings.shareMayhemGames}
              onChange={(shareMayhemGames) => props.onChange({ shareMayhemGames })}
              labelledBy={ids.label}
              describedBy={ids.description}
              testId="setting-share-mayhem"
            />
          )}
        </SettingRow>
      </SettingList>
      <Show when={props.mayhemPaused && props.settings.shareMayhemGames}>
        <p class={styles.paused} role="status" data-testid="mayhem-sharing-paused">
          <Icon name="info" size={16} class={styles.pausedIcon} />
          <span>{words().sharePaused}</span>
        </p>
      </Show>
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
  const match = useContext(SearchMatch);
  return (
    <Card title={<Title id="app" text={words().title} />}>
      <SettingList>
        <SettingRow title={words().language.title} description={words().language.text} match={match("language")}>
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
        <SettingRow title={words().closeToTray.title} description={words().closeToTray.text} match={match("closeToTray")}>
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
        <SettingRow title={words().launchAtStartup.title} description={words().launchAtStartup.text} match={match("launchAtStartup")}>
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
        <SettingRow title={words().crashReports.title} description={words().crashReports.text} match={match("crashReports")}>
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
            <SettingRow nested title={words().reportId.title} description={words().reportId.text} match={match("reportId")}>
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
          match={match("effects")}
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

/**
 * A section of About: the page's search finds it like a setting (hidden when it found nothing
 * there, its words marked where it did).
 */
function Note(props: { id: SearchId; title: string; text?: string; children?: JSX.Element }): JSX.Element {
  const match = useContext(SearchMatch);
  return (
    <section class={styles.note} hidden={match(props.id) === null}>
      <h3 class={styles.noteTitle}>
        <Marked text={props.title} marks={match(props.id)?.title} />
      </h3>
      <Show when={props.text}>
        {(text) => (
          <p>
            <Marked text={text()} marks={match(props.id)?.text} />
          </p>
        )}
      </Show>
      {props.children}
    </section>
  );
}

/** Settings → About: the app's own update, with the one action that fits. */
function Updates(props: { update: UpdateStatus; onCheck: () => void; onRestart: () => void }): JSX.Element {
  const line = () => aboutLine(props.update);
  return (
    <Note id="updates" title={t().settings.about.updates}>
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
    </Note>
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
    <Note id="help" title={t().settings.about.helpTitle} text={t().settings.about.help}>
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
    </Note>
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
    <Card title={<Title id="about" text={t().settings.about.title} />}>
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
        <Note id="data" title={t().settings.about.dataTitle} text={t().settings.about.data} />
        <Help />
        <Note id="legal" title={t().settings.about.legalTitle} text={t().settings.about.legal} />
      </div>
    </Card>
  );
}

/** The page's search found nothing: says so, with the way back to every setting. */
export function NoMatch(props: { query: string; onClear: () => void }): JSX.Element {
  const words = () => t().settings.search;
  return (
    <Card>
      <EmptyState
        icon="search"
        title={words().noMatch(props.query.trim())}
        text={words().tryOther}
        action={
          <Button onClick={props.onClear} testId="settings-search-reset">
            {words().clear}
          </Button>
        }
      />
    </Card>
  );
}
