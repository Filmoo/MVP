import { For, type JSX } from "solid-js";
import type { Tier } from "../data/generated/Tier";
import { RankEmblem, TierCrestArt } from "../design/RankEmblem";
import styles from "./GlassLab.module.css";

const TIERS: Tier[] = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];

/** Every tier's crest at every size (dev server only: `#/__harness?show=emblems`). */
export default function EmblemLab(): JSX.Element {
  return (
    <div class={styles.emblems} data-testid="emblem-lab">
      <For each={TIERS}>
        {(tier) => (
          <div class={styles.emblemCell}>
            <TierCrestArt tier={tier} width={160} height={120} />
            <RankEmblem tier={tier} size="xl" />
            <RankEmblem tier={tier} size="lg" />
            <RankEmblem tier={tier} size="md" />
            <RankEmblem tier={tier} size="sm" />
            <span class={styles.note}>{tier}</span>
          </div>
        )}
      </For>
      <div class={styles.emblemCell}>
        <RankEmblem tier="unranked" size="xl" />
        <RankEmblem tier="unranked" size="lg" />
        <RankEmblem tier="unranked" size="md" />
        <RankEmblem tier="unranked" size="sm" />
        <span class={styles.note}>unranked</span>
      </div>
    </div>
  );
}
