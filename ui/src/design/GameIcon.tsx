import { createSignal, type JSX, Show } from "solid-js";
import { useData } from "../data/context";
import styles from "./GameIcon.module.css";

type Size = 16 | 20 | 24 | 28 | 32 | 40 | 44 | 48 | 56 | 64 | 80;

function ImageWithFallback(props: { src: string | undefined; alt: string; size: Size; round?: boolean; fallback: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  const cls = () => `${styles.icon} ${props.round ? styles.round : ""}`;
  const style = () => ({ width: `${props.size}px`, height: `${props.size}px` });
  return (
    <Show
      when={props.src && !failed()}
      fallback={
        <div class={`${cls()} ${styles.fallback}`} style={style()} role="img" aria-label={props.alt} data-free-style>
          {props.size >= 28 ? props.fallback : ""}
        </div>
      }
    >
      <img
        class={cls()}
        src={props.src}
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
  const { transport, staticData } = useData();
  const champion = () => staticData()?.champions.get(props.championId);
  return (
    <ImageWithFallback
      src={champion() ? `${transport.assetBase}/img/champion/${champion()?.key}.png` : undefined}
      alt={champion()?.name ?? `Champion ${props.championId}`}
      fallback={(champion()?.name ?? "?").slice(0, 2)}
      size={props.size}
      round={props.round ?? false}
    />
  );
}

export function ItemIcon(props: { itemId: number | undefined; size: Size }): JSX.Element {
  const { transport } = useData();
  return (
    <Show
      when={props.itemId}
      fallback={
        <div class={`${styles.icon} ${styles.empty}`} style={{ width: `${props.size}px`, height: `${props.size}px` }} aria-hidden="true" />
      }
    >
      {(id) => <ImageWithFallback src={`${transport.assetBase}/img/item/${id()}.png`} alt={`Item ${id()}`} fallback="" size={props.size} />}
    </Show>
  );
}

export function ProfileIcon(props: { iconId: number; size: Size }): JSX.Element {
  const { transport } = useData();
  return (
    <ImageWithFallback
      src={`${transport.assetBase}/img/profileicon/${props.iconId}.png`}
      alt="Profile icon"
      fallback=""
      size={props.size}
    />
  );
}
