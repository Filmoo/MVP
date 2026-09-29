/**
 * `/mayhem`: ARAM: Mayhem's augments by MVP's tiers (inside a tier, first is best), with each
 * augment's pick rate in the games players share. A champion (`?champion=222`) shows its
 * augments ranked per rarity instead. Pick rates only: never win rates (Riot's policy).
 */
import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { navigate, queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { AugmentInfo } from "../../data/generated/AugmentInfo";
import type { AugmentRarity } from "../../data/generated/AugmentRarity";
import type { AugmentTier } from "../../data/generated/AugmentTier";
import type { MayhemOverview } from "../../data/generated/MayhemOverview";
import { Button } from "../../design/Button";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented } from "../../design/Segmented";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { percent, timeAgo } from "../../lib/format";
import { backendError } from "../../lib/players";
import { createQuery } from "../../lib/query";
import { statsErrorWords } from "../../lib/stats";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import { ScopeSwitches } from "../stats/common";
import styles from "./Mayhem.module.css";
import { AugmentIcon, ChampionAugments, RankPill, sentence, TierMark, useAugments } from "./parts";

const TIERS: AugmentTier[] = ["S", "A", "B", "C"];
/** Augments without a tier shown before "Show all" (keeps the page light). */
const UNTIERED_SHOWN = 24;

type RarityFilter = AugmentRarity | "all";

const rarityOptions = () => [
  { value: "all" as const, label: t().mayhem.all },
  ...(["silver", "gold", "prismatic"] as const).map((value) => ({ value, label: t().mayhem.rarities[value] })),
];

/** One augment: tile, name, its tier and rank, rarity and pick rate, and what it does. */
function AugmentCard(props: { augment: AugmentInfo; tier?: AugmentTier; rank?: number; pickRate: number | undefined }): JSX.Element {
  const meta = () => {
    const parts = [t().mayhem.rarities[props.augment.rarity]];
    if (props.pickRate !== undefined) parts.push(t().mayhem.picked(percent(props.pickRate, 1)));
    return parts.join(" · ");
  };
  return (
    <li class={styles.augment} data-testid="augment">
      <AugmentIcon augment={props.augment} size={40} />
      <div class={styles.body}>
        <div class={styles.top}>
          <span class={styles.name}>{props.augment.name}</span>
          <Show when={props.tier && props.rank ? { tier: props.tier, rank: props.rank } : undefined}>
            {(placed) => <RankPill tier={placed().tier} rank={placed().rank} />}
          </Show>
        </div>
        <span class={`${styles.meta} num`}>{meta()}</span>
        <Show when={props.augment.description}>
          {/* Its whole text on hover when it's cut (a hint that only restores text: no tab stop). */}
          <p class={styles.description} data-hint={props.augment.description}>
            {props.augment.description}
          </p>
        </Show>
      </div>
    </li>
  );
}

