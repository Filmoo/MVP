import { For, type JSX, Show } from "solid-js";
import { useData } from "../data/context";
import { ChampionIcon, championArtUrl } from "../design/GameIcon";
import { type LiquidKind, liquid } from "../design/liquid/liquid";
import styles from "./GlassLab.module.css";

interface Piece {
  kind: LiquidKind;
  /** Written on the glass (drops carry nothing: they magnify what's under them). */
  name?: string;
  note?: string;
  shape: "circle" | "knob" | "capsule" | "button" | "panel" | "strip";
  x: number;
  y: number;
}

/** Where each shape starts (px in the lab); drag them around. */
const PIECES: Piece[] = [
  { kind: "bar", name: "Bar", shape: "strip", x: 0, y: 64 },
  { kind: "lens", shape: "circle", x: 96, y: 196 },
  { kind: "lens", shape: "knob", x: 40, y: 330 },
  { kind: "clear", name: "Capsule", note: "clear glass, bent rims", shape: "capsule", x: 300, y: 196 },
  { kind: "clear", name: "Button", shape: "button", x: 340, y: 330 },
  { kind: "panel", name: "Panel", note: "tinted middle for text, clear rim", shape: "panel", x: 640, y: 170 },
];

const LINES = ["Victory", "Ahri · Ranked Solo", "9 / 2 / 11", "10.00 KDA", "231 CS", "8.0 / min", "Emerald II 67 LP"];

/**
 * Glass lab (mock builds only: `#/__harness?show=glass`): each kind of liquid glass over detailed
 * content (art, text, straight lines), to see how each shape bends what is behind it. Drag the
 * pieces around. Needs the Full visual effects.
 */
export default function GlassLab(): JSX.Element {
  const { gameData } = useData();
  const drag = (el: HTMLElement, start: { x: number; y: number }) => {
    let at = start;
    el.style.transform = `translate(${at.x}px, ${at.y}px)`;
    el.onpointerdown = (down) => {
      el.setPointerCapture(down.pointerId);
      const from = { x: down.clientX - at.x, y: down.clientY - at.y };
      el.onpointermove = (move) => {
        at = { x: move.clientX - from.x, y: move.clientY - from.y };
        el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      };
      el.onpointerup = () => {
        el.onpointermove = null;
      };
    };
  };
  return (
    <div class={styles.lab} data-testid="glass-lab">
      <img class={styles.art} src={championArtUrl(gameData(), 103)} alt="" />
      <div class={styles.content} aria-hidden="true">
        <div class={styles.stripes} />
        <For each={[0, 1, 2, 3, 4, 5]}>
          {(row) => (
            <div class={styles.row}>
              <ChampionIcon championId={[103, 54, 99, 412, 64, 39][row] ?? 103} size={36} />
              <For each={LINES}>{(line) => <span class={styles.text}>{line}</span>}</For>
            </div>
          )}
        </For>
      </div>
      <For each={PIECES}>
        {(piece) => (
          <div class={`${styles.piece} ${styles[piece.shape]} glass-rim`} ref={(el) => drag(el, piece)} data-kind={piece.kind}>
            <div class={styles.glass} ref={(el) => liquid(el, piece.kind)} />
            <Show when={piece.name}>
              <span class={styles.name}>{piece.name}</span>
            </Show>
            <Show when={piece.note}>
              <span class={styles.note}>{piece.note}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
