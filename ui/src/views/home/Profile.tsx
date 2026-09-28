import { For, type JSX, Show } from "solid-js";
import type { PlayerProfile } from "../../data/generated/PlayerProfile";
import type { GameDataView } from "../../data/static-data";
import { Card } from "../../design/Card";
import { championArtUrl } from "../../design/GameIcon";
import { Skeleton } from "../../design/States";
import { t } from "../../i18n";
import { Widget } from "../../widgets/Widget";
import styles from "./Home.module.css";
import { PerformanceSummary } from "./PerformanceSummary";
import { ProfileHeader } from "./ProfileHeader";
import hero from "./ProfileHeader.module.css";
import { RecentMatches } from "./RecentMatches";
import { summarize } from "./summary";

/** The art a profile page takes its colors from: the player's most played recent champion. */
export function profileArt(gameData: GameDataView | undefined, profile: PlayerProfile | null | undefined): string | undefined {
  return profile ? championArtUrl(gameData, summarize(profile.recentMatches).champions[0]?.championId) : undefined;
}

/** A player's page: hero with the stat strip, match history, champions. Home and player lookups share it. */
export function ProfileContent(props: { profile: PlayerProfile }): JSX.Element {
  const hasGames = () => props.profile.recentMatches.length > 0;
  return (
    <div class={`${styles.grid} ${hasGames() ? "" : styles.solo}`}>
      <Widget name="profile-header" class={styles.header}>
        <ProfileHeader profile={props.profile} />
      </Widget>
      <Widget name="recent-matches" class={styles.matches}>
        <RecentMatches matches={props.profile.recentMatches} />
      </Widget>
      <Show when={hasGames()}>
        <Widget name="performance-summary" class={styles.summary}>
          <PerformanceSummary matches={props.profile.recentMatches} />
        </Widget>
      </Show>
    </div>
  );
}

/** The loaded page's boxes, with the hero's own frame and strip, so nothing jumps when data arrives. */
export function ProfileSkeleton(): JSX.Element {
  return (
    <div class={styles.grid} aria-busy="true">
      <div class={styles.header}>
        <div class={hero.wrap}>
          <div class={hero.hero}>
            <div class={hero.top}>
              <div class={hero.avatar}>
                <Skeleton width="72px" height="72px" radius="full" />
              </div>
              <div class={hero.identity}>
                <Skeleton width="min(240px, 100%)" height="36px" />
                <Skeleton width="min(140px, 100%)" height="18px" />
                <Skeleton width="min(180px, 100%)" height="16px" />
              </div>
              <div class={hero.ranked}>
                <Skeleton width="56px" height="56px" radius="full" />
                <div class={hero.rankText}>
                  <Skeleton width="112px" height="14px" />
                  <Skeleton width="136px" height="24px" />
                  <Skeleton width="160px" height="14px" />
                </div>
              </div>
            </div>
            <div class={hero.strip}>
              <For each={[0, 1, 2, 3, 4]}>
                {() => (
                  <div class={hero.stat}>
                    <Skeleton width="64px" height="28px" />
                    <Skeleton width="88px" height="16px" />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
      <div class={styles.matches}>
        <Card title={t().matches.title}>
          <Skeleton height="360px" />
        </Card>
      </div>
      <div class={styles.summary}>
        <Card title={t().summary.championsTitle}>
          <Skeleton height="240px" />
        </Card>
      </div>
    </div>
  );
}
