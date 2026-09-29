import { type Accessor, createEffect, createSignal, Index, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import { createFollowed } from "../../data/follow";
import type { Bracket } from "../../data/generated/Bracket";
import type { ImportOutcome } from "../../data/generated/ImportOutcome";
import type { ImportPart } from "../../data/generated/ImportPart";
import type { ImportWarning } from "../../data/generated/ImportWarning";
import type { Role } from "../../data/generated/Role";
import type { Settings } from "../../data/generated/Settings";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon, type IconName } from "../../design/Icon";
import { t } from "../../i18n";
import {
  createImportMemory,
  FLASH_ID,
  IMPORT_PARTS,
  type ImportMemory,
  importForLabel,
  type Owner,
  type PartTone,
  statusOf,
  toneOf,
  warningRequest,
  warningText,
} from "../../lib/imports";
import { roleLabel } from "../../lib/roles";
import styles from "./ImportBar.module.css";

/** The parts the player set to import by themselves at the first lock-in (Settings → Imports). */
export type AutoImports = Record<ImportPart, boolean>;

const autoOf = (settings: Settings | undefined): AutoImports => ({
  runes: settings?.autoImportRunes ?? false,
  itemSet: settings?.autoImportItemSet ?? false,
  spells: settings?.autoImportSpells ?? false,
});

/** The player's "Auto import" switches, following changes (off until settings are read). */
export function useAutoImports(): Accessor<AutoImports> {
  const { transport } = useData();
  const [settings] = createFollowed(
    () => transport.call("get_settings").catch(() => undefined),
    (set) => transport.listen("settings", set),
  );
  return () => autoOf(settings.state === "ready" ? settings() : undefined);
}

/** Draft's warning after the automatic import, as the core has it (`null` without one). */
export function useImportWarning(): Accessor<ImportWarning | null> {
  const { transport } = useData();
  const [warning] = createFollowed(
    () => transport.call("import_warning").catch(() => null),
    (set) => transport.listen("import-warning", set),
  );
  return () => (warning.state === "ready" ? (warning() ?? null) : null);
}

/** A part's button: its last outcome, or busy while the core imports it. */
export interface PartView {
  part: ImportPart;
  busy: boolean;
  outcome?: ImportOutcome | undefined;
  /** Why the button can't be used now (shown as its tooltip). */
  disabled?: string | undefined;
  /** Also imported by itself at the first lock-in. */
  automatic: boolean;
}

/** The warning as the bar shows it: what changed, and its one click. */
export interface WarningView {
  text: string;
  action: string;
  busy: boolean;
  onImport: () => void;
}

const TONE_ICON: Record<PartTone, IconName> = { done: "check", warn: "alert", skipped: "minimize", failed: "alert" };

/** The bar as shown: who the build is for, one button per part, and what happened last. */
export function ImportPanel(props: {
  championId: number | null;
  /** `Ahri · Mid · locked in`. */
  subtitle: string;
  parts: readonly PartView[];
  status?: { tone: PartTone | "hint"; text: string } | undefined;
  onImport: (part: ImportPart) => void;
  /** After the automatic import, the player's champion or role changed: said on its own line. */
  warning?: WarningView | undefined;
}): JSX.Element {
  return (
    <Card flush class={styles.card}>
      <div class={styles.bar}>
        <div class={styles.who}>
          <Show when={props.championId} fallback={<div class={styles.noChampion} aria-hidden="true" />}>
            {(id) => <ChampionIcon championId={id()} size={32} />}
          </Show>
          <div class={styles.whoText}>
            <h2 class={styles.title}>{t().imports.title}</h2>
            <span class={styles.subtitle}>{props.subtitle}</span>
          </div>
        </div>
        <div class={styles.buttons}>
          {/* By position: a button stays the same element (and keeps focus) as its state changes. */}
          <Index each={props.parts}>
            {(view) => {
              const tone = () => {
                const outcome = view().outcome;
                return outcome ? toneOf(outcome) : undefined;
              };
              return (
                <button
                  type="button"
                  class={`${styles.part} ${tone() ? styles[tone() as PartTone] : ""}`}
                  disabled={view().disabled !== undefined}
                  // Busy stays focusable (a disabled button would drop the focus), clicks wait.
                  aria-disabled={view().busy ? "true" : undefined}
                  aria-label={t().imports.importPart(view().part)}
                  aria-busy={view().busy ? "true" : undefined}
                  title={view().disabled ?? (view().automatic ? t().imports.auto : undefined)}
                  data-testid={`import-${view().part}`}
                  data-tone={tone()}
                  onClick={() => {
                    if (!view().busy) props.onImport(view().part);
                  }}
                >
                  <Show when={!view().busy} fallback={<span class={styles.spinner} aria-hidden="true" />}>
                    <Icon name={tone() ? TONE_ICON[tone() as PartTone] : "import"} size={16} class={styles.icon} />
                  </Show>
                  {t().imports.parts[view().part]}
                </button>
              );
            }}
          </Index>
        </div>
        <p class={`${styles.status} ${props.status ? styles[props.status.tone] : ""}`} role="status" data-testid="import-status">
          {props.status?.text ?? ""}
        </p>
        <Show when={props.warning}>
          {(warning) => (
            <div class={styles.warning} role="alert" data-testid="import-warning">
              <Icon name="alert" size={16} class={styles.warningIcon} />
              <span class={styles.warningText}>{warning().text}</span>
              <button
                type="button"
                class={styles.warningAction}
                aria-disabled={warning().busy ? "true" : undefined}
                aria-busy={warning().busy ? "true" : undefined}
                data-testid="import-warning-action"
                onClick={() => {
                  if (!warning().busy) warning().onImport();
                }}
              >
                <Show when={warning().busy}>
                  <span class={styles.spinner} aria-hidden="true" />
                </Show>
                {warning().action}
              </button>
            </div>
          )}
        </Show>
      </div>
    </Card>
  );
}

