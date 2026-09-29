import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BuildStats } from "../../data/generated/BuildStats";
import type { ChampionPage } from "../../data/generated/ChampionPage";
import type { Role } from "../../data/generated/Role";
import { Card } from "../../design/Card";
import { ItemIcon, SpellIcon } from "../../design/GameIcon";
import { RuneIcon, RuneStyleIcon } from "../../design/RuneIcon";
import { t } from "../../i18n";
import { percent } from "../../lib/format";
import { runePage } from "../../lib/runes";
import { buildFor, winRateOf } from "../../lib/stats";
import styles from "./BuildSummary.module.css";
import { flashFirst, MaxOrder } from "./Builds";

/** The build to summarize for a role: that role's, else the champion's most played one. */
export function summaryBuild(page: ChampionPage, role: Role | undefined): BuildStats | undefined {
  return buildFor(page, role) ?? page.builds?.roles[0];
}

/**
 * The most played build at a glance: keystone and secondary tree, summoner spells, skill max
 * order and the three core items, with the record behind them. Compact enough for an in-game
 * view (the Live page), from `champion_stats` for the player's champion and role.
 */
export function BuildSummary(props: { championId: number; build: BuildStats; title?: string }): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.championId)?.name ?? t().common.championN(props.championId);
  const page = () => {
    const ids = props.build.runes.top[0]?.ids;
    return ids ? runePage(ids) : undefined;
  };
  const spells = () => props.build.spells.top[0];
  const skills = () => props.build.skills.top[0];
  const core = () => props.build.core.top[0];
  const heading = () => props.title ?? t().champions.buildTitle(champion(), props.build.role ?? undefined);
  return (
    <Card title={heading()}>
      <div class={styles.summary} data-testid="build-summary">
        <div class={styles.block}>
          <span class={styles.label}>{t().champions.summary.runes}</span>
          <Show when={page()} fallback={<span class={styles.none}>–</span>}>
            {(p) => (
              <span class={styles.icons}>
                <RuneIcon runeId={p().perks[0] ?? 0} size={36} />
                <RuneStyleIcon styleId={p().sub} size={20} />
              </span>
            )}
          </Show>
        </div>
        <div class={styles.block}>
          <span class={styles.label}>{t().champions.summary.spells}</span>
          <Show when={spells()} fallback={<span class={styles.none}>–</span>}>
            {(s) => (
              <span class={styles.icons}>
                <For each={flashFirst(s().ids)}>{(id) => <SpellIcon spellId={id} size={28} focusable />}</For>
              </span>
            )}
          </Show>
        </div>
        <div class={styles.block}>
          <span class={styles.label}>{t().champions.summary.skills}</span>
          <Show when={skills()} fallback={<span class={styles.none}>–</span>}>
            {(s) => (
              <span class={styles.icons}>
                <MaxOrder ids={s().ids} small />
              </span>
            )}
          </Show>
        </div>
        <div class={styles.block}>
          <span class={styles.label}>{t().champions.summary.core}</span>
          <Show when={core()} fallback={<span class={styles.none}>–</span>}>
            {(c) => (
              <span class={styles.icons}>
                <For each={c().ids}>
                  {(id, i) => (
                    <>
                      <ItemIcon itemId={id} size={28} focusable />
                      <Show when={i() < c().ids.length - 1}>
                        <span class={styles.then} aria-hidden="true">
                          ›
                        </span>
                      </Show>
                    </>
                  )}
                </For>
              </span>
            )}
          </Show>
        </div>
        <p class={`${styles.record} num`}>
          <span class={styles.wr}>{percent(winRateOf(props.build) ?? 0, 1)}</span> {t().champions.buildRecord(props.build.g)}
        </p>
      </div>
    </Card>
  );
}
