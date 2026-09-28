import { For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { LivePlayer } from "../../data/generated/LivePlayer";
import type { ScoutCard } from "../../data/generated/ScoutCard";
import type { Scouting } from "../../data/generated/Scouting";
import { useTone } from "../../design/ambient";
import { ChampionIcon, championIconUrl, SpellIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { TierBadge, TierCrest } from "../../design/TierBadge";
import { t } from "../../i18n";
import { kdaRatio, percent, winRate } from "../../lib/format";
import { roleLabel } from "../../lib/roles";
import styles from "./LiveTeam.module.css";
import { championRecord, chips } from "./words";

/** Below this many games a win rate is noise: shown neutral. */
const MIN_GAMES_FOR_COLOR = 3;
const FORM_SHOWN = 10;

function Spells(props: { spells: readonly number[] }): JSX.Element {
  return (
    <div class={styles.spells}>
      <For each={[0, 1]}>
        {(i) => (
          <Show when={props.spells[i]} fallback={<span class={styles.noSpell} aria-hidden="true" />}>
            {(id) => <SpellIcon spellId={id()} size={20} />}
          </Show>
        )}
      </For>
    </div>
  );
}

function Rank(props: { card: ScoutCard }): JSX.Element {
  return (
    <Show
      when={props.card.soloQueue}
      fallback={
        <div class={styles.rank}>
          <TierCrest tier="iron" size={40} class={styles.unrankedCrest} />
          <div class={styles.rankText}>
            <span class={styles.unranked}>{t().common.unranked}</span>
            <span class={styles.small}>{t().soloDuoShort}</span>
          </div>
        </div>
      }
    >
      {(q) => (
        <div class={styles.rank}>
          <TierCrest tier={q().tier} size={40} class={styles.crest} />
          <div class={styles.rankText}>
            <TierBadge tier={q().tier} division={q().division} plain class={styles.tier} />
            <span class={`${styles.small} num`}>
              {t().common.lp(q().leaguePoints)} · {percent(winRate(q().wins, q().losses) ?? 0)}
            </span>
          </div>
        </div>
      )}
    </Show>
  );
}

/** Games and win rate on the champion played in this game (from the card's recent sample). */
function Experience(props: { card: ScoutCard; championId: number | null }): JSX.Element {
  const { gameData } = useData();
  const record = () => championRecord(props.card, props.championId);
  const name = () => (props.championId === null ? undefined : gameData()?.champions.get(props.championId)?.name);
  return (
    <div class={`${styles.experience} num`}>
      <Show
        when={record()}
        fallback={
          <>
            <span class={styles.muted}>–</span>
            <span class={styles.small} title={name()}>
              {name() ?? t().common.champion}
            </span>
          </>
        }
      >
        {(r) => {
          const wr = () => r().wins / Math.max(1, r().games);
          const tone = () => (r().games < MIN_GAMES_FOR_COLOR ? "" : wr() >= 0.5 ? styles.good : styles.bad);
          return (
            <>
              <span class={styles.expGames}>{t().common.games(r().games)}</span>
              <span class={styles.small} title={t().live.kdaOn(kdaRatio(r().kills, r().deaths, r().assists), name())}>
                <span class={tone()}>{percent(wr())}</span> {t().live.wr}
              </span>
            </>
          );
        }}
      </Show>
    </div>
  );
}

/** Their most played champions lately, with games under each (wide cards only). */
function Pool(props: { card: ScoutCard }): JSX.Element {
  const { gameData } = useData();
  return (
    <Show when={props.card.topChampions.length > 0}>
      <ul class={`${styles.pool} num`} aria-label={t().live.mostPlayed}>
        <For each={props.card.topChampions.slice(0, 3)}>
          {(c) => (
            <li
              class={styles.poolItem}
              title={t().live.poolTitle(
                gameData()?.champions.get(c.championId)?.name ?? t().common.champion,
                c.games,
                percent(c.wins / Math.max(1, c.games)),
              )}
            >
              <ChampionIcon championId={c.championId} size={24} round />
              <span class={styles.poolGames}>{c.games}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function Form(props: { results: readonly boolean[] }): JSX.Element {
  const shown = () => props.results.slice(0, FORM_SHOWN);
  const wins = () => shown().filter(Boolean).length;
  return (
    <Show when={shown().length > 0}>
      <div class={`${styles.form} num`}>
        <ol class={styles.pips} aria-label={t().common.lastResults(shown())}>
          <For each={shown()}>{(win) => <li class={`${styles.pip} ${win ? styles.win : styles.loss}`} />}</For>
        </ol>
        <span class={styles.small}>{t().common.record(wins(), shown().length - wins())}</span>
      </div>
    </Show>
  );
}

function Identity(props: { player: LivePlayer }): JSX.Element {
  const riotId = () => props.player.riotId;
  const roles = () => props.player.card?.mainRoles ?? [];
  const second = () => {
    if (props.player.hidden) return t().live.streamer;
    if (roles().length > 0) return t().live.mains(roles().map(roleLabel).join(" / "));
    return props.player.role ? roleLabel(props.player.role) : "";
  };
  return (
    <div class={styles.identity}>
      <span class={styles.nameLine}>
        <Switch>
          <Match when={props.player.hidden}>
            <Icon name="hidden" size={14} class={styles.hiddenIcon} />
            <span class={`${styles.name} ${styles.muted}`}>{t().live.hidden}</span>
          </Match>
          <Match when={riotId()}>
            {(id) => (
              <>
                <span class={styles.name} title={`${id().gameName}#${id().tagLine}`}>
                  {id().gameName}
                </span>
                <span class={styles.tag}>#{id().tagLine}</span>
              </>
            )}
          </Match>
          <Match when={true}>
            <span class={`${styles.name} ${styles.muted}`}>{t().live.unknown}</span>
          </Match>
        </Switch>
        <Show when={props.player.isMe}>
          <span class={styles.you}>{t().common.you}</span>
        </Show>
      </span>
      <span class={styles.small}>{second()}</span>
    </div>
  );
}

/** One player: champion, spells, who they are and how they've been doing (positive/neutral only). */
function PlayerCard(props: { player: LivePlayer; scouting: Scouting["state"] }): JSX.Element {
  const { gameData } = useData();
  const championName = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.champion;
  const card = () => props.player.card;
  return (
    <li
      ref={(el) => useTone(el, () => (props.player.championId === null ? undefined : championIconUrl(gameData(), props.player.championId)))}
      class={`${styles.card} ${props.player.isMe ? styles.me : ""}`}
      data-testid="live-card"
      data-card={props.player.hidden ? "hidden" : card() ? "scouted" : props.scouting === "loading" ? "pending" : "unavailable"}
    >
      <div class={styles.portrait}>
        <Show when={props.player.championId} fallback={<span class={styles.noChampion} aria-hidden="true" />}>
          {(id) => <ChampionIcon championId={id()} size={48} />}
        </Show>
      </div>
      <Spells spells={props.player.spells} />
      <Identity player={props.player} />
      <Switch
        fallback={
          <div class={styles.rest}>
            {/* Failed: the card couldn't be asked for. Done without one: our backend has no data for them. */}
            <span class={styles.small}>
              {props.player.hidden ? "" : props.scouting === "failed" ? t().live.cardUnavailable : t().live.noRankedData}
            </span>
          </div>
        }
      >
        <Match when={card()}>
          {(c) => (
            <>
              <Pool card={c()} />
              <Rank card={c()} />
              <Experience card={c()} championId={props.player.championId} />
              <div class={styles.foot}>
                <Form results={c().recentResults} />
                <ul class={styles.chips}>
                  <For each={chips(c().tags, championName)}>
                    {(chip) => (
                      <li class={`${styles.chip} ${styles[chip.kind]}`} title={chip.title}>
                        {chip.label}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </>
          )}
        </Match>
        <Match when={props.scouting === "loading" && !props.player.hidden}>
          <div class={styles.rank}>
            <span class={styles.skeletonCrest} data-state="loading" />
            <div class={styles.rankText}>
              <span class={styles.skeletonLine} data-state="loading" />
              <span class={styles.skeletonShort} data-state="loading" />
            </div>
          </div>
          <div class={styles.experience}>
            <span class={styles.skeletonShort} data-state="loading" />
          </div>
          <div class={styles.foot}>
            <span class={styles.skeletonWide} data-state="loading" />
          </div>
        </Match>
      </Switch>
    </li>
  );
}

/** One side of the game: five cards in the team's color (blue: yours, rose: theirs). */
export function LiveTeam(props: {
  title: string;
  players: readonly LivePlayer[];
  enemy: boolean;
  scouting: Scouting["state"];
}): JSX.Element {
  return (
    <section class={`${styles.team} ${props.enemy ? styles.enemy : styles.ally}`} aria-label={props.title}>
      <h2 class={styles.teamName}>{props.title}</h2>
      <ol class={styles.cards}>
        <For each={props.players}>{(player) => <PlayerCard player={player} scouting={props.scouting} />}</For>
      </ol>
    </section>
  );
}
