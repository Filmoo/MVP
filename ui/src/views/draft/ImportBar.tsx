import { type Accessor, createEffect, createResource, createSignal, Index, type JSX, on, onCleanup, Show } from "solid-js";
import { useData } from "../../data/context";
import type { Bracket } from "../../data/generated/Bracket";
import type { ImportMode } from "../../data/generated/ImportMode";
import type { ImportOutcome } from "../../data/generated/ImportOutcome";
import type { ImportPart } from "../../data/generated/ImportPart";
import type { ImportResult } from "../../data/generated/ImportResult";
import type { Role } from "../../data/generated/Role";
import type { Settings } from "../../data/generated/Settings";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon, type IconName } from "../../design/Icon";
import { t } from "../../i18n";
import { FLASH_ID, IMPORT_PARTS, type PartTone, statusOf, toneOf } from "../../lib/imports";
import { lastLockIn } from "../../lib/lock-in-toasts";
import { roleLabel } from "../../lib/roles";
import styles from "./ImportBar.module.css";

export type ImportModes = Record<ImportPart, ImportMode>;

function modesOf(settings: Settings | undefined): ImportModes {
  return {
    runes: settings?.importRunes ?? "oneClick",
    itemSet: settings?.importItemSet ?? "oneClick",
    spells: settings?.importSpells ?? "oneClick",
  };
}

/** The player's import modes, following changes (one click until settings are read). */
export function useImportModes(): Accessor<ImportModes> {
  const { transport } = useData();
  const [settings, { mutate }] = createResource(() => transport.call("get_settings").catch(() => undefined));
  onCleanup(transport.listen("settings", (next) => mutate(next)));
  return () => modesOf(settings.state === "ready" ? settings() : undefined);
}

/** A part's button: its last outcome, or busy while the core imports it. */
export interface PartView {
  part: ImportPart;
  busy: boolean;
  outcome?: ImportOutcome | undefined;
  /** Why the button can't be used now (shown as its tooltip). */
  disabled?: string | undefined;
  /** Also imported automatically on lock-in. */
  automatic: boolean;
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
      </div>
    </Card>
  );
}

/**
 * One-click imports of a champion's build into the League client: rune page, item set, summoner
 * spells. In Draft, of the champion the player hovers or locked (automatic imports on lock-in,
 * `import` events, show here too); on a champion page, of the build shown. Parts turned off in
 * Settings have no button.
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
  modes: ImportModes;
}): JSX.Element {
  const { transport, gameData } = useData();
  const [results, setResults] = createSignal<Partial<Record<ImportPart, ImportOutcome>>>({});
  const [busy, setBusy] = createSignal<ReadonlySet<ImportPart>>(new Set());
  const [last, setLast] = createSignal<ImportResult["parts"]>([]);
  // The core couldn't be asked at all (still starting): shown instead of the last outcome.
  const [unreachable, setUnreachable] = createSignal<string>();
  const spellName = (id: number) => gameData()?.spells.get(id)?.name ?? (id === FLASH_ID ? "Flash" : t().common.spellN(id));
  const name = () =>
    props.championId === null ? undefined : (gameData()?.champions.get(props.championId)?.name ?? t().common.championN(props.championId));

  // Results belong to one champion and role: another hover starts afresh.
  createEffect(
    on(
      () => `${props.championId}:${props.role}`,
      () => {
        setResults({});
        setLast([]);
        setUnreachable(undefined);
        setBusy(new Set<ImportPart>());
      },
      { defer: true },
    ),
  );

  const apply = (result: ImportResult) => {
    if (result.championId !== props.championId) return;
    setResults((current) => ({ ...current, ...Object.fromEntries(result.parts.map((p) => [p.part, p.outcome])) }));
    setLast(result.parts);
    setUnreachable(undefined);
  };
  // The import on lock-in of this champion select shows on the buttons too.
  createEffect(
    on(lastLockIn, (result) => {
      if (result) apply(result);
    }),
  );

  const run = async (part: ImportPart) => {
    const championId = props.championId;
    if (championId === null || busy().has(part)) return;
    setBusy((current) => new Set([...current, part]));
    try {
      apply(
        await transport.call("import_build", {
          request: { championId, role: props.role, queue: props.queue ?? null, bracket: props.bracket ?? null, parts: [part] },
        }),
      );
    } catch (error) {
      if (championId === props.championId) {
        const message = error instanceof Error ? error.message : String(error);
        setResults((current) => ({ ...current, [part]: { kind: "failed", reason: { kind: "client", message } } }));
        setUnreachable(t().imports.failed(message));
      }
    } finally {
      setBusy((current) => new Set([...current].filter((p) => p !== part)));
    }
  };

  const unavailable = (part: ImportPart): string | undefined => {
    if (props.championId === null) return t().imports.pickFirst;
    if (!props.available) return t().imports.notYet;
    if (part === "spells" && !props.inChampSelect) return t().imports.spellsInChampSelect;
    return undefined;
  };

  const parts = (): PartView[] =>
    IMPORT_PARTS.filter((part) => props.modes[part] !== "off").map((part) => ({
      part,
      busy: busy().has(part),
      outcome: results()[part],
      disabled: unavailable(part),
      automatic: props.modes[part] === "onLockIn",
    }));

  const subtitle = () => {
    const who = name();
    if (!who) return t().imports.pick;
    const role = props.role ? ` · ${roleLabel(props.role)}` : "";
    return `${who}${role} · ${props.context ?? (props.hovering ? t().imports.hovering : t().imports.lockedIn)}`;
  };

  const status = () => {
    const failure = unreachable();
    if (failure) return { tone: "failed" as const, text: failure };
    const shown = statusOf(last(), spellName);
    if (shown) return shown;
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
      onImport={(part) => void run(part)}
    />
  );
}
