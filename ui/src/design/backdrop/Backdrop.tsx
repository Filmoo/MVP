import { createEffect, type JSX, onCleanup } from "solid-js";
import styles from "./Backdrop.module.css";
import { effects, setRendering, startBackdrop } from "./controller";
import { environment, plan } from "./quality";

/**
 * The window's light, drawn by a shader behind the shell (first child of `[data-ambient-host]`).
 * Falls back to the CSS light when WebGL is missing or slow, or when effects are turned down.
 */
export function Backdrop(): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  const env = environment();
  createEffect(() => {
    const { rendering, animate } = plan(effects(), env);
    const host = canvas?.closest<HTMLElement>("[data-ambient-host]");
    if (rendering !== "shader" || !canvas || !host) {
      setRendering(rendering === "shader" ? "css" : rendering);
      return;
    }
    setRendering("css"); // until the first frame is drawn
    const stop = startBackdrop(canvas, host, animate);
    onCleanup(() => stop?.());
  });
  return <canvas ref={canvas} class={styles.canvas} aria-hidden="true" tabIndex={-1} data-free-style data-testid="backdrop" />;
}
