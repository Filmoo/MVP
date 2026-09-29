import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BuildOption } from "../../data/generated/BuildOption";
import type { BuildSection } from "../../data/generated/BuildSection";
import type { BuildStats } from "../../data/generated/BuildStats";
import { Card } from "../../design/Card";
import { ItemIcon, SpellIcon } from "../../design/GameIcon";
import { t } from "../../i18n";
import { percent } from "../../lib/format";
import { optionShare, SKILL_KEYS, winRateOf } from "../../lib/stats";
import styles from "./Builds.module.css";

/**
 * An option's win rate with its games, and how often it is picked; what both numbers count, on
 * hover or focus (design/tip).
 */
export function OptionStats(props: { option: BuildOption; section: BuildSection; large?: boolean }): JSX.Element {
  const wr = () => winRateOf(props.option);
  return (
    <span
      class={`${styles.stats} ${props.large ? styles.large : ""} num`}
      data-hint={`${t().stats.winsInGames(props.option.w, props.option.g)}\n${t().stats.pickedIn(props.option.g, props.section.n)}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: its explanation (design/tip) shows on keyboard focus too
      tabIndex={0}
    >
      <span class={styles.stat}>
        <span class={styles.wr}>{percent(wr() ?? 0, 1)}</span>
        <span class={styles.caption}>{t().common.games(props.option.g)}</span>
      </span>
      <span class={styles.stat}>
        <span class={styles.pick}>{percent(optionShare(props.option, props.section), 1)}</span>
        <span class={styles.caption}>{t().stats.pick}</span>
      </span>
    </span>
  );
}

/** A titled block of options, with how many games it counts. */
function Section(props: { title: string; section: BuildSection; class?: string | undefined; children: JSX.Element }): JSX.Element {
  return (
    <div class={`${styles.section} ${props.class ?? ""}`}>
      <h3 class={styles.sectionTitle}>
        <span>{props.title}</span>
        <span class={`${styles.sectionGames} num`}>{t().common.games(props.section.n)}</span>
      </h3>
      <Show when={props.section.top.length > 0} fallback={<p class={styles.none}>{t().stats.notEnoughGames}</p>}>
        {props.children}
      </Show>
    </div>
  );
}

/** An ability key, keycap style (slot 1 = Q … 4 = R). */
export function Keycap(props: { slot: number; strong?: boolean; small?: boolean }): JSX.Element {
  return (
    <kbd class={`${styles.key} ${props.strong ? styles.keyStrong : ""} ${props.small ? styles.keySmall : ""}`}>
      {SKILL_KEYS[props.slot] ?? "?"}
    </kbd>
  );
}

/** `Q › E › W`: the max order, first maxed first. */
export function MaxOrder(props: { ids: readonly number[]; small?: boolean }): JSX.Element {
  return (
    <span class={styles.order} role="img" aria-label={t().champions.maxOrder(props.ids.map((s) => SKILL_KEYS[s] ?? "?"))}>
      <For each={props.ids}>
        {(slot, i) => (
          <>
            <Keycap slot={slot} strong={i() === 0} small={props.small ?? false} />
            <Show when={i() < props.ids.length - 1}>
              <span class={styles.then} aria-hidden="true">
                ›
              </span>
            </Show>
          </>
        )}
      </For>
    </span>
  );
}

/** Flash reads first in a pair (the files list the lower id first). */
const FLASH = 4;
export const flashFirst = (ids: readonly number[]) => [...ids].sort((a, b) => Number(b === FLASH) - Number(a === FLASH));

export function SpellsCard(props: { build: BuildStats }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.spells.get(id)?.name ?? t().common.spellN(id);
  return (
    <Card title={t().champions.spells}>
      <Show when={props.build.spells.top.length > 0} fallback={<p class={styles.none}>{t().stats.notEnoughGames}</p>}>
        <ol class={styles.options}>
          <For each={props.build.spells.top.slice(0, 3)}>
            {(o) => (
              <li class={styles.option}>
                <span class={styles.visual}>
                  <For each={flashFirst(o.ids)}>{(id) => <SpellIcon spellId={id} size={32} focusable />}</For>
                  <span class={styles.label}>{flashFirst(o.ids).map(name).join(" + ")}</span>
                </span>
                <OptionStats option={o} section={props.build.spells} />
              </li>
            )}
          </For>
        </ol>
      </Show>
    </Card>
  );
}

/**
 * Two things, each named: the spell to max first (then the next), and the spell taken at each of
 * the first levels. The runner-up max order is left out: two rows read at a glance.
 */
export function SkillsCard(props: { build: BuildStats }): JSX.Element {
  return (
    <Card title={t().champions.skills}>
      <Show when={props.build.skills.top[0]} fallback={<p class={styles.none}>{t().stats.notEnoughGames}</p>}>
        {(main) => (
          <div class={styles.skills}>
            <div class={styles.option} data-testid="skills-max">
              <span class={`${styles.visual} ${styles.wraps}`}>
                <span class={styles.skillLabel}>{t().champions.maxLabel}</span>
                <MaxOrder ids={main().ids} />
              </span>
              <OptionStats option={main()} section={props.build.skills} />
            </div>
            <Show when={props.build.skillStart.top[0]}>
              {(start) => (
                <div class={styles.option} data-testid="skills-start">
                  <span class={`${styles.visual} ${styles.wraps}`}>
                    <span class={styles.skillLabel}>{t().champions.levelsLabel(start().ids.length)}</span>
                    <ol class={styles.firstKeys} aria-label={t().champions.firstPointsLabel}>
                      <For each={start().ids}>
                        {(slot, i) => (
                          <li class={styles.level}>
                            <span class={`${styles.levelNumber} num`} aria-hidden="true">
                              {i() + 1}
                            </span>
                            <Keycap slot={slot} small />
                          </li>
                        )}
                      </For>
                    </ol>
                  </span>
                  <OptionStats option={start()} section={props.build.skillStart} />
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </Card>
  );
}

function ItemRow(props: { option: BuildOption; section: BuildSection; named?: boolean; chain?: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = (id: number) => gameData()?.items.get(id)?.name ?? t().common.itemN(id);
  return (
    <li class={styles.option}>
      <span class={styles.visual}>
        <For each={props.option.ids}>
          {(id, i) => (
            <>
              <ItemIcon itemId={id} size={32} focusable />
              <Show when={props.chain && i() < props.option.ids.length - 1}>
                <span class={styles.then} aria-hidden="true">
                  ›
                </span>
              </Show>
            </>
          )}
        </For>
        <Show when={props.named}>
          <span class={styles.label}>{props.option.ids.map(name).join(", ")}</span>
        </Show>
      </span>
      <OptionStats option={props.option} section={props.section} />
    </li>
  );
}

/** Starting items, core build in order, boots, and the 4th/5th/6th item options. */
export function ItemsCard(props: { build: BuildStats }): JSX.Element {
  const b = () => props.build;
  return (
    <Card title={t().champions.items}>
      <div class={styles.items}>
        <div class={styles.itemsGrid}>
          <Section title={t().champions.starting} section={b().starts} class={styles.starts}>
            <ol class={styles.options}>
              <For each={b().starts.top.slice(0, 2)}>{(o) => <ItemRow option={o} section={b().starts} />}</For>
            </ol>
          </Section>
          <Section title={t().champions.boots} section={b().boots} class={styles.boots}>
            <ol class={styles.options}>
              <For each={b().boots.top.slice(0, 2)}>{(o) => <ItemRow option={o} section={b().boots} named />}</For>
            </ol>
          </Section>
          <Section title={t().champions.core} section={b().core} class={styles.core}>
            <ol class={styles.options}>
              <For each={b().core.top.slice(0, 3)}>{(o) => <ItemRow option={o} section={b().core} chain named />}</For>
            </ol>
          </Section>
          <div class={styles.later}>
            <For
              each={[
                { title: t().champions.nth(4), section: b().item4 },
                { title: t().champions.nth(5), section: b().item5 },
                { title: t().champions.nth(6), section: b().item6 },
              ]}
            >
              {(slot) => (
                <Section title={slot.title} section={slot.section}>
                  <ol class={styles.options}>
                    <For each={slot.section.top.slice(0, 3)}>{(o) => <ItemRow option={o} section={slot.section} />}</For>
                  </ol>
                </Section>
              )}
            </For>
          </div>
        </div>
      </div>
    </Card>
  );
}
