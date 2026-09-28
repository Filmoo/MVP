import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BuildOption } from "../../data/generated/BuildOption";
import type { BuildSection } from "../../data/generated/BuildSection";
import type { BuildStats } from "../../data/generated/BuildStats";
import { Card } from "../../design/Card";
import { ItemIcon, SpellIcon } from "../../design/GameIcon";
import { games, percent } from "../../lib/format";
import { optionShare, SKILL_KEYS, winRateOf } from "../../lib/stats";
import styles from "./Builds.module.css";

/** An option's win rate with its games, and how often it is picked. */
export function OptionStats(props: { option: BuildOption; section: BuildSection; large?: boolean }): JSX.Element {
  const wr = () => winRateOf(props.option);
  return (
    <span class={`${styles.stats} ${props.large ? styles.large : ""} num`}>
      <span class={styles.stat} title={`${props.option.w} wins in ${props.option.g} games`}>
        <span class={styles.wr}>{percent(wr() ?? 0, 1)}</span>
        <span class={styles.caption}>{games(props.option.g)} games</span>
      </span>
      <span class={styles.stat} title={`Picked in ${props.option.g} of ${props.section.n} games`}>
        <span class={styles.pick}>{percent(optionShare(props.option, props.section), 1)}</span>
        <span class={styles.caption}>pick</span>
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
        <span class={`${styles.sectionGames} num`}>{games(props.section.n)} games</span>
      </h3>
      <Show when={props.section.top.length > 0} fallback={<p class={styles.none}>Not enough games yet.</p>}>
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
    <span class={styles.order} role="img" aria-label={`Max ${props.ids.map((s) => SKILL_KEYS[s] ?? "?").join(", then ")}`}>
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
  const name = (id: number) => gameData()?.spells.get(id)?.name ?? `Spell ${id}`;
  return (
    <Card title="Summoner spells">
      <Show when={props.build.spells.top.length > 0} fallback={<p class={styles.none}>Not enough games yet.</p>}>
        <ol class={styles.options}>
          <For each={props.build.spells.top.slice(0, 3)}>
            {(o) => (
              <li class={styles.option}>
                <span class={styles.visual}>
                  <For each={flashFirst(o.ids)}>{(id) => <SpellIcon spellId={id} size={32} tooltip />}</For>
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

export function SkillsCard(props: { build: BuildStats }): JSX.Element {
  return (
    <Card title="Skill order">
      <Show when={props.build.skills.top[0]} fallback={<p class={styles.none}>Not enough games yet.</p>}>
        {(main) => (
          <div class={styles.skills}>
            <div class={styles.option}>
              <MaxOrder ids={main().ids} />
              <OptionStats option={main()} section={props.build.skills} />
            </div>
            <Show when={props.build.skillStart.top[0]}>
              {(start) => (
                <div class={styles.option}>
                  <span class={`${styles.visual} ${styles.wraps}`}>
                    <span class={styles.firstLabel}>First points</span>
                    <ol class={styles.firstKeys} aria-label="First four skill points">
                      <For each={start().ids}>
                        {(slot) => (
                          <li>
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
            <Show when={props.build.skills.top[1]}>
              {(other) => (
                <div class={`${styles.option} ${styles.alt}`}>
                  <span class={`${styles.visual} ${styles.wraps}`}>
                    <span class={styles.firstLabel}>Or</span>
                    <MaxOrder ids={other().ids} small />
                  </span>
                  <OptionStats option={other()} section={props.build.skills} />
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
  const name = (id: number) => gameData()?.items.get(id)?.name ?? `Item ${id}`;
  return (
    <li class={styles.option}>
      <span class={styles.visual}>
        <For each={props.option.ids}>
          {(id, i) => (
            <>
              <ItemIcon itemId={id} size={32} tooltip />
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
    <Card title="Items">
      <div class={styles.items}>
        <div class={styles.itemsGrid}>
          <Section title="Starting items" section={b().starts} class={styles.starts}>
            <ol class={styles.options}>
              <For each={b().starts.top.slice(0, 2)}>{(o) => <ItemRow option={o} section={b().starts} />}</For>
            </ol>
          </Section>
          <Section title="Boots" section={b().boots} class={styles.boots}>
            <ol class={styles.options}>
              <For each={b().boots.top.slice(0, 2)}>{(o) => <ItemRow option={o} section={b().boots} named />}</For>
            </ol>
          </Section>
          <Section title="Core build" section={b().core} class={styles.core}>
            <ol class={styles.options}>
              <For each={b().core.top.slice(0, 3)}>{(o) => <ItemRow option={o} section={b().core} chain named />}</For>
            </ol>
          </Section>
          <div class={styles.later}>
            <For
              each={[
                { title: "4th item", section: b().item4 },
                { title: "5th item", section: b().item5 },
                { title: "6th item", section: b().item6 },
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
