import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BuildOption } from "../../data/generated/BuildOption";
import type { BuildStats } from "../../data/generated/BuildStats";
import type { RuneStyle } from "../../data/generated/RuneStyle";
import { Card } from "../../design/Card";
import { RuneIcon, RuneStyleIcon, ShardIcon } from "../../design/RuneIcon";
import { percent } from "../../lib/format";
import { type RunePage, runePage, SHARD_ROWS, styleTone } from "../../lib/runes";
import { optionShare, winRateOf } from "../../lib/stats";
import { OptionStats } from "./Builds";
import styles from "./Runes.module.css";

/** Pages shown as alternatives under the full page. */
const MAX_PAGES = 3;

/** One tree of the page: every rune of the rows shown, the chosen ones lit. */
function Tree(props: {
  styleId: number;
  style: RuneStyle | undefined;
  rows: number[];
  chosen: ReadonlySet<number>;
  fallback: number[];
}): JSX.Element {
  const keystone = () => (props.rows[0] === 0 ? props.style?.slots[0]?.find((r) => props.chosen.has(r.id)) : undefined);
  return (
    <div class={`${styles.tree} ${styles[styleTone(props.styleId)]}`}>
      <div class={styles.treeHead}>
        <RuneStyleIcon styleId={props.styleId} size={24} decorative />
        <span class={styles.treeName}>{props.style?.name ?? "Runes"}</span>
        <Show when={keystone()}>{(k) => <span class={styles.keystoneName}>{k().name}</span>}</Show>
      </div>
      <Show
        when={props.style}
        fallback={
          <div class={styles.row}>
            <For each={props.fallback}>{(id) => <RuneIcon runeId={id} size={28} />}</For>
          </div>
        }
      >
        {(style) => (
          <For each={props.rows}>
            {(row) => (
              <div class={`${styles.row} ${row === 0 ? styles.keystones : ""}`}>
                <For each={style().slots[row] ?? []}>
                  {(rune) => (
                    <RuneIcon
                      runeId={rune.id}
                      size={row === 0 ? 40 : 28}
                      decorative={!props.chosen.has(rune.id)}
                      class={props.chosen.has(rune.id) ? styles.on : styles.off}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        )}
      </Show>
    </div>
  );
}

function Shards(props: { chosen: readonly number[] }): JSX.Element {
  return (
    <div class={`${styles.tree} ${styles.shards}`}>
      <div class={styles.treeHead}>
        <span class={styles.treeName}>Shards</span>
      </div>
      <For each={SHARD_ROWS}>
        {(row, i) => {
          const pick = () => props.chosen[i()];
          // An older shard the row no longer offers still shows, after the current ones.
          const ids = () => {
            const p = pick();
            return p === undefined || row.ids.includes(p) ? row.ids : [...row.ids, p];
          };
          return (
            <div class={styles.row} title={row.label}>
              <For each={ids()}>{(id) => <ShardIcon shardId={id} size={24} chosen={id === pick()} />}</For>
            </div>
          );
        }}
      </For>
    </div>
  );
}

/** A full rune page: primary tree with its keystone, secondary tree, stat shards. */
export function RunePageView(props: { page: RunePage }): JSX.Element {
  const { gameData } = useData();
  const chosen = createMemo(() => new Set([...props.page.perks, ...props.page.subPerks]));
  return (
    <div class={styles.page} data-testid="rune-page-view">
      <Tree
        styleId={props.page.primary}
        style={gameData()?.runeStyles.get(props.page.primary)}
        rows={[0, 1, 2, 3]}
        chosen={chosen()}
        fallback={props.page.perks}
      />
      <Tree
        styleId={props.page.sub}
        style={gameData()?.runeStyles.get(props.page.sub)}
        rows={[1, 2, 3]}
        chosen={chosen()}
        fallback={props.page.subPerks}
      />
      <Shards chosen={props.page.shards} />
    </div>
  );
}

interface PageOption {
  option: BuildOption;
  page: RunePage;
}

/** The most played rune page in full, the next ones one click away. Each with its record. */
export function RunesCard(props: { build: BuildStats }): JSX.Element {
  const { gameData } = useData();
  const pages = createMemo(() =>
    props.build.runes.top
      .map((option) => ({ option, page: runePage(option.ids) }))
      .filter((p): p is PageOption => p.page !== undefined)
      .slice(0, MAX_PAGES),
  );
  const [picked, setPicked] = createSignal(0);
  // Another role or queue shows its most played page first.
  createEffect(
    on(
      () => props.build,
      () => setPicked(0),
      { defer: true },
    ),
  );
  const current = () => pages()[picked()] ?? pages()[0];
  const describe = (p: PageOption) => {
    const keystone = gameData()?.runes.get(p.page.perks[0] ?? 0)?.rune.name ?? "Keystone";
    const sub = gameData()?.runeStyles.get(p.page.sub)?.name ?? "secondary tree";
    const wr = winRateOf(p.option);
    return `${keystone} with ${sub}: ${percent(wr ?? 0, 1)} win rate, ${percent(optionShare(p.option, props.build.runes), 1)} pick`;
  };
  return (
    <Card
      title="Runes"
      // An "Import" action (rune page into the client, HANDOFF job 5) goes next to these numbers.
      actions={<Show when={current()}>{(c) => <OptionStats option={c().option} section={props.build.runes} large />}</Show>}
    >
      <Show when={current()} fallback={<p class={styles.none}>Not enough games yet.</p>}>
        {(c) => (
          <div class={styles.body}>
            <RunePageView page={c().page} />
            <Show when={pages().length > 1}>
              <div class={styles.alternatives}>
                <span class={styles.altTitle}>Most played pages</span>
                <For each={pages()}>
                  {(p, i) => (
                    <button
                      type="button"
                      class={styles.alt}
                      aria-pressed={i() === picked()}
                      aria-label={describe(p)}
                      title={describe(p)}
                      onClick={() => setPicked(i())}
                      data-testid="rune-page"
                    >
                      <RuneIcon runeId={p.page.perks[0] ?? 0} size={28} decorative />
                      <RuneStyleIcon styleId={p.page.sub} size={20} decorative />
                      <span class={`${styles.altStats} num`}>
                        <span class={styles.altWr}>{percent(winRateOf(p.option) ?? 0, 1)}</span>
                        <span class={styles.altPick}>{percent(optionShare(p.option, props.build.runes))}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </Card>
  );
}
