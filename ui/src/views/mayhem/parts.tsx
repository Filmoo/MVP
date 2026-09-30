/**
 * ARAM: Mayhem's pieces shared by its page, the champion page's Mayhem tab, Draft and Live:
 * the augments (one request per language for the whole app), an augment's tile, and one
 * champion's augments ranked per rarity with their reasons. Pick rates only, never win rates.
 */
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { AugmentInfo } from "../../data/generated/AugmentInfo";
import type { AugmentPriority } from "../../data/generated/AugmentPriority";
import type { AugmentRarity } from "../../data/generated/AugmentRarity";
import type { AugmentTier } from "../../data/generated/AugmentTier";
import type { MayhemChampion } from "../../data/generated/MayhemChampion";
import type { Transport } from "../../data/transport";
import { ItemIcon } from "../../design/GameIcon";
import { Glyph } from "../../design/Glyph";
import { Segmented } from "../../design/Segmented";
import { Skeleton } from "../../design/States";
import { TierMark as Medallion } from "../../design/TierMark";
import { type Lang, lang, t } from "../../i18n";
import { percent } from "../../lib/format";
import { backendError } from "../../lib/players";
import { createQuery } from "../../lib/query";
import styles from "./parts.module.css";

/** ARAM: Mayhem's queues: matchmade, custom. */
export const isMayhem = (queue: number | null | undefined): boolean => queue === 2400 || queue === 3270;

/** `picked in 34%…` → `Picked in 34%…`: a reason that starts a line. */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const catalogs = new Map<Lang, Promise<Map<number, AugmentInfo> | null>>();

function augmentsIn(transport: Transport, language: Lang): Promise<Map<number, AugmentInfo> | null> {
  let answer = catalogs.get(language);
  if (!answer) {
    answer = transport.call("mayhem_augments", { language }).then((list) => (list ? new Map(list.augments.map((a) => [a.id, a])) : null));
    catalogs.set(language, answer);
    // Asked again next time when there is nothing yet, or it failed.
    const drop = () => catalogs.get(language) === answer && catalogs.delete(language);
    answer.then((map) => map || drop(), drop);
  }
  return answer;
}

/** Mayhem's augments by id, in the UI's language (`null`: not built yet on our server). */
export function useAugments() {
  const { transport } = useData();
  return createQuery(lang, (language) => augmentsIn(transport, language));
}

const champions = new Map<number, { at: number; answer: Promise<MayhemChampion> }>();

/** One champion in Mayhem, shared by the views for a minute (Draft asks for each row on every change). */
export function championIn(transport: Transport, championId: number): Promise<MayhemChampion> {
  const hit = champions.get(championId);
  if (hit && Date.now() - hit.at < 60_000) return hit.answer;
  const answer = transport.call("mayhem_champion", { championId });
  champions.set(championId, { at: Date.now(), answer });
  answer.catch(() => champions.get(championId)?.answer === answer && champions.delete(championId));
  return answer;
}

/** Mayhem's spark on a tile without art, by the tile's size. */
const SPARK = { 24: 14, 32: 16, 40: 20 } as const;

/** An augment's tile: its art (the game's, at run time) on its rarity's colour, else Mayhem's spark in it. */
export function AugmentIcon(props: { augment: AugmentInfo | undefined; size: 24 | 32 | 40 }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return (
    <span class={`${styles.tile} ${styles[props.augment?.rarity ?? "silver"]} ${styles[`s${props.size}`]}`} aria-hidden="true">
      <Show when={props.augment?.icon && !failed()} fallback={<Glyph name="mayhem" size={SPARK[props.size]} />}>
        <img
          src={props.augment?.icon}
          alt=""
          width={props.size}
          height={props.size}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </Show>
    </span>
  );
}

/**
 * An augment's tier and its rank in it (`S · 2`: first is best; inside its tier's section, `#2`),
 * in the tier's colour; on hover, what MVP's tiers are (design/tip). Not the stats pages' grade
 * badge: that one explains win rates.
 */
export function RankPill(props: { tier: AugmentTier; rank: number; inTier?: boolean }): JSX.Element {
  const words = () => t().mayhem.ranked(props.tier, props.rank);
  return (
    <span
      class={`${styles.rank} ${styles[`tier${props.tier}`]} num`}
      role="img"
      aria-label={words()}
      data-hint-title={words()}
      data-hint={t().mayhem.tierHint}
    >
      {props.inTier ? t().tierList.rankN(props.rank) : `${props.tier} · ${props.rank}`}
    </span>
  );
}

/**
 * A tier's medallion, as on the tier list (the Mayhem page's headings), with what MVP's tiers are:
 * made by hand, not the tier list's win rates.
 */
export function TierMark(props: { tier: AugmentTier }): JSX.Element {
  return (
    <span
      class={styles.mark}
      role="img"
      aria-label={t().mayhem.tier(props.tier)}
      data-hint-title={t().mayhem.tier(props.tier)}
      data-hint={t().mayhem.tierHint}
    >
      <Medallion grade={props.tier} size="md" decorative />
    </span>
  );
}

