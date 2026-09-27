import { For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { DraftSlot } from "../../data/generated/DraftSlot";
import type { DraftView } from "../../data/generated/DraftView";
import { Card } from "../../design/Card";
import { ChampionIcon } from "../../design/GameIcon";
import { percent } from "../../lib/format";
import { ROLE_LABEL } from "./roles";
import styles from "./Teams.module.css";

function Slot(props: { slot: DraftSlot; enemy: boolean }): JSX.Element {
  const { gameData } = useData();
  const name = () => (props.slot.championId === null ? undefined : gameData()?.champions.get(props.slot.championId)?.name);
  const detail = () => {
    const s = props.slot;
    if (props.enemy) {
      if (s.roleOdds.length === 0) return "Role unknown";
      return s.roleOdds.map((o) => `${ROLE_LABEL[o.role]} ${percent(o.probability)}`).join(" · ");
    }
    const role = s.role ? ROLE_LABEL[s.role] : "";
    if (s.championId === null) return role;
    return s.hovering ? `${role} · Hovering` : role;
  };
  return (
    <div
      class={`${styles.slot} ${props.slot.picking ? styles.picking : ""} ${props.slot.hovering ? styles.hovering : ""}`}
      data-testid={props.enemy ? "enemy-slot" : "ally-slot"}
    >
      <Show when={props.slot.championId} fallback={<div class={styles.empty} aria-hidden="true" />}>
        {(id) => <ChampionIcon championId={id()} size={36} />}
      </Show>
      <div class={styles.text}>
        <span class={styles.name}>
          <span class={`${styles.nameText} ${name() ? "" : styles.muted}`}>{name() ?? (props.slot.picking ? "Picking…" : "Waiting")}</span>
          <Show when={props.slot.isMe}>
            <span class={styles.you}>You</span>
          </Show>
        </span>
        <span class={`${styles.detail} num`}>{detail()}</span>
      </div>
    </div>
  );
}

function Team(props: { title: string; slots: DraftSlot[]; bans: number[]; enemy: boolean }): JSX.Element {
  return (
    <div class={`${styles.team} ${props.enemy ? styles.enemy : styles.ally}`}>
      <div class={styles.teamHead}>
        <span class={styles.teamName}>{props.title}</span>
      </div>
      <For each={props.slots}>{(slot) => <Slot slot={slot} enemy={props.enemy} />}</For>
      <div class={styles.bans}>
        <span class={styles.bansLabel}>Bans</span>
        <ul class={styles.banList} aria-label={`${props.title} bans`}>
          <For each={props.bans}>
            {(id) => (
              <li class={styles.ban}>
                <ChampionIcon championId={id} size={24} />
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}

export function Teams(props: { draft: DraftView }): JSX.Element {
  return (
    <Card>
      <div class={styles.teams}>
        <Team title="Your team" slots={props.draft.allies} bans={props.draft.allyBans} enemy={false} />
        <Team title="Enemy team" slots={props.draft.enemies} bans={props.draft.enemyBans} enemy />
      </div>
    </Card>
  );
}
