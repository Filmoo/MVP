import { createMemo, For, type JSX, Show } from "solid-js";
import type { PlayerProfile } from "../../data/generated/PlayerProfile";
import { ChampionArt, ProfileIcon } from "../../design/GameIcon";
import { TierBadge, TierCrest } from "../../design/TierBadge";
import { duration, kdaRatio, percent, REMAKE_MAX_SECONDS, winRate } from "../../lib/format";
import { ROLE_LABEL } from "../../lib/roles";
import styles from "./ProfileHeader.module.css";
import { summarize } from "./summary";

const FORM_GAMES = 10;

function Stat(props: { value: string; label: string; tone?: "good" | "bad" | undefined }): JSX.Element {
  return (
    <div class={styles.stat}>
      <span class={`${styles.statValue} ${props.tone ? styles[props.tone] : ""}`}>{props.value}</span>
      <span class={styles.statLabel}>{props.label}</span>
    </div>
  );
}

/** Player hero: identity, solo/duo rank and the recent-games stat strip, over their main's art. */
export function ProfileHeader(props: { profile: PlayerProfile }): JSX.Element {
  const s = createMemo(() => summarize(props.profile.recentMatches));
  const main = () => s().champions[0]?.championId;
  const per = (total: number) => (s().games ? (total / s().games).toFixed(1) : "0");
  /** Most recent first, remakes left out. */
  const form = () =>
    props.profile.recentMatches
      .filter((m) => m.durationSeconds > REMAKE_MAX_SECONDS)
      .slice(0, FORM_GAMES)
      .map((m) => m.win);
  return (
    <div class={styles.wrap}>
      <div class={styles.hero}>
        <Show when={main()}>{(id) => <ChampionArt championId={id()} class={styles.art} />}</Show>
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
              Level {props.profile.level}
            </p>
            <Show when={form().length > 0}>
              <div class={styles.form}>
                <span class={styles.formLabel}>Last {form().length}</span>
                <ol
                  class={styles.formList}
                  aria-label={`Last ${form().length}: ${form()
                    .map((w) => (w ? "win" : "loss"))
                    .join(", ")}`}
                >
                  <For each={form()}>{(win) => <li class={`${styles.formPip} ${win ? styles.formWin : styles.formLoss}`} />}</For>
                </ol>
              </div>
            </Show>
          </div>
          <div class={styles.ranked}>
            <Show
              when={props.profile.soloQueue}
              fallback={
                <div class={styles.rankText}>
                  <span class={styles.queue}>Ranked Solo/Duo</span>
                  <span class={styles.unranked}>Unranked</span>
                </div>
              }
            >
              {(q) => {
                const wr = () => winRate(q().wins, q().losses) ?? 0;
                return (
                  <>
                    <TierCrest tier={q().tier} size={56} />
                    <div class={styles.rankText}>
                      <span class={styles.queue}>Ranked Solo/Duo</span>
                      <div class={styles.rankLine}>
                        <TierBadge tier={q().tier} division={q().division} plain />
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
                    </div>
                  </>
                );
              }}
            </Show>
          </div>
        </div>
        <Show when={s().games > 0}>
          <section class={`${styles.strip} num`} aria-label={`Last ${s().games} games`}>
            <Stat
              value={percent(s().wins / s().games)}
              label={`Win rate · ${s().wins}W\u00a0${s().games - s().wins}L`}
              tone={s().wins / s().games >= 0.5 ? "good" : "bad"}
            />
            <Stat
              value={kdaRatio(s().kills, s().deaths, s().assists)}
              label={`KDA · ${[per(s().kills), per(s().deaths), per(s().assists)].join("\u00a0/\u00a0")}`}
            />
            <Stat value={s().csPerMinute.toFixed(1)} label="CS per minute" />
            <Show when={s().roles[0]}>
              {(r) => <Stat value={ROLE_LABEL[r().role]} label={`Main role · ${r().games}\u00a0of\u00a0${s().games}`} />}
            </Show>
            <Stat value={duration(s().averageSeconds)} label="Average game" />
          </section>
        </Show>
      </div>
    </div>
  );
}
