/**
 * ARAM: Mayhem's pieces shared by its page, the champion page's Mayhem tab, Draft and Live:
 * the augments (one request per language for the whole app), an augment's tile, and one
 * champion's augments ranked per rarity with their reasons. Pick rates only, never win rates.
 */
import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { AugmentInfo } from "../../data/generated/AugmentInfo";
import type { AugmentPriority } from "../../data/generated/AugmentPriority";
import type { MayhemChampion } from "../../data/generated/MayhemChampion";
import type { Transport } from "../../data/transport";
import { ItemIcon } from "../../design/GameIcon";
import { Skeleton } from "../../design/States";
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
    answer = transport
      .call("mayhem_augments", { language })
      .then((list) => (list ? new Map(list.augments.map((a) => [a.id, a])) : null));
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .slice(0, 2);

/** An augment's tile: its glyph (the game's art, at run time) on its rarity's colour, else its initials. */
export function AugmentIcon(props: { augment: AugmentInfo | undefined; size: 24 | 32 | 40 }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  return (
    <span class={`${styles.tile} ${styles[props.augment?.rarity ?? "silver"]} ${styles[`s${props.size}`]}`} aria-hidden="true">
      <Show when={props.augment?.icon && !failed()} fallback={<span class={styles.initials}>{initials(props.augment?.name ?? "?")}</span>}>
        <img src={props.augment?.icon} alt="" width={props.size} height={props.size} loading="lazy" draggable={false} onError={() => setFailed(true)} />
      </Show>
    </span>
  );
}

/** Why an entry stands where it does: `S tier · #2 · picked in 34% of Jinx games`. */
export function reasons(entry: AugmentPriority, champion: string): string {
  const parts: string[] = [];
  if (entry.tier && entry.rank) parts.push(t().mayhem.ranked(entry.tier, entry.rank));
  if (entry.pickRate !== null && entry.picks > 0) parts.push(t().mayhem.pickedBy(percent(entry.pickRate), champion));
  return sentence(parts.join(" · "));
}

/** An augment in a list: tile, name, and a line under it (its reason, or its description). */
export function AugmentRow(props: { augment: AugmentInfo | undefined; line: string; size?: 24 | 32 }): JSX.Element {
  return (
    <li class={styles.row} title={props.augment?.description || undefined}>
      <AugmentIcon augment={props.augment} size={props.size ?? 32} />
      <span class={styles.text}>
        <span class={styles.name}>{props.augment?.name ?? t().mayhem.augments}</span>
        <Show when={props.line}>
          <span class={`${styles.line} num`}>{props.line}</span>
        </Show>
      </span>
    </li>
  );
}

/** The champion's three most picked augments, as small tiles (Draft's rows). */
export function TopAugments(props: { championId: number; name: string }): JSX.Element {
  const { transport } = useData();
  const augments = useAugments();
  const champion = createQuery(
    () => props.championId,
    (id) => championIn(transport, id),
  );
  const top = () => (champion.data()?.augments ?? []).slice(0, 3);
  return (
    <Show when={top().length > 0 && augments.data()}>
      {(known) => (
        <span class={styles.top} data-testid="top-augments">
          <For each={top()}>
            {(pick) => {
              const augment = () => known().get(pick.id);
              const games = champion.data()?.games ?? 0;
              return (
                <span title={`${augment()?.name ?? ""} · ${t().mayhem.pickedBy(percent(pick.n / Math.max(games, 1)), props.name)}`}>
                  <AugmentIcon augment={augment()} size={24} />
                </span>
              );
            }}
          </For>
        </span>
      )}
    </Show>
  );
}

/** How the lists are ordered, in a sentence. */
function orderLine(c: MayhemChampion, name: string): string {
  const words = t().mayhem;
  if (c.priorities.every((p) => p.entries.length === 0)) return words.none;
  const byRate = c.priorities.some((p) => p.byPickRate);
  if (!c.tiered) return words.order.byPicks(name, c.games);
  return byRate ? words.order.byRate(name, c.games) : words.order.byTier(name, c.games, c.minGames);
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

/** What `ChampionAugments` shows once it has the champion and the augments. */
export function ChampionAugmentsView(props: {
  champion: MayhemChampion;
  augments: ReadonlyMap<number, AugmentInfo> | undefined;
  name: string;
  full?: boolean | undefined;
}): JSX.Element {
  const c = () => props.champion;
  const games = () => Math.max(c().games, 1);
  return (
    <>
      <p class={styles.note}>{orderLine(c(), props.name)}</p>
      <div class={styles.columns}>
        <For each={c().priorities}>
          {(list) => (
            <section class={styles.column} data-rarity={list.rarity}>
              <h3 class={`${styles.rarity} ${styles[list.rarity]}`}>{t().mayhem.rarities[list.rarity]}</h3>
              <Show when={list.entries.length > 0} fallback={<p class={styles.empty}>—</p>}>
                <ol class={styles.list}>
                  <For each={list.entries}>
                    {(entry) => <AugmentRow augment={props.augments?.get(entry.id)} line={reasons(entry, props.name)} size={props.full ? 32 : 24} />}
                  </For>
                </ol>
              </Show>
            </section>
          )}
        </For>
      </div>
      <Show when={props.full && c().games > 0}>
        <div class={styles.extras}>
          <section class={styles.column}>
            <h3 class={styles.heading}>{t().mayhem.mostPicked}</h3>
            <ol class={styles.list}>
              <For each={c().augments.slice(0, 5)}>
                {(pick) => (
                  <AugmentRow augment={props.augments?.get(pick.id)} line={sentence(t().mayhem.pickedBy(percent(pick.n / games()), props.name))} />
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
                    <ItemIcon itemId={item.id} size={32} tooltip />
                    <span class={`${styles.line} num`}>{percent(item.n / games())}</span>
                  </li>
                )}
              </For>
            </ol>
          </section>
        </div>
      </Show>
      <Show when={props.full && c().games === 0}>
        <p class={styles.note}>
          {t().mayhem.noShared.text} <a href="#/settings">{t().mayhem.noShared.link}</a>
        </p>
      </Show>
    </>
  );
}
