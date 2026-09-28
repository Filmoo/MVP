import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { PlayerProfile } from "../../data/generated/PlayerProfile";
import { ChampionArt, ProfileIcon } from "../../design/GameIcon";
import { liquid } from "../../design/liquid/liquid";
import { RankEmblem } from "../../design/RankEmblem";
import { TierBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { decimal, duration, kdaRatio, percent, REMAKE_MAX_SECONDS, winRate } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import styles from "./ProfileHeader.module.css";
import { summarize } from "./summary";

function Stat(props: { value: string; label: string; detail?: string | undefined; tone?: "good" | "bad" | undefined }): JSX.Element {
  return (
    <div class={styles.stat}>
      <span class={`${styles.statValue} ${props.tone ? styles[props.tone] : ""}`}>{props.value}</span>
      <span class={styles.statLabel}>
        {props.label}
        <Show when={props.detail}>
          <span class={styles.statDetail}>{props.detail}</span>
        </Show>
      </span>
    </div>
  );
}

/** Player hero: identity, solo/duo rank and the recent-games stat strip, over their main's art. */
export function ProfileHeader(props: { profile: PlayerProfile }): JSX.Element {
  const s = createMemo(() => summarize(props.profile.recentMatches));
  const main = () => s().champions[0]?.championId;
  const { gameData } = useData();
  const mainName = () => {
    const id = main();
    return id === undefined ? undefined : gameData()?.champions.get(id)?.name;
  };
  const per = (total: number) => (s().games ? decimal(total / s().games, 1) : "0");
  /** Most recent first, remakes left out. */
  const form = () =>
    props.profile.recentMatches
      .filter((m) => m.durationSeconds > REMAKE_MAX_SECONDS)
      .slice(0, s().games)
      .map((m) => m.win);
  return (
    <div class={styles.wrap}>
      <div class={styles.hero} data-refract>
        <Show when={main()}>{(id) => <ChampionArt championId={id()} class={styles.art} light />}</Show>
        <div class={styles.top}>
          <div class={styles.avatar}>
            <ProfileIcon iconId={props.profile.profileIconId} size={72} />
            <span class={`${styles.level} num`}>{props.profile.level}</span>
          </div>
          <div class={styles.identity}>
            <h1 class={styles.name}>
              <span class={styles.gameName} title={props.profile.riotId.gameName}>
                {props.profile.riotId.gameName}
              </span>
              <span class={styles.tag}>#{props.profile.riotId.tagLine}</span>
            </h1>
            <p class={`${styles.meta} num`}>
              <span class={styles.chip}>{props.profile.region}</span>
              <Show when={mainName()} fallback={t().profile.level(props.profile.level)}>
                {(name) => t().profile.main(name())}
              </Show>
            </p>
            <Show when={form().length > 0}>
              <div class={styles.form}>
                <span class={styles.formLabel}>{t().profile.last(form().length)}</span>
                <ol class={styles.formList} aria-label={t().common.lastResults(form())}>
                  <For each={form()}>{(win) => <li class={`${styles.formPip} ${win ? styles.formWin : styles.formLoss}`} />}</For>
                </ol>
              </div>
            </Show>
          </div>
          <div class={`${styles.ranked} glass-rim`}>
            <div class={styles.rankedGlass} aria-hidden="true" ref={(el) => liquid(el, "clear")} />
            <Show
              when={props.profile.soloQueue}
              fallback={
                <>
                  <RankEmblem tier="unranked" size="lg" />
                  <div class={styles.rankText}>
                    <span class={styles.queue}>{t().soloDuo}</span>
                    <span class={styles.unranked}>{t().common.unranked}</span>
                  </div>
                </>
              }
            >
              {(q) => {
                const wr = () => winRate(q().wins, q().losses) ?? 0;
                return (
                  <>
                    <RankEmblem tier={q().tier} size="lg" />
                    <div class={styles.rankText}>
                      <span class={styles.queue}>{t().soloDuo}</span>
                      <div class={styles.rankLine}>
                        <TierBadge tier={q().tier} division={q().division} plain />
                        <span class={`${styles.lp} num`}>{t().common.lp(q().leaguePoints)}</span>
                      </div>
                      <div class={`${styles.record} num`}>
                        <span>{t().common.record(q().wins, q().losses)}</span>
                        <span class={styles.wr}>{percent(wr())}</span>
                        <div class={styles.bar} role="img" aria-label={t().profile.winRate(percent(wr()))}>
                          <div class={styles.barWins} style={{ width: `${(wr() * 100).toFixed(1)}%` }} />
                        </div>
                      </div>
                    </div>
                  </>
                );
              }}
            </Show>
          </div>
        </div>
        <Show when={s().games > 0}>
          <section class={`${styles.strip} num`} aria-label={t().profile.lastGames(s().games)}>
            <Stat
              value={percent(s().wins / s().games)}
              label={t().profile.stats.winRate}
              detail={t().common.record(s().wins, s().games - s().wins)}
              tone={s().wins / s().games >= 0.5 ? "good" : "bad"}
            />
            <Stat
              value={kdaRatio(s().kills, s().deaths, s().assists)}
              label={t().profile.stats.kda}
              detail={`${per(s().kills)} / ${per(s().deaths)} / ${per(s().assists)}`}
            />
            <Stat value={decimal(s().csPerMinute, 1)} label={t().profile.stats.csPerMinute} />
            <Show when={s().roles[0]}>
              {(r) => (
                <Stat value={roleLabel(r().role)} label={t().profile.stats.mainRole} detail={t().profile.roleShare(r().games, s().games)} />
              )}
            </Show>
            <Stat value={duration(s().averageSeconds)} label={t().profile.stats.averageGame} />
          </section>
        </Show>
      </div>
    </div>
  );
}
