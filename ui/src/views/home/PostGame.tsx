/**
 * The game that just ended, at the top of Home until the player closes it or queues again: the
 * result, the grade and what moved it, their numbers against their lane opponent's, and the LP it
 * was worth. Lazy: it rides in the player page's chunk with an opened game's code (RecentMatches
 * `chunk`), loaded only when there is a game to sum up.
 */
import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { MatchPlayer } from "../../data/generated/MatchPlayer";
import type { PostGame } from "../../data/generated/PostGame";
import { Card } from "../../design/Card";
import { ChampionArt, ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { TierBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { decimal, duration, integer, kda, queueName, REMAKE_MAX_SECONDS, signedPoints, timeAgo } from "../../lib/format";
import { onHowlingAbyss } from "../../lib/queues";
import { formatRiotId, playerPath } from "../../lib/riot-id";
import { roleLabel } from "../../lib/roles";
import { GradeChip } from "./GradeChip";
import { factorWords } from "./MatchDetails";
import styles from "./PostGame.module.css";

/** A line of the comparison: the words for yours and theirs, the numbers the bar splits. */
interface Line {
  label: string;
  mine: string;
  theirs: string | undefined;
  a: number;
  b: number;
}

const ratio = (p: MatchPlayer) => kda(p.kills, p.deaths, p.assists) ?? p.kills + p.assists;
const kdaText = (p: MatchPlayer) => `${p.kills}/${p.deaths}/${p.assists}`;
/** `EUW1_7000000001` → `euw1`, the platform of a player page. */
const platformOf = (matchId: string) => matchId.slice(0, matchId.lastIndexOf("_")).toLowerCase();

/** Your numbers and theirs; no vision on Howling Abyss (no wards there: 0 for everyone). */
function lines(me: MatchPlayer, them: MatchPlayer | null, queueId: number): Line[] {
  const rows = t().postGame.rows;
  const line = (label: string, of: (p: MatchPlayer) => number, text: (p: MatchPlayer) => string = (p) => integer(of(p))) => ({
    label,
    mine: text(me),
    theirs: them ? text(them) : undefined,
    a: of(me),
    b: them ? of(them) : 0,
  });
  const all = [
    line(rows.kda, ratio, kdaText),
    line(rows.cs, (p) => p.creepScore),
    line(rows.damage, (p) => p.damageToChampions),
    line(rows.gold, (p) => p.gold),
  ];
  return onHowlingAbyss(queueId) ? all : [...all, line(rows.vision, (p) => p.visionScore)];
}

export function PostGameCard(props: { game: PostGame; onClose: () => void }): JSX.Element {
  const { gameData } = useData();
  const g = () => props.game;
  const words = () => t().postGame;
  const remake = () => g().durationSeconds <= REMAKE_MAX_SECONDS;
  const outcome = () => (remake() ? "remake" : g().win ? "win" : "loss");
  const name = (p: MatchPlayer) => gameData()?.champions.get(p.championId)?.name ?? t().common.championN(p.championId);
  const ranked = () => (g().queueId === 420 || g().queueId === 440) && !remake();
  const rows = createMemo(() => lines(g().me, g().opponent, g().queueId));
  const sub = () => {
    const role = g().me.role;
    return role ? `${name(g().me)} · ${roleLabel(role)}` : name(g().me);
  };
  /** Promoted or demoted: the tier or division changed. */
  const moved = () => {
    const lp = g().lp;
    if (!lp || (lp.before.tier === lp.after.tier && lp.before.division === lp.after.division)) return undefined;
    return lp.delta > 0 ? words().lp.promoted : words().lp.demoted;
  };
  return (
    <Card
      title={words().title}
      class={`${styles.card} ${styles[outcome()] ?? ""}`}
      backdrop={<ChampionArt championId={g().me.championId} class={styles.art} />}
      actions={
        <button type="button" class={styles.close} aria-label={words().close} data-hint={words().close} onClick={() => props.onClose()}>
          <Icon name="close" size={16} />
        </button>
      }
    >
      <div class={styles.top} data-testid="post-game">
        <div class={styles.who}>
          <ChampionIcon championId={g().me.championId} size={56} />
          <div class={styles.stack}>
            <p class={styles.result}>{t().matches.outcome[outcome()]}</p>
            <p class={styles.sub}>{sub()}</p>
            <p class={`${styles.meta} num`}>
              {queueName(g().queueId)} · {duration(g().durationSeconds)} · {timeAgo(g().endedAt)}
            </p>
          </div>
        </div>
        <div class={styles.scores}>
          <Show when={g().me.grade}>
            {(grade) => (
              <div class={styles.grade} data-testid="post-game-grade">
                <p class={styles.score}>
                  <GradeChip grade={grade()} />
                  <span class={`${styles.big} num`}>{decimal(grade().score, 1)}</span>
                  <span class={styles.outOf}>{words().outOf}</span>
                </p>
                <p class={`${styles.stackNote} ${grade().badge ? styles.badge : ""}`}>
                  {((badge) => (badge ? t().gradeWhy[badge] : t().gradeWhy.place(t().grade.place(grade().place))))(grade().badge)}
                </p>
              </div>
            )}
          </Show>
          <Show when={ranked()}>
            <div class={styles.lp} data-testid="post-game-lp">
              <Show when={g().lp} fallback={<p class={styles.stackNote}>{g().lpPending ? words().lp.pending : words().lp.unknown}</p>}>
                {(lp) => (
                  <>
                    <p class={`${styles.big} num`} data-lp={Math.sign(lp().delta)}>
                      {t().matches.lp(signedPoints(lp().delta, 0))}
                    </p>
                    <Show when={moved()}>{(m) => <p class={styles.moved}>{m()}</p>}</Show>
                    <p class={`${styles.stackNote} num`}>
                      <TierBadge tier={lp().after.tier} division={lp().after.division} plain />
                      <span>{t().common.lp(lp().after.leaguePoints)}</span>
                    </p>
                  </>
                )}
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <div class={styles.body}>
        <Show
          when={g().me.grade?.factors.length}
          fallback={
            <Show when={remake()}>
              <p class={styles.stackNote}>{words().remake}</p>
            </Show>
          }
        >
          <section class={styles.why}>
            <h3 class={styles.heading}>{words().why}</h3>
            <ul class={styles.factors}>
              <For each={g().me.grade?.factors}>
                {(f) => <li class={`num ${f.points >= 0 ? styles.up : styles.down}`}>{factorWords(f, g().me.deaths)}</li>}
              </For>
            </ul>
          </section>
        </Show>
        <section class={styles.vs}>
          {/* The same columns as the rows: "You" over your numbers, the opponent over theirs. */}
          <div class={`${styles.row} ${styles.vsHead}`}>
            <h3 class={`${styles.heading} ${styles.you}`}>{words().you}</h3>
            <Show when={g().opponent}>
              {(o) => (
                <p class={styles.them}>
                  <span class={styles.caption}>{g().me.role ? words().laneOpponent : words().closestDamage}</span>
                  <ChampionIcon championId={o().championId} size={20} round />
                  {/* Their page, unless Riot hides them (streamer mode) or they have no Riot ID (bots). */}
                  <Show
                    when={!o().hidden && o().riotId?.tagLine ? o().riotId : undefined}
                    fallback={<span class={styles.theirName}>{o().hidden ? t().live.hidden : name(o())}</span>}
                  >
                    {(id) => (
                      <a
                        class={`${styles.theirName} ${styles.link}`}
                        href={`#${playerPath(platformOf(g().matchId), id())}`}
                        data-hint={formatRiotId(id())}
                      >
                        {id().gameName}
                      </a>
                    )}
                  </Show>
                </p>
              )}
            </Show>
          </div>
          <ul class={styles.rows}>
            <For each={rows()}>
              {(row) => {
                const share = () => (row.a + row.b > 0 ? row.a / (row.a + row.b) : 0.5);
                return (
                  <li class={styles.row}>
                    <span class={styles.label}>{row.label}</span>
                    <span class={`${styles.mine} ${row.theirs && row.a >= row.b ? styles.ahead : ""} num`}>{row.mine}</span>
                    <Show when={row.theirs}>
                      {(theirs) => (
                        <>
                          <span class={styles.split} aria-hidden="true">
                            <span style={{ "flex-grow": share() }} />
                            <span style={{ "flex-grow": 1 - share() }} />
                          </span>
                          <span class={`${styles.theirs} ${row.b > row.a ? styles.ahead : ""} num`}>{theirs()}</span>
                        </>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
          <Show when={!g().opponent}>
            <p class={styles.stackNote}>{words().noOpponent}</p>
          </Show>
        </section>
      </div>
    </Card>
  );
}
