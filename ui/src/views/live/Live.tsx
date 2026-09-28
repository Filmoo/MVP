import { createEffect, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import { createFollowed } from "../../data/follow";
import type { LiveGame } from "../../data/generated/LiveGame";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Segmented, type SegmentedOption } from "../../design/Segmented";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { queueName } from "../../lib/format";
import { platformLabel } from "../../lib/riot-id";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Live.module.css";
import { LiveTeam } from "./LiveTeam";
import { MyBuild } from "./MyBuild";
import { scoutingFailure } from "./words";

type LiveTab = "players" | "build";

const tabs = (): SegmentedOption<LiveTab>[] => [
  { value: "players", label: t().live.tabs.players },
  { value: "build", label: t().live.tabs.build },
];

const parseTab = (value: string | null): LiveTab => (value === "build" ? "build" : "players");

/** Where the cards are, in the page head: a fixed-height line, so the teams never move. */
function ScoutingStatus(props: { game: LiveGame }): JSX.Element {
  const { transport } = useData();
  const retry = () => {
    transport.call("retry_scouting").catch(() => {
      // The core isn't there: the status line stays as it is.
    });
  };
  return (
    <Switch>
      <Match when={props.game.scouting.state === "loading"}>
        <span class={styles.status} data-testid="scouting-status">
          {t().live.lookingUp}
        </span>
      </Match>
      <Match when={props.game.scouting.state === "failed" && props.game.scouting}>
        {(failed) => (
          <span class={`${styles.status} ${styles.failed}`} role="alert" data-testid="scouting-status">
            <Icon name="alert" size={14} />
            <span class={styles.statusText}>{scoutingFailure(failed().error)}</span>
            <button type="button" class={styles.retry} onClick={retry}>
              {t().common.tryAgain}
            </button>
          </span>
        )}
      </Match>
    </Switch>
  );
}

export function LiveContent(props: { game: LiveGame }): JSX.Element {
  const scouting = () => props.game.scouting.state;
  return (
    <div class={styles.grid}>
      <Widget name="live-team" class={styles.side}>
        <LiveTeam title={t().draft.yourTeam} players={props.game.allies} enemy={false} scouting={scouting()} />
      </Widget>
      <Widget name="live-team" class={styles.side}>
        <LiveTeam title={t().draft.enemyTeam} players={props.game.enemies} enemy scouting={scouting()} />
      </Widget>
    </div>
  );
}

/** Same boxes as the loaded screen. */
function LiveSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <For each={[0, 1]}>
        {() => (
          <div class={styles.side}>
            <Card>
              <div class={styles.skeletonCards}>
                <For each={[0, 1, 2, 3, 4]}>{() => <Skeleton height="72px" />}</For>
              </div>
            </Card>
          </div>
        )}
      </For>
    </div>
  );
}

/** Loading-screen scouting: everyone in the game, from the moment it loads. */
export default function Live(): JSX.Element {
  const { transport, gameData } = useData();
  const [game, { refetch }] = createFollowed(
    () => transport.call("live_game"),
    (set) => transport.listen("live", set),
  );
  // The screen takes the colors of your champion.
  useAmbient(() => {
    const g = game.state === "ready" ? game() : undefined;
    const me = g?.allies.find((p) => p.isMe) ?? g?.allies[0];
    return championArtUrl(gameData(), me?.championId ?? undefined);
  });

  // Everyone in the game, or the build of your champion (`#/live?tab=build` links to it).
  const [tab, setTab] = createSignal<LiveTab>(parseTab(queryParam("tab")));
  createEffect(
    on(
      () => queryParam("tab"),
      (value) => setTab(parseTab(value)),
      { defer: true },
    ),
  );
  const ready = () => (game.state === "ready" ? game() : undefined);

  return (
    // The players fit the window; a build is as long as a champion page and scrolls like one.
    <div class={`${page.page} ${tab() === "build" && ready() ? "" : page.live}`}>
      <div class={styles.head}>
        <div class={styles.titleRow}>
          <h1 class={page.title}>{t().live.title}</h1>
          <Show when={ready()}>
            <Segmented label={t().live.show} options={tabs()} value={tab()} onChange={setTab} size="sm" testId="live-tabs" />
          </Show>
        </div>
        <Show when={ready()}>
          {(g) => (
            <div class={styles.meta}>
              <Show when={tab() === "players"}>
                <ScoutingStatus game={g()} />
              </Show>
              <span class={`${styles.queue} num`}>
                {queueName(g().queueId)} · {platformLabel(g().platform)}
              </span>
            </div>
          )}
        </Show>
      </div>
      <Switch>
        <Match when={game.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState title={t().live.readFailed} message={String(game.error?.message ?? game.error)} onRetry={() => void refetch()} />
            </Card>
          </div>
        </Match>
        <Match when={game.state === "pending" || game.state === "unresolved"}>
          <LiveSkeleton />
        </Match>
        <Match when={game() === null}>
          <div class={page.centered}>
            <Card>
              <EmptyState icon="live" title={t().live.idle.title} text={t().live.idle.text} />
            </Card>
          </div>
        </Match>
        <Match when={tab() === "build" && game()}>{(g) => <MyBuild game={g()} />}</Match>
        <Match when={game()}>{(g) => <LiveContent game={g()} />}</Match>
      </Switch>
    </div>
  );
}
