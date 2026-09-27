import { createResource, type JSX, Match, Switch } from "solid-js";
import { useData } from "../../data/context";
import { Card } from "../../design/Card";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { Widget } from "../../widgets/Widget";
import page from "../page.module.css";
import styles from "./Home.module.css";
import { PerformanceSummary } from "./PerformanceSummary";
import { ProfileHeader } from "./ProfileHeader";
import { RecentMatches } from "./RecentMatches";

function HomeSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.header}>
        <Card>
          <Skeleton height="72px" />
        </Card>
      </div>
      <div class={styles.matches}>
        <Card title="Recent matches">
          <Skeleton height="360px" />
        </Card>
      </div>
      <div class={styles.summary}>
        <Card title="Recent form">
          <Skeleton height="240px" />
        </Card>
      </div>
    </div>
  );
}

export function Home(): JSX.Element {
  const { transport } = useData();
  const [profile, { refetch }] = createResource(() => transport.call("current_profile"));

  return (
    <div class={page.page}>
      <Switch>
        <Match when={profile.state === "errored"}>
          <Card>
            <ErrorState
              title="Couldn't load your profile"
              message={String(profile.error?.message ?? profile.error)}
              onRetry={() => void refetch()}
            />
          </Card>
        </Match>
        <Match when={profile.state === "pending" || profile.state === "unresolved"}>
          <HomeSkeleton />
        </Match>
        <Match when={profile() === null}>
          <Card>
            <EmptyState
              icon="plug"
              title="League client not detected"
              text="Start League of Legends: your profile, live games and champion select help will appear here automatically."
            />
          </Card>
        </Match>
        <Match when={profile()}>
          {(p) => (
            <div class={styles.grid}>
              <Widget name="profile-header" class={styles.header}>
                <ProfileHeader profile={p()} />
              </Widget>
              <Widget name="recent-matches" class={styles.matches}>
                <RecentMatches matches={p().recentMatches} />
              </Widget>
              <Widget name="performance-summary" class={styles.summary}>
                <PerformanceSummary matches={p().recentMatches} />
              </Widget>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
