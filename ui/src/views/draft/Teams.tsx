import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DraftSlot } from "../../data/generated/DraftSlot";
import type { DraftView } from "../../data/generated/DraftView";
import { useTone } from "../../design/ambient";
import { Card } from "../../design/Card";
import { ChampionIcon, championIconUrl } from "../../design/GameIcon";
import { percent } from "../../lib/format";
import { ROLE_LABEL, ROLE_SHORT } from "../../lib/roles";
import styles from "./Teams.module.css";

/** Enemy role odds shown per slot: the two likeliest cover almost every draft. */
const ODDS_SHOWN = 2;

/** Two short lines under the name: role, then state (allies) or the two likeliest roles (enemies). */
function lines(slot: DraftSlot, enemy: boolean): [string, string] {
  if (enemy) {
    const [first, second] = slot.roleOdds.slice(0, ODDS_SHOWN).map((o) => `${ROLE_SHORT[o.role]} ${percent(o.probability)}`);
    return [first ?? "", second ?? ""];
  }
  const role = slot.role ? ROLE_LABEL[slot.role] : "";
  if (slot.isMe) return [role, "You"];
  return [role, slot.championId !== null && slot.hovering ? "Hovering" : ""];
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
      }`}
      data-testid={props.enemy ? "enemy-slot" : "ally-slot"}
    >
      <Show when={props.slot.championId} fallback={<div class={styles.empty} aria-hidden="true" />}>
        {(id) => <ChampionIcon championId={id()} size={48} />}
      </Show>
      <span class={`${styles.name} ${name() ? "" : styles.muted}`} title={name()}>
        {name() ?? (props.slot.picking ? "Picking…" : "Waiting")}
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
          <ul class={styles.banList} aria-label={`${props.title} bans`}>
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
      <ol class={styles.slots}>
        <For each={props.slots}>{(slot) => <Slot slot={slot} enemy={props.enemy} />}</For>
      </ol>
    </section>
  );
}

/** Both teams' win chances, like the "vs" of a scoreboard. */
function Odds(props: { percent: number; plusMinus: number }): JSX.Element {
  return (
    <div
      class={`${styles.odds} num`}
      role="img"
      aria-label={`Win chance: your team ${props.percent.toFixed(1)}%, ± ${props.plusMinus.toFixed(1)}`}
    >
      <span class={styles.oddsLabel}>Win chance</span>
      <div class={styles.oddsLine}>
        <span class={styles.us}>{props.percent.toFixed(1)}</span>
        <span class={styles.vs}>vs</span>
        <span class={styles.them}>{(100 - props.percent).toFixed(1)}</span>
      </div>
      <div class={styles.split}>
        <div class={styles.splitUs} style={{ width: `${props.percent}%` }} />
      </div>
      <span class={styles.oddsPm}>± {props.plusMinus.toFixed(1)} pts</span>
    </div>
  );
}

export function Teams(props: { draft: DraftView }): JSX.Element {
  return (
    <Card>
      <div class={styles.strip}>
        <div class={`${styles.teams} ${props.draft.team ? styles.withOdds : ""}`}>
          <Team title="Your team" slots={props.draft.allies} bans={props.draft.allyBans} enemy={false} />
          <Show when={props.draft.team}>{(team) => <Odds percent={team().percent} plusMinus={team().plusMinus} />}</Show>
          <Team title="Enemy team" slots={props.draft.enemies} bans={props.draft.enemyBans} enemy />
        </div>
      </div>
    </Card>
  );
}
