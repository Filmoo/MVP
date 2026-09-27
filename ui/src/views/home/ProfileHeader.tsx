import { type JSX, Show } from "solid-js";
import type { PlayerProfile } from "../../data/generated/PlayerProfile";
import { ProfileIcon } from "../../design/GameIcon";
import { TierBadge } from "../../design/TierBadge";
import { percent, winRate } from "../../lib/format";
import styles from "./ProfileHeader.module.css";

export function ProfileHeader(props: { profile: PlayerProfile }): JSX.Element {
  return (
    <div class={styles.wrap}>
      <div class={styles.header}>
        <div class={styles.avatar}>
          <ProfileIcon iconId={props.profile.profileIconId} size={64} />
          <span class={`${styles.level} num`}>{props.profile.level}</span>
        </div>
        <div class={styles.identity}>
          <h1 class={styles.name}>
            <span class={styles.gameName} title={props.profile.riotId.gameName}>
              {props.profile.riotId.gameName}
            </span>
            <span class={styles.tag}>#{props.profile.riotId.tagLine}</span>
          </h1>
          <p class={styles.meta}>{props.profile.region}</p>
        </div>
        <div class={styles.ranked}>
          <span class={styles.queue}>Ranked Solo/Duo</span>
          <Show when={props.profile.soloQueue} fallback={<span class={styles.unranked}>Unranked</span>}>
            {(q) => {
              const wr = () => winRate(q().wins, q().losses) ?? 0;
              return (
                <>
                  <div class={styles.rankLine}>
                    <TierBadge tier={q().tier} division={q().division} />
                    <span class={`${styles.lp} num`}>{q().leaguePoints} LP</span>
                  </div>
                  <div class={`${styles.record} num`}>
                    <span>
                      {q().wins}W {q().losses}L
                    </span>
                    <span class={styles.wr}>{percent(wr())}</span>
                    <div class={styles.bar} role="img" aria-label={`Win rate ${percent(wr())}`}>
                      <div class={styles.barWins} style={{ width: percent(wr(), 1) }} />
                    </div>
                  </div>
                </>
              );
            }}
          </Show>
        </div>
      </div>
    </div>
  );
}
