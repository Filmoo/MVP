import { For, type JSX, Show } from "solid-js";
import { queryParam } from "../../app/router";
import { useData } from "../../data/context";
import { useAmbient } from "../../design/ambient";
import { ChampionArt, ChampionIcon, championArtUrl } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { Widget } from "../../widgets/Widget";
import { Planned } from "../Planned";
import page from "../page.module.css";
import styles from "./Champions.module.css";

const PLANNED = "Builds, runes, matchups and win rates for every champion.";

/** One champion's page. Stats aren't built yet: its art, classes and what's coming. */
function ChampionSoon(props: { championId: number }): JSX.Element {
  const { gameData } = useData();
  useAmbient(() => championArtUrl(gameData(), props.championId));
  return (
    <div class={page.page}>
      <Widget name="champion-soon">
        <ChampionSoonHero championId={props.championId} />
      </Widget>
    </div>
  );
}

/** The champion's art with what's coming (also measured alone by the perf suite). */
export function ChampionSoonHero(props: { championId: number }): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.championId);
  return (
    <section class={styles.hero} data-testid="champion-hero">
      <ChampionArt championId={props.championId} class={styles.art} />
      <div class={styles.body}>
        <ChampionIcon championId={props.championId} size={72} />
        <div class={styles.identity}>
          <h1 class={styles.name}>{champion()?.name ?? `Champion ${props.championId}`}</h1>
          <Show when={(champion()?.tags.length ?? 0) > 0}>
            <ul class={styles.tags} aria-label="Classes">
              <For each={champion()?.tags}>{(tag) => <li class={styles.tag}>{tag}</li>}</For>
            </ul>
          </Show>
        </div>
      </div>
      <div class={styles.soon}>
        <span class={styles.soonIcon}>
          <Icon name="sparkles" size={20} />
        </span>
        <div class={styles.soonText}>
          <p class={styles.soonTitle}>Champion stats are coming soon</p>
          <p class={styles.soonDetail}>
            Builds, runes, matchups and win rates for {champion()?.name ?? "this champion"}, from Emerald+ games on the current patch.
          </p>
        </div>
      </div>
    </section>
  );
}

export default function Champions(): JSX.Element {
  const { gameData } = useData();
  const id = () => {
    const raw = queryParam("id");
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  // Unknown ids wait for game data before saying so.
  const known = () => {
    const n = id();
    return n !== undefined && (gameData() === undefined || gameData()?.champions.has(n)) ? n : undefined;
  };
  return (
    <Show when={known()} fallback={<Planned title="Champions" icon="champions" description={PLANNED} />} keyed>
      {(championId) => <ChampionSoon championId={championId} />}
    </Show>
  );
}
