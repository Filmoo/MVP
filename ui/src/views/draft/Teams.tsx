import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DraftSlot } from "../../data/generated/DraftSlot";
import type { DraftView } from "../../data/generated/DraftView";
import { useTone } from "../../design/ambient";
import { Card } from "../../design/Card";
import { ChampionIcon, championIconUrl } from "../../design/GameIcon";
import { t } from "../../i18n";
import { decimal, percent, percentOf100 } from "../../lib/format";
import { roleLabel, roleShort } from "../../lib/roles";
import { PhasePill } from "./PhasePill";
import styles from "./Teams.module.css";

/** Enemy role odds shown per slot: the two likeliest cover almost every draft. */
const ODDS_SHOWN = 2;

/** Two short lines under the name: role, then state (allies) or the two likeliest roles (enemies). */
function lines(slot: DraftSlot, enemy: boolean): [string, string] {
  if (enemy) {
    const [first, second] = slot.roleOdds.slice(0, ODDS_SHOWN).map((o) => `${roleShort(o.role)} ${percent(o.probability)}`);
    return [first ?? "", second ?? ""];
  }
  const role = slot.role ? roleLabel(slot.role) : "";
  // Your hover shows as a dashed ring on the portrait (the slot is too narrow for more words).
  if (slot.isMe) return [role, t().common.you];
  return [role, slot.championId !== null && slot.hovering ? t().draft.hovering : ""];
}

function Slot(props: { slot: DraftSlot; enemy: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = () => (props.slot.championId === null ? undefined : gameData()?.champions.get(props.slot.championId)?.name);
  const text = () => lines(props.slot, props.enemy);
  return (
    <li
      ref={(el) => useTone(el, () => (props.slot.championId === null ? undefined : championIconUrl(gameData(), props.slot.championId)))}
      class={`${styles.slot} ${props.slot.picking ? styles.picking : ""} ${props.slot.hovering ? styles.hovering : ""} ${
        props.slot.championId === null ? "" : styles.filled
      } ${props.slot.isMe ? styles.me : ""}`}
      data-testid={props.enemy ? "enemy-slot" : "ally-slot"}
      data-hint={props.slot.isMe && props.slot.hovering ? t().draft.youHover : undefined}
    >
      <Show when={props.slot.championId} fallback={<div class={styles.empty} aria-hidden="true" />}>
        {(id) => <ChampionIcon championId={id()} size={48} />}
      </Show>
      <span class={`${styles.name} ${name() ? "" : styles.muted}`} data-hint={name()}>
        {name() ?? (props.slot.picking ? t().draft.picking : t().draft.waiting)}
      </span>
      <span class={`${styles.detail} num`}>{text()[0]}</span>
      <span class={`${styles.detail} num ${props.slot.isMe ? styles.you : ""}`}>{text()[1]}</span>
    </li>
  );
}

function Team(props: { title: string; slots: DraftSlot[]; bans: number[]; enemy: boolean }): JSX.Element {
  return (
    <section class={`${styles.team} ${props.enemy ? styles.enemy : styles.ally}`} aria-label={props.title}>
      <div class={styles.teamHead}>
        <h2 class={styles.teamName}>{props.title}</h2>
        <Show when={props.bans.length > 0}>
          <ul class={styles.banList} aria-label={t().draft.bans(props.enemy)}>
            <For each={props.bans}>
              {(id) => (
                <li class={styles.ban}>
                  <ChampionIcon championId={id} size={24} />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      {/* ARAM shows the enemy team only once the game loads. */}
      <Show when={props.slots.length > 0} fallback={<p class={styles.unseen}>{t().draft.enemiesHidden}</p>}>
        <ol class={styles.slots}>
          <For each={props.slots}>{(slot) => <Slot slot={slot} enemy={props.enemy} />}</For>
        </ol>
      </Show>
    </section>
  );
}

/** Both teams' win chances, like the "vs" of a scoreboard. */
function Odds(props: { draft: DraftView; percent: number; plusMinus: number }): JSX.Element {
  return (
    <div class={`${styles.odds} num`}>
      <span class={styles.oddsPill}>
        <PhasePill draft={props.draft} />
      </span>
      <div class={styles.oddsFigures} role="img" aria-label={t().draft.oddsAria(percentOf100(props.percent), decimal(props.plusMinus, 1))}>
        <span class={styles.oddsLabel}>{t().draft.winChance}</span>
        <div class={styles.oddsLine}>
          <span class={styles.us}>{percentOf100(props.percent)}</span>
          <span class={styles.them}>{percentOf100(100 - props.percent)}</span>
        </div>
        <div class={styles.split}>
          <div class={styles.splitUs} style={{ width: `${props.percent}%` }} />
        </div>
        <span class={styles.oddsPm}>± {decimal(props.plusMinus, 1)}</span>
      </div>
    </div>
  );
}

export function Teams(props: { draft: DraftView }): JSX.Element {
  return (
    <Card>
      <div class={styles.strip}>
        <div class={`${styles.teams} ${props.draft.team ? styles.withOdds : ""}`}>
          <Team title={t().draft.yourTeam} slots={props.draft.allies} bans={props.draft.allyBans} enemy={false} />
          <Show when={props.draft.team}>
            {(team) => <Odds draft={props.draft} percent={team().percent} plusMinus={team().plusMinus} />}
          </Show>
          <Team title={t().draft.enemyTeam} slots={props.draft.enemies} bans={props.draft.enemyBans} enemy />
        </div>
      </div>
    </Card>
  );
}