/**
 * How far the shared games are from switching a feature on: what it is, `12 / 30` and a bar. The
 * views show it instead of numbers too few games would make up.
 */
export function Meter(props: { label: string; count: string; have: number; needed: number }): JSX.Element {
  const done = () => Math.min(props.have, props.needed);
  return (
    <div class={styles.meter} data-testid="mayhem-meter">
      <span>{props.label}</span>
      <span class={`${styles.count} num`}>{props.count}</span>
      <span
        class={styles.bar}
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={props.needed}
        aria-valuenow={done()}
        aria-valuetext={props.count}
      >
        <span class={styles.fill} style={{ width: `${(done() / Math.max(props.needed, 1)) * 100}%` }} />
      </span>
    </div>
  );
}

/** The champion's pick rate once it counts (enough games): `Picked in 34% of Jinx games`. */
export function pickLine(entry: AugmentPriority, champion: string): string {
  return entry.pickRate !== null && entry.picks > 0 ? sentence(t().mayhem.pickedBy(percent(entry.pickRate), champion)) : "";
}

/**
 * An augment in a list: tile, name, a line under it (a pick rate), and at the end its tier and
 * rank, or a number (`value`, its words in `valueHint`). What it does shows on hover and on
 * keyboard focus (design/tip).
 */
export function AugmentRow(props: {
  augment: AugmentInfo | undefined;
  line?: string;
  tier?: AugmentTier | null;
  rank?: number | null;
  value?: string;
  valueHint?: string;
  size?: 24 | 32;
}): JSX.Element {
  const placed = () => (props.tier && props.rank ? { tier: props.tier, rank: props.rank } : undefined);
  const does = () => props.augment?.description || undefined;
  return (
    <li
      class={styles.row}
      data-hint={does()}
      // What it does (design/tip) shows on keyboard focus too.
      tabIndex={does() ? 0 : undefined}
    >
      <AugmentIcon augment={props.augment} size={props.size ?? 32} />
      <span class={styles.text}>
        <span class={styles.name}>{props.augment?.name ?? t().mayhem.augments}</span>
        <Show when={props.line}>
          <span class={`${styles.line} num`}>{props.line}</span>
        </Show>
      </span>
      <Show when={placed()}>{(p) => <RankPill tier={p().tier} rank={p().rank} />}</Show>
      <Show when={props.value}>
        <span class={`${styles.value} num`} data-hint={props.valueHint}>
          {props.value}
        </span>
      </Show>
    </li>
  );
}

/**
 * The champion's three most picked augments as small tiles, the first one named (Draft's rows).
 * Only once its shared games count (`minGames`), as for its pick rates everywhere.
 */
export function TopAugments(props: { championId: number; name: string }): JSX.Element {
  const { transport } = useData();
  const augments = useAugments();
  const champion = createQuery(
    () => props.championId,
    (id) => championIn(transport, id),
  );
  const top = () => {
    const c = champion.data();
    return c && c.games >= c.minGames ? c.augments.slice(0, 3) : [];
  };
  return (
    <Show when={top().length > 0 && augments.data()}>
      {(known) => (
        <span class={styles.top} data-testid="top-augments">
          <For each={top()}>
            {(pick) => {
              const augment = () => known().get(pick.id);
              const games = champion.data()?.games ?? 0;
              return (
                <span
                  class={styles.topTile}
                  data-hint-title={augment()?.name}
                  data-hint={sentence(t().mayhem.pickedBy(percent(pick.n / Math.max(games, 1)), props.name))}
                >
                  <AugmentIcon augment={augment()} size={24} />
                </span>
              );
            }}
          </For>
          <span class={styles.topName}>{known().get(top()[0]?.id ?? 0)?.name}</span>
        </span>
      )}
    </Show>
  );
}

/** How the lists are ordered, in a sentence (below enough games, the meter says how far it is). */
function orderLine(c: MayhemChampion, name: string): string {
  const words = t().mayhem;
  if (c.priorities.every((p) => p.entries.length === 0)) return words.none;
  const byRate = c.priorities.some((p) => p.byPickRate);
  if (!c.tiered) return words.order.byPicks(name, c.games);
  return byRate ? words.order.byRate(name, c.games) : words.order.byTier;
}

/**
 * One champion's augments: ranked per rarity (each offer in Mayhem is one rarity) with their
 * reasons, then (`full`) its most picked augments and common final items.
 */
