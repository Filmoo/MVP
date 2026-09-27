import { createResource, type JSX, Match, onCleanup, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { ClientStatus } from "../../data/generated/ClientStatus";
import { useAmbient } from "../../design/ambient";
import { Card } from "../../design/Card";
import { championIconUrl } from "../../design/GameIcon";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Home.module.css";
import { PerformanceSummary } from "./PerformanceSummary";
import { ProfileHeader } from "./ProfileHeader";
import { RecentMatches } from "./RecentMatches";
import { summarize } from "./summary";

function HomeSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.header}>
        <Card>
          <Skeleton height="72px" />
        </Card>
      </div>
      <div class={styles.matches}>
        <Card title="Match history">
          <Skeleton height="360px" />
        </Card>
      </div>
      <div class={styles.summary}>
        <Card title="Champions">
          <Skeleton height="240px" />
        </Card>
      </div>
    </div>
  );
}

export function Home(): JSX.Element {
  const { transport, gameData } = useData();
  const [profile, { refetch }] = createResource(() => transport.call("current_profile"));
  // The page takes the colors of the player's most played recent champion.
  useAmbient(() => {
    const p = profile.state === "ready" ? profile() : undefined;
    return p ? championIconUrl(gameData(), summarize(p.recentMatches).champions[0]?.championId) : undefined;
  });

  // Reload when the client comes up and after every game (new match, new LP).
  let last: ClientStatus | undefined;
  onCleanup(
    transport.listen("client-status", (next) => {
      const connected = next.connection === "connected" && last?.connection !== "connected";
      const gameOver = last?.phase === "postGame" && next.phase !== "postGame";
      last = next;
      if (connected || gameOver) void refetch();
    }),
  );

  return (
    <div class={page.page}>
      <Switch>
        <Match when={profile.state === "errored"}>
          <div class={page.centered}>
            <Card>
              <ErrorState
                heading
                title="Couldn't load your profile"
                message={String(profile.error?.message ?? profile.error)}
                onRetry={() => void refetch()}
              />
            </Card>
          </div>
        </Match>
        <Match when={profile.state === "pending" || profile.state === "unresolved"}>
          <HomeSkeleton />
        </Match>
        <Match when={profile() === null}>
          <div class={page.centered}>
            <Card>
              <EmptyState
                heading
                icon="plug"
                title="Waiting for the League client"
                text="Start League of Legends: your profile, live games and champion select help appear here automatically."
              />
            </Card>
          </div>
        </Match>
        <Match when={profile()}>
          {(p) => {
            const hasGames = () => p().recentMatches.length > 0;
            return (
              <div class={`${styles.grid} ${hasGames() ? "" : styles.solo}`}>
                <Widget name="profile-header" class={styles.header}>
                  <ProfileHeader profile={p()} />
                </Widget>
                <Widget name="recent-matches" class={styles.matches}>
                  <RecentMatches matches={p().recentMatches} />
                </Widget>
                <Show when={hasGames()}>
                  <Widget name="performance-summary" class={styles.summary}>
                    <PerformanceSummary matches={p().recentMatches} />
                  </Widget>
                </Show>
              </div>
            );
          }}
        </Match>
      </Switch>
    </div>
  );
}