/** Every augment by MVP's tiers, then the ones without a tier (most picked first). */
export function AugmentTiers(props: {
  augments: ReadonlyMap<number, AugmentInfo>;
  overview: MayhemOverview | undefined;
  rarity: RarityFilter;
}): JSX.Element {
  const [all, setAll] = createSignal(false);
  const popularity = () => props.overview?.popularity ?? null;
  const picks = createMemo(() => new Map(popularity()?.augments.map((p) => [p.id, p.n]) ?? []));
  const pickRate = (id: number) => {
    const players = popularity()?.players ?? 0;
    return players > 0 ? (picks().get(id) ?? 0) / players : undefined;
  };
  const shown = (a: AugmentInfo | undefined): a is AugmentInfo => a !== undefined && (props.rarity === "all" || a.rarity === props.rarity);
  const tiers = createMemo(() =>
    TIERS.map((tier) => ({
      tier,
      entries: (props.overview?.tiers?.tiers[tier] ?? [])
        .map((id, i) => ({ augment: props.augments.get(id), rank: i + 1 }))
        .filter((e): e is { augment: AugmentInfo; rank: number } => shown(e.augment)),
    })).filter((group) => group.entries.length > 0),
  );
  const untiered = createMemo(() => {
    const tiered = new Set(TIERS.flatMap((tier) => props.overview?.tiers?.tiers[tier] ?? []));
    return [...props.augments.values()]
      .filter((a) => shown(a) && !tiered.has(a.id))
      .sort((a, b) => (picks().get(b.id) ?? 0) - (picks().get(a.id) ?? 0) || a.name.localeCompare(b.name));
  });
  return (
    <div class={styles.sections}>
      <For each={tiers()}>
        {(group) => (
          <Card
            title={
              <span class={styles.tierTitle}>
                <TierMark tier={group.tier} />
                {t().mayhem.tier(group.tier)}
              </span>
            }
            actions={<span class={`${styles.count} num`}>{group.entries.length}</span>}
          >
            <ol class={styles.grid}>
              <For each={group.entries}>
                {(e) => <AugmentCard augment={e.augment} tier={group.tier} rank={e.rank} pickRate={pickRate(e.augment.id)} />}
              </For>
            </ol>
          </Card>
        )}
      </For>
      <Show when={untiered().length > 0}>
        <Card
          title={tiers().length > 0 ? t().mayhem.untiered : t().mayhem.augments}
          actions={<span class={`${styles.count} num`}>{untiered().length}</span>}
        >
          <ol class={styles.grid}>
            <For each={all() ? untiered() : untiered().slice(0, UNTIERED_SHOWN)}>
              {(augment) => <AugmentCard augment={augment} pickRate={pickRate(augment.id)} />}
            </For>
          </ol>
          <Show when={!all() && untiered().length > UNTIERED_SHOWN}>
            <div class={styles.more}>
              <Button variant="ghost" onClick={() => setAll(true)}>
                {t().tierList.showAll(untiered().length)}
              </Button>
            </div>
          </Show>
        </Card>
      </Show>
    </div>
  );
}