export function ChampionAugments(props: { championId: number; name: string; full?: boolean }): JSX.Element {
  const { transport } = useData();
  const augments = useAugments();
  const champion = createQuery(
    () => props.championId,
    (id) => championIn(transport, id),
  );
  const known = () => augments.data() ?? undefined;
  const failure = () => champion.error() ?? augments.error();
  const unbuilt = () => augments.data() === null || (failure() !== undefined && backendError(failure()).kind === "notFound");
  return (
    <div class={styles.champion} data-testid="mayhem-champion">
      <Switch>
        <Match when={unbuilt()}>
          <p class={styles.note}>{t().mayhem.unbuilt.text}</p>
        </Match>
        <Match when={failure() !== undefined && !champion.loading()}>
          <p class={styles.note} role="alert">
            {t().mayhem.failed}{" "}
            <button
              type="button"
              class={styles.retry}
              onClick={() => {
                champion.refetch();
                augments.refetch();
              }}
            >
              {t().common.tryAgain}
            </button>
          </p>
        </Match>
        <Match when={!champion.data() || !known()}>
          <div class={styles.columns} aria-busy="true">
            <For each={[0, 1, 2]}>{() => <Skeleton height="176px" />}</For>
          </div>
        </Match>
        <Match when={champion.data()}>
          {(c) => <ChampionAugmentsView champion={c()} augments={known()} name={props.name} full={props.full} />}
        </Match>
      </Switch>
    </div>
  );
}

const RARITIES: readonly AugmentRarity[] = ["silver", "gold", "prismatic"];
/** Draft's narrow panel shows one rarity at a time; the choice stays from one champion to the next. */
const [panelRarity, setPanelRarity] = createSignal<AugmentRarity>("silver");

/**
 * What `ChampionAugments` shows once it has the champion and the augments: every rarity side by
 * side (`full`), or one at a time with a switch (Draft's panel). Pick rates, its most picked
 * augments and common items only once its shared games count (`minGames`).
 */
export function ChampionAugmentsView(props: {
  champion: MayhemChampion;
  augments: ReadonlyMap<number, AugmentInfo> | undefined;
  name: string;
  full?: boolean | undefined;
}): JSX.Element {
  const c = () => props.champion;
  const games = () => Math.max(c().games, 1);
  const lists = () => (props.full ? c().priorities : c().priorities.filter((list) => list.rarity === panelRarity()));
  const rate = (n: number) => percent(n / games());
  return (
    <>
      <p class={styles.note}>{orderLine(c(), props.name)}</p>
      <Show when={c().games < c().minGames}>
        <div class={styles.gathering}>
          <Meter
            label={t().mayhem.gathering.champion(props.name, c().minGames)}
            count={t().mayhem.gathering.count(c().games, c().minGames)}
            have={c().games}
            needed={c().minGames}
          />
          <Show when={props.full}>
            <a href="#/settings">{t().settings.stats.shareMayhem.title}</a>
          </Show>
        </div>
      </Show>
      <Show when={!props.full}>
        <Segmented
          label={t().mayhem.rarity}
          size="sm"
          class={styles.switch}
          options={RARITIES.map((value) => ({ value, label: t().mayhem.rarities[value] }))}
          value={panelRarity()}
          onChange={setPanelRarity}
          testId="augment-rarity"
        />
      </Show>
      <div class={styles.columns}>
        <For each={lists()}>
          {(list) => (
            <section class={styles.column} data-rarity={list.rarity}>
              <Show when={props.full}>
                <h3 class={`${styles.rarity} ${styles[list.rarity]}`}>{t().mayhem.rarities[list.rarity]}</h3>
              </Show>
              <Show when={list.entries.length > 0} fallback={<p class={styles.empty}>—</p>}>
                <ol class={styles.list}>
                  <For each={list.entries}>
                    {(entry) => (
                      <AugmentRow
                        augment={props.augments?.get(entry.id)}
                        line={pickLine(entry, props.name)}
                        tier={entry.tier}
                        rank={entry.rank}
                        size={props.full ? 32 : 24}
                      />
                    )}
                  </For>
                </ol>
              </Show>
            </section>
          )}
        </For>
      </div>
      <Show when={props.full && c().games > 0 && c().games >= c().minGames}>
        {/* Three tracks like the rarities above: Most picked under Silver, items under Gold. */}
        <div class={styles.extras}>
          <section class={styles.column}>
            <h3 class={styles.heading}>{t().mayhem.mostPicked}</h3>
            <ol class={styles.list}>
              <For each={c().augments.slice(0, 5)}>
                {(pick) => (
                  <AugmentRow
                    augment={props.augments?.get(pick.id)}
                    value={rate(pick.n)}
                    valueHint={sentence(t().mayhem.pickedBy(rate(pick.n), props.name))}
                  />
                )}
              </For>
            </ol>
          </section>
          <section class={styles.column}>
            <h3 class={styles.heading}>{t().mayhem.items}</h3>
            <ol class={styles.items}>
              <For each={c().items.slice(0, 8)}>
                {(item) => (
                  <li class={styles.item}>
                    <ItemIcon itemId={item.id} size={32} focusable />
                    <span class={`${styles.line} num`}>{rate(item.n)}</span>
                  </li>
                )}
              </For>
            </ol>
          </section>
        </div>
      </Show>
    </>
  );
}
