import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import type { LpGame } from "../../data/generated/LpGame";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { RiotId } from "../../data/generated/RiotId";
import { Button } from "../../design/Button";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented } from "../../design/Segmented";
import { EmptyState } from "../../design/States";
import { t } from "../../i18n";
import { gameIdOf, PAGE, QUEUES, type QueueFilter, queueGroup } from "./history";
import styles from "./MatchHistory.module.css";
import { createLateGrades, type LateGrades, RecentMatches } from "./RecentMatches";

/**
 * The match history with its filters (queue, champion) and, on Home, older games a page at a
 * time. Filters only choose among the games loaded; grades stay lazy (the rows shown ask).
 * Links can set the filters: `#/?queue=flex&champion=103`.
 */
export function MatchHistory(props: {
  matches: readonly MatchSummary[];
  focus?: RiotId | undefined;
  /** The first page's grades, read after the list (`createLateGrades`, shared with the hero). */
  late?: LateGrades | undefined;
  /** The LP of your tracked ranked games (Home). */
  lp?: readonly LpGame[] | undefined;
  /** Games from `begIndex` on, further back (Home: your League client's history). */
  older?: ((begIndex: number) => Promise<MatchSummary[]>) | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const [queue, setQueue] = createSignal<QueueFilter>(QUEUES.find((q) => q === queryParam("queue")) ?? "all");
  const [champion, setChampion] = createSignal(Number(queryParam("champion")) || 0);
  const [older, setOlder] = createSignal<MatchSummary[]>([]);
  const [more, setMore] = createSignal<"idle" | "loading" | "failed" | "end">("idle");
  // Games read further back (duplicates included): where the next page begins.
  let read = 0;
  let generation = 0;
  // A new first page (a game ended, the client came back): the older pages start over.
  createEffect(
    on(
      () => props.matches,
      (first) => {
        generation++;
        read = 0;
        setOlder([]);
        setMore(first.length < PAGE ? "end" : "idle");
      },
    ),
  );
  const all = createMemo(() => [...props.matches, ...older()]);
  const loadMore = async () => {
    const load = props.older;
    if (!load || more() === "loading") return;
    const mine = generation;
    setMore("loading");
    try {
      const page = await load(props.matches.length + read);
      if (mine !== generation) return;
      read += page.length;
      const have = new Set(all().map((m) => m.matchId));
      setOlder((list) => [...list, ...page.filter((m) => !have.has(m.matchId))]);
      setMore(page.length < PAGE ? "end" : "idle");
    } catch {
      if (mine === generation) setMore("failed");
    }
  };
  const canLoad = () => !!props.older && more() !== "end";

  const shown = createMemo(() =>
    all().filter((m) => (queue() === "all" || queueGroup(m.queueId) === queue()) && (!champion() || m.championId === champion())),
  );
  // Older games' grades: asked for the rows shown, each once; the first page's come with `late`.
  const first = createMemo(() => new Set(props.matches));
  const olderLate = createLateGrades(() => shown().filter((m) => !first().has(m)));
  const late = createMemo(() => {
    const [a, b] = [props.late?.(), olderLate()];
    return a && b ? new Map([...a, ...b]) : (a ?? b);
  });
  const name = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.championN(id);
  /** Champions of the games loaded, most played first (the one picked stays listed). */
  const champions = createMemo(() => {
    const games = new Map<number, number>();
    for (const m of all()) games.set(m.championId, (games.get(m.championId) ?? 0) + 1);
    if (champion() && !games.has(champion())) games.set(champion(), 0);
    return [...games].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));
  });
  const queues = createMemo(() => QUEUES.map((value) => ({ value, label: t().matches.filters.queues[value] })));
  const lpById = createMemo(() => new Map((props.lp ?? []).map((g) => [g.gameId, g])));
  const clear = () => {
    setQueue("all");
    setChampion(0);
  };

  const filters = (
    <div class={styles.filters}>
      <Segmented size="sm" label={t().matches.filters.queue} options={queues()} value={queue()} onChange={setQueue} testId="queue-filter" />
      <div class={`${styles.champion} ${champion() ? styles.picked : ""}`}>
        <Show when={champion()} fallback={<Icon name="champions" size={16} />}>
          {(id) => <ChampionIcon championId={id()} size={20} round />}
        </Show>
        <span class={styles.name}>{champion() ? name(champion()) : t().matches.filters.allChampions}</span>
        <Icon name="chevronDown" size={14} />
        <select
          aria-label={t().matches.filters.champion}
          value={champion()}
          onChange={(e) => setChampion(Number(e.currentTarget.value))}
          data-testid="champion-filter"
        >
          <option value={0}>{t().matches.filters.allChampions}</option>
          <For each={champions()}>{([id, games]) => <option value={id}>{t().matches.filters.championGames(name(id), games)}</option>}</For>
        </select>
      </div>
    </div>
  );

  return (
    <RecentMatches
      matches={shown()}
      focus={props.focus}
      late={late}
      lp={(id) => lpById().get(gameIdOf(id))}
      filters={all().length > 0 ? filters : undefined}
      empty={
        all().length > 0 ? (
          <EmptyState
            icon="history"
            title={t().matches.filters.none.title}
            text={t().matches.filters.none.text(all().length, canLoad())}
            action={<Button onClick={clear}>{t().matches.filters.clear}</Button>}
          />
        ) : undefined
      }
      footer={
        <Show when={props.older && (canLoad() || older().length > 0)}>
          <div class={styles.more} data-testid="load-more-row">
            <Show when={canLoad()} fallback={<p class={styles.note}>{t().matches.more.end}</p>}>
              <Show when={more() === "failed"}>
                <p class={styles.failed} role="alert">
                  {t().matches.more.failed}
                </p>
              </Show>
              <Button onClick={() => void loadMore()} testId="load-more">
                <Icon name={more() === "failed" ? "refresh" : "history"} size={16} />
                {more() === "loading" ? t().matches.more.loading : t().matches.more.load}
              </Button>
            </Show>
          </div>
        </Show>
      }
    />
  );
}
