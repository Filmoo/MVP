import { For, type JSX, Match, Show, Switch } from "solid-js";
import { useData } from "../../data/context";
import type { LiveNames } from "../../data/generated/LiveNames";
import type { LivePlayer } from "../../data/generated/LivePlayer";
import type { RiotId } from "../../data/generated/RiotId";
import type { ScoutCard } from "../../data/generated/ScoutCard";
import type { Scouting } from "../../data/generated/Scouting";
import { useTone } from "../../design/ambient";
import { ChampionIcon, championIconUrl, SpellIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { RankEmblem } from "../../design/RankEmblem";
import { TierBadge } from "../../design/TierBadge";
import { t } from "../../i18n";
import { kdaRatio, percent, winRate } from "../../lib/format";
import { formatRiotId, playerPath } from "../../lib/riot-id";
import { roleLabel } from "../../lib/roles";
import styles from "./LiveTeam.module.css";
import { championRecord, chips } from "./words";

/** Below this many games a win rate is noise: shown neutral. */
const MIN_GAMES_FOR_COLOR = 3;
const FORM_SHOWN = 10;
/** A no-break space: gives a pending name a text line's height (a plain space would collapse). */
const NO_BREAK_SPACE = "\u00A0";

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
          <RankEmblem tier="unranked" size="md" class={styles.crest} />
          <div class={styles.rankText}>
            <span class={styles.unranked}>{t().common.unranked}</span>
            <span class={styles.small}>{t().soloDuoShort}</span>
          </div>
        </div>
      }
    >
      {(q) => (
        <div class={styles.rank}>
          <RankEmblem tier={q().tier} size="md" class={styles.crest} />
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

/** A visible player's Riot ID, as a link to their player page when the game's platform is known. */
function RiotIdLink(props: { id: RiotId; platform: string | undefined }): JSX.Element {
  const label = () => (
    <>
      <span class={styles.name} title={`${props.id.gameName}#${props.id.tagLine}`}>
        {props.id.gameName}
      </span>
      <span class={styles.tag}>#{props.id.tagLine}</span>
    </>
  );
  return (
    <Show when={props.platform} fallback={label()}>
      {(platform) => (
        <a
          class={styles.nameLink}
          href={`#${playerPath(platform(), props.id)}`}
          aria-label={formatRiotId(props.id)}
          data-testid="live-player-link"
        >
          {label()}
        </a>
      )}
    </Show>
  );
}

function Identity(props: {
  player: LivePlayer;
  pending: boolean;
  /** `loading` pulses (being asked for), `waiting` holds still (the game names them later). */
  skeleton: "loading" | "waiting";
  platform: string | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const riotId = () => props.player.riotId;
  const roles = () => props.player.card?.mainRoles ?? [];
  const role = () => (props.player.role ? roleLabel(props.player.role) : "");
  const second = () => {
    // Streamer mode hides who, not where: the lane stays.
    if (props.player.hidden) return role() ? `${t().live.streamer} · ${role()}` : t().live.streamer;
    // A bot's lane would read "Bot" under "AI bot": its champion instead.
    if (props.player.bot) return props.player.championId === null ? "" : (gameData()?.champions.get(props.player.championId)?.name ?? "");
    if (roles().length > 0) return t().live.mains(roles().map(roleLabel).join(" / "));
    return role();
  };
  return (
    <div class={styles.identity}>
      <span class={styles.nameLine}>
        <Switch>
          <Match when={props.player.hidden}>
            <Icon name="hidden" size={14} class={styles.hiddenIcon} />
            <span class={`${styles.name} ${styles.muted}`}>{t().live.hidden}</span>
          </Match>
          <Match when={props.player.bot}>
            <span class={`${styles.name} ${styles.muted}`}>{t().live.bot}</span>
          </Match>
          {/* Visible players open their page; hidden players and bots have no name to open. */}
          <Match when={riotId()}>{(id) => <RiotIdLink id={id()} platform={props.platform} />}</Match>
          {/* The name is on its way: a line of its height, so nothing moves when it lands. */}
          <Match when={props.pending}>
            <span class={styles.skeletonName} data-state={props.skeleton} data-name="pending" aria-hidden="true">
              {NO_BREAK_SPACE}
            </span>
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
function PlayerCard(props: {
  player: LivePlayer;
  scouting: Scouting["state"];
  names: LiveNames["state"];
  platform: string | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const championName = (id: number) => gameData()?.champions.get(id)?.name ?? t().common.champion;
  const card = () => props.player.card;
  // Nobody to look up: hidden players and bots never get a card.
  const lookedUp = () => !props.player.hidden && !props.player.bot;
  const namePending = () => props.names !== "known" && lookedUp() && !props.player.isMe && props.player.riotId === null;
  // A card can still come: the name is on its way, or the name is in and the card is asked for.
  const cardPending = () =>
    lookedUp() && card() === null && (namePending() || (props.scouting === "loading" && props.player.riotId !== null));
  // Placeholders pulse while something is asked for; a wait for the loading screen's end (a
  // minute or two) holds them still.
  const skeleton = () => (props.names === "waiting" ? "waiting" : "loading");
  const state = () =>
    props.player.hidden ? "hidden" : props.player.bot ? "bot" : card() ? "scouted" : cardPending() ? "pending" : "unavailable";
  return (
    <li
      ref={(el) => useTone(el, () => (props.player.championId === null ? undefined : championIconUrl(gameData(), props.player.championId)))}
      class={`${styles.card} ${props.player.isMe ? styles.me : ""}`}
      data-testid="live-card"
      data-card={state()}
    >
      <div class={styles.portrait}>
        <Show when={props.player.championId} fallback={<span class={styles.noChampion} aria-hidden="true" />}>
          {(id) => <ChampionIcon championId={id()} size={48} />}
        </Show>
      </div>
      <Spells spells={props.player.spells} />
      <Identity player={props.player} pending={namePending()} skeleton={skeleton()} platform={props.platform} />
      <Switch
        fallback={
          <div class={styles.rest}>
            {/* Failed: the card couldn't be asked for. Done without one: our backend has no data for them. */}
            <span class={styles.small}>
              {!lookedUp() || props.player.riotId === null
                ? ""
                : props.scouting === "failed"
                  ? t().live.cardUnavailable
                  : t().live.noRankedData}
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
        <Match when={cardPending()}>
          <div class={styles.rank}>
            <span class={styles.skeletonCrest} data-state={skeleton()} />
            <div class={styles.rankText}>
              <span class={styles.skeletonLine} data-state={skeleton()} />
              <span class={styles.skeletonShort} data-state={skeleton()} />
            </div>
          </div>
          <div class={styles.experience}>
            <span class={styles.skeletonShort} data-state={skeleton()} />
          </div>
          <div class={styles.foot}>
            <span class={styles.skeletonWide} data-state={skeleton()} />
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
  /** Where the other players' names are (default: in). */
  names?: LiveNames["state"];
  /** The game's platform (`euw1`): Riot IDs link to their player pages. */
  platform?: string;
}): JSX.Element {
  return (
    <section class={`${styles.team} ${props.enemy ? styles.enemy : styles.ally}`} aria-label={props.title}>
      <h2 class={styles.teamName}>{props.title}</h2>
      <ol class={styles.cards}>
        <For each={props.players}>
          {(player) => <PlayerCard player={player} scouting={props.scouting} names={props.names ?? "known"} platform={props.platform} />}
        </For>
      </ol>
    </section>
  );
}