/**
 * One-click imports of a champion's build into the League client: rune page, item set, summoner
 * spells, whatever the "Auto import" switches. In Draft, of the champion the player hovers or
 * locked (the automatic import shows here too, and the warning when the champion or role changed
 * since it); on a champion page, of the build shown.
 */
export function ImportBar(props: {
  championId: number | null;
  role: Role | null;
  /** Hovering, not locked in yet. */
  hovering?: boolean;
  /** What the build is, after the champion and role (default: hovering / locked in). */
  context?: string;
  /** Stats queue (420, 450); `null`: the current game's. */
  queue?: number | null;
  /** Stats bracket; `null`: Emerald+. */
  bracket?: Bracket | null;
  /** Build stats are available. */
  available: boolean;
  /** In champion select: spells can change. */
  inChampSelect: boolean;
  /** The League client is connected: there is something to import into. */
  clientReady: boolean;
  /** Draft: imports are for this champion select (once it has ended, the core tries nothing). */
  champSelect?: boolean;
  /** Parts that also import by themselves at the first lock-in (Draft marks their buttons). */
  auto?: AutoImports | undefined;
  /** Draft's warning after the automatic import, with its one click. */
  warning?: ImportWarning | null | undefined;
  /** Where results are kept (Draft's outlive the view for the champion select); the bar's own by default. */
  memory?: ImportMemory;
}): JSX.Element {
  const { transport, gameData } = useData();
  // Read once: Draft hands its memory for the whole champion select, a champion page none.
  const memory = props.memory ?? createImportMemory();
  // Parts being imported, as `championId:part`: another champion's buttons aren't busy.
  const [running, setRunning] = createSignal<ReadonlySet<string>>(new Set());
  const busy = (part: ImportPart, championId = props.championId) => running().has(`${championId}:${part}`);
  const spellName = (id: number) => gameData()?.spells.get(id)?.name ?? (id === FLASH_ID ? "Flash" : t().common.spellN(id));
  const champion = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const owner = (): Owner | null => (props.championId === null ? null : { championId: props.championId, role: props.role });
  const shown = () => memory.shown(owner());

  // Results belong to one champion and role: another one starts afresh, the same one sent again
  // (the client re-sends its session after a change) keeps them.
  createEffect(
    on(
      () => `${props.championId}:${props.role}`,
      () => memory.follow(owner()),
    ),
  );

  const run = async (parts: readonly ImportPart[], who: Owner | null = owner()) => {
    if (who === null) return;
    const todo = parts.filter((part) => !busy(part, who.championId));
    const keys = todo.map((part) => `${who.championId}:${part}`);
    if (todo.length === 0) return;
    setRunning((current) => new Set([...current, ...keys]));
    try {
      memory.record(
        await transport.call("import_build", {
          request: {
            championId: who.championId,
            role: who.role,
            queue: props.queue ?? null,
            bracket: props.bracket ?? null,
            parts: todo,
            champSelect: props.champSelect ?? false,
          },
        }),
      );
    } catch (error) {
      memory.fail(who, todo, error instanceof Error ? error.message : String(error));
    } finally {
      setRunning((current) => new Set([...current].filter((key) => !keys.includes(key))));
    }
  };

  const unavailable = (part: ImportPart): string | undefined => {
    if (props.championId === null) return t().imports.pickFirst;
    if (!props.clientReady) return t().imports.needsClient;
    if (!props.available) return t().imports.notYet;
    if (part === "spells" && !props.inChampSelect) return t().imports.spellsInChampSelect;
    return undefined;
  };

  const parts = (): PartView[] =>
    IMPORT_PARTS.map((part) => ({
      part,
      busy: busy(part),
      outcome: shown().results[part],
      disabled: unavailable(part),
      automatic: props.auto?.[part] ?? false,
    }));

  const subtitle = () => {
    if (props.championId === null) return t().imports.pick;
    const role = props.role ? ` · ${roleLabel(props.role)}` : "";
    return `${champion(props.championId)}${role} · ${props.context ?? (props.hovering ? t().imports.hovering : t().imports.lockedIn)}`;
  };

  const warning = (): WarningView | undefined => {
    const current = props.warning;
    if (!current) return undefined;
    const request = warningRequest(current);
    return {
      text: warningText(current, champion),
      action: importForLabel(current, champion),
      busy: request.parts.some((part) => busy(part, request.championId)),
      onImport: () => void run(request.parts, { championId: request.championId, role: request.role }),
    };
  };

  const status = () => {
    const failure = shown().unreachable;
    if (failure) return { tone: "failed" as const, text: failure };
    const last = statusOf(shown().last, spellName);
    if (last) return last;
    // The warning says what matters now.
    if (props.warning) return undefined;
    // Every button off for the same reason: say it without a hover.
    if (props.championId !== null && !props.clientReady) return { tone: "hint" as const, text: `${t().imports.needsClient}.` };
    if (props.championId !== null && !props.available) {
      return { tone: "hint" as const, text: t().imports.notYetStatus };
    }
    return { tone: "hint" as const, text: t().imports.idle(spellName(FLASH_ID)) };
  };

  return (
    <ImportPanel
      championId={props.championId}
      subtitle={subtitle()}
      parts={parts()}
      status={status()}
      onImport={(part) => void run([part])}
      warning={warning()}
    />
  );
}
