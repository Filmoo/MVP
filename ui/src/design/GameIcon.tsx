import { createSignal, type JSX, Show } from "solid-js";
import { useData } from "../data/context";
import type { GameDataView } from "../data/static-data";
import { t } from "../i18n";
import { lightFrom } from "./ambient";
import styles from "./GameIcon.module.css";

type Size = 16 | 20 | 24 | 28 | 32 | 36 | 40 | 44 | 48 | 56 | 64 | 72 | 80;

function ImageWithFallback(props: {
  src: string | undefined;
  alt: string;
  size: Size;
  round?: boolean;
  fallback: string;
  class?: string | undefined;
  /** Shows the name on hover (icons shown without their name next to them). */
  tooltip?: boolean | undefined;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const cls = () => `${styles.icon} ${props.round ? styles.round : ""} ${props.class ?? ""}`;
  const style = () => ({ width: `${props.size}px`, height: `${props.size}px` });
  const title = () => (props.tooltip ? props.alt : undefined);
  return (
    <Show
      when={props.src && !failed()}
      fallback={
        <div class={`${cls()} ${styles.fallback}`} style={style()} role="img" aria-label={props.alt} title={title()} data-free-style>
          {props.size >= 28 ? props.fallback : ""}
        </div>
      }
    >
      <img
        class={cls()}
        src={props.src}
        title={title()}
        alt={props.alt}
        width={props.size}
        height={props.size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

export function ChampionIcon(props: { championId: number; size: Size; round?: boolean }): JSX.Element {
  const { gameData } = useData();
  const champion = () => gameData()?.champions.get(props.championId);
  return (
    <ImageWithFallback
      src={champion() ? `${gameData()?.assetBase}/img/champion/${champion()?.key}.png` : undefined}
      alt={champion()?.name ?? t().common.championN(props.championId)}
      fallback={(champion()?.name ?? "?").slice(0, 2)}
      size={props.size}
      round={props.round ?? false}
    />
  );
}

export function ItemIcon(props: { itemId: number | undefined; size: Size; tooltip?: boolean }): JSX.Element {
  const { gameData } = useData();
  return (
    <Show
      when={props.itemId}
      fallback={
        <div
          class={`${styles.icon} ${styles.item} ${styles.empty}`}
          style={{ width: `${props.size}px`, height: `${props.size}px` }}
          aria-hidden="true"
        />
      }
    >
      {(id) => (
        <ImageWithFallback
          src={gameData() ? `${gameData()?.assetBase}/img/item/${id()}.png` : undefined}
          alt={gameData()?.items.get(id())?.name ?? t().common.itemN(id())}
          fallback=""
          size={props.size}
          class={styles.item}
          tooltip={props.tooltip}
        />
      )}
    </Show>
  );
}

export function SpellIcon(props: { spellId: number; size: Size; tooltip?: boolean }): JSX.Element {
  const { gameData } = useData();
  const spell = () => gameData()?.spells.get(props.spellId);
  return (
    <ImageWithFallback
      src={spell() ? `${gameData()?.assetBase}/img/spell/${spell()?.key}.png` : undefined}
      alt={spell()?.name ?? t().common.spellN(props.spellId)}
      fallback=""
      size={props.size}
      class={styles.spell}
      tooltip={props.tooltip}
    />
  );
}

export function ProfileIcon(props: { iconId: number; size: Size }): JSX.Element {
  const { gameData } = useData();
  return (
    <ImageWithFallback
      src={gameData() ? `${gameData()?.assetBase}/img/profileicon/${props.iconId}.png` : undefined}
      alt={t().common.profileIcon}
      fallback=""
      size={props.size}
    />
  );
}

/** URL of a champion's square icon, for color sampling (ambient light). */
export function championIconUrl(gameData: GameDataView | undefined, championId: number | undefined): string | undefined {
  const key = championId === undefined ? undefined : gameData?.champions.get(championId)?.key;
  return key && gameData ? `${gameData.assetBase}/img/champion/${key}.png` : undefined;
}

/** URL of a champion's art (loading-screen crop): what heroes show and take their colors from. */
export function championArtUrl(gameData: GameDataView | undefined, championId: number | undefined): string | undefined {
  const key = championId === undefined ? undefined : gameData?.champions.get(championId)?.key;
  return key && gameData ? `${gameData.artBase}/img/champion/centered/${key}_0.jpg` : undefined;
}

/** Decorative champion art. Nothing renders until game data is known. */
export function ChampionArt(props: {
  championId: number;
  class?: string | undefined;
  light?: boolean;
  /** Shown instead while there is no art (offline, not published for this patch, failed). */
  fallback?: JSX.Element;
}): JSX.Element {
  const { gameData } = useData();
  const url = () => championArtUrl(gameData(), props.championId);
  const [failed, setFailed] = createSignal(false);
  return (
    <Show when={url() && !failed()} fallback={props.fallback}>
      <img
        ref={(el) => {
          if (props.light) lightFrom(el);
        }}
        class={props.class}
        src={url()}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
