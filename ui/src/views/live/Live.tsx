import { createResource, For, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { LiveGame } from "../../data/generated/LiveGame";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { queueName } from "../../lib/format";
import { platformLabel } from "../../lib/riot-id";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Live.module.css";
import { LiveTeam } from "./LiveTeam";
import { scoutingFailure } from "./words";

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
          Looking players up…
        </span>
      </Match>
      <Match when={props.game.scouting.state === "failed" && props.game.scouting}>
        {(failed) => (
          <span class={`${styles.status} ${styles.failed}`} role="alert" data-testid="scouting-status">
            <Icon name="alert" size={14} />
            <span class={styles.statusText}>{scoutingFailure(failed().error)}</span>
            <button type="button" class={styles.retry} onClick={retry}>
              Try again
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
        <LiveTeam title="Your team" players={props.game.allies} enemy={false} scouting={scouting()} />
      </Widget>
      <Widget name="live-team" class={styles.side}>
        <LiveTeam title="Enemy team" players={props.game.enemies} enemy scouting={scouting()} />
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
  const [game, { mutate, refetch }] = createResource(() => transport.call("live_game"));
  onCleanup(transport.listen("live", (next) => mutate(next)));
  // The screen takes the colors of your champion.
  useAmbient(() => {
    const g = game.state === "ready" ? game() : undefined;
    const me = g?.allies.find((p) => p.isMe) ?? g?.allies[0];
    return championArtUrl(gameData(), me?.championId ?? undefined);
  });

  return (
    <div class={`${page.page} ${page.live}`}>
      <div class={styles.head}>
        <h1 class={page.title}>Live game</h1>
        <Show when={game.state === "ready" && game()}>
          {(g) => (
            <div class={styles.meta}>
              <ScoutingStatus game={g()} />
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
              <ErrorState
                title="Couldn't read the game"
                message={String(game.error?.message ?? game.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={game.state === "pending" || game.state === "unresolved"}>
          <LiveSkeleton />
        </Match>
        <Match when={game() === null}>
          <div class={page.centered}>
            <Card>
              <EmptyState
                icon="live"
                title="Not in a game"
                text="When your game loads, everyone in it shows up here: rank, recent form and experience on their champion."
              />
            </Card>
          </div>
        </Match>
        <Match when={game()}>{(g) => <LiveContent game={g()} />}</Match>
      </Switch>
    </div>
  );
}