/** Pick a champion by name: its augments ranked per rarity. */
function ChampionFilter(props: { championId: number | undefined }): JSX.Element {
  const { gameData } = useData();
  const [query, setQuery] = createSignal("");
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  const matches = createMemo(() => {
    const q = fold(query());
    if (!q) return [];
    return [...(gameData()?.champions.values() ?? [])].filter((c) => fold(c.name).includes(q)).slice(0, 6);
  });
  const pick = (id: number) => {
    setQuery("");
    navigate(`/mayhem?champion=${id}`);
  };
  return (
    <div class={styles.picker}>
      <Show
        when={props.championId}
        fallback={
          <label class={styles.search}>
            <Icon name="search" size={16} class={styles.searchIcon} />
            <input
              type="search"
              class={styles.searchInput}
              placeholder={t().mayhem.search}
              aria-label={t().mayhem.search}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                const first = matches()[0];
                if (e.key === "Enter" && first) pick(first.id);
              }}
              data-testid="mayhem-champion-search"
            />
          </label>
        }
      >
        {(id) => (
          <span class={styles.chosen} data-testid="mayhem-champion-chip">
            <ChampionIcon championId={id()} size={24} round />
            <span class={styles.chosenName}>{gameData()?.champions.get(id())?.name ?? t().common.championN(id())}</span>
            <button
              type="button"
              class={styles.clear}
              aria-label={t().mayhem.clear}
              data-hint={t().mayhem.clear}
              onClick={() => navigate("/mayhem")}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        )}
      </Show>
      <Show when={matches().length > 0}>
        <ul class={styles.matches}>
          <For each={matches()}>
            {(c) => (
              <li>
                <button type="button" class={styles.match} onClick={() => pick(c.id)}>
                  <ChampionIcon championId={c.id} size={24} round />
                  <span>{c.name}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function PageSkeleton(): JSX.Element {
  return (
    <div class={styles.sections} aria-busy="true">
      <Card title={t().mayhem.tier("S")}>
        <Skeleton height="220px" />
      </Card>
      <Card title={t().mayhem.tier("A")}>
        <Skeleton height="220px" />
      </Card>
    </div>
  );
}

export default function Mayhem(): JSX.Element {
  const { transport, gameData } = useData();
  const augments = useAugments();
  const overview = createQuery(
    () => 0,
    () => transport.call("mayhem_overview"),
  );
  const [rarity, setRarity] = createSignal<RarityFilter>("all");
  const championId = () => {
    const n = Number(queryParam("champion"));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  const sources = () => {
    const o = overview.data();
    const parts: string[] = [];
    if (o?.tiers) parts.push(o.tiers.patch ? t().mayhem.tiersOf(o.tiers.patch) : t().mayhem.tiersBy);
    if (o?.popularity) parts.push(t().mayhem.shared(o.popularity.games), t().common.updated(timeAgo(o.popularity.updatedAt)));
    return parts;
  };
  const problem = () => statsErrorWords(backendError(augments.error()));
  return (
    <div class={page.page}>
      <div class={styles.head}>
        <h1 class={page.title}>{t().queues[2400]}</h1>
        <Show when={sources().length > 0}>
          <p class={`${styles.sources} num`} data-testid="mayhem-sources">
            <For each={sources()}>{(s, i) => <span class={styles.source}>{i() < sources().length - 1 ? `${s} ·` : s}</span>}</For>
          </p>
        </Show>
      </div>
      <div class={styles.filters}>
        <ScopeSwitches rank={false} mayhem={{ selected: true, onSelect: () => {}, onLeave: () => navigate("/tier-list") }} />
        <Show when={!championId()}>
          <Segmented
            label={t().mayhem.rarity}
            size="sm"
            options={rarityOptions()}
            value={rarity()}
            onChange={setRarity}
            testId="rarity-filter"
          />
        </Show>
        <ChampionFilter championId={championId()} />
      </div>
      <Switch>
        <Match when={augments.error() !== undefined && !augments.loading()}>
          <Card>
            <ErrorState title={t().mayhem.failed} message={problem().text} onRetry={augments.refetch} />
          </Card>
        </Match>
        <Match when={augments.data() === null}>
          <Card>
            <EmptyState icon="tiers" title={t().mayhem.unbuilt.title} text={t().mayhem.unbuilt.text} />
          </Card>
        </Match>
        <Match when={!augments.data() || overview.loading()}>
          <PageSkeleton />
        </Match>
        <Match when={championId()}>
          {(id) => (
            <Card title={t().mayhem.of(name(id()))}>
              <Widget name="mayhem-champion">
                <ChampionAugments championId={id()} name={name(id())} full />
              </Widget>
            </Card>
          )}
        </Match>
        <Match when={augments.data()}>
          {(list) => (
            <>
              <Show when={!overview.data()?.tiers || !overview.data()?.popularity}>
                <div class={styles.notices}>
                  <Show when={!overview.data()?.tiers}>
                    <p class={styles.notice} data-testid="mayhem-no-tiers">
                      <Icon name="info" size={16} class={styles.noticeIcon} />
                      <span>
                        <b>{t().mayhem.noTiers.title}.</b> {t().mayhem.noTiers.text}
                      </span>
                    </p>
                  </Show>
                  <Show when={!overview.data()?.popularity}>
                    <p class={styles.notice} data-testid="mayhem-no-shared">
                      <Icon name="info" size={16} class={styles.noticeIcon} />
                      <span>
                        <b>{t().mayhem.noShared.title}.</b> {t().mayhem.noShared.text} <a href="#/settings">{t().mayhem.noShared.link}</a>
                      </span>
                    </p>
                  </Show>
                </div>
              </Show>
              <Widget name="mayhem-augments">
                <AugmentTiers augments={list()} overview={overview.data()} rarity={rarity()} />
              </Widget>
            </>
          )}
        </Match>
      </Switch>
      <p class={styles.note}>{sentence(t().mayhem.note)}</p>
    </div>
  );
}
