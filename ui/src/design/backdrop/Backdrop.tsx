import { createEffect, type JSX, onCleanup } from "solid-js";
import styles from "./Backdrop.module.css";
import { effects, osEnvironment, setRendering } from "./controller";
import { plan } from "./quality";

/**
 * The window's light, drawn by a shader behind the shell (first child of `[data-ambient-host]`).
 * Falls back to the CSS light when WebGL is missing or slow, or when effects are turned down.
 */
export function Backdrop(): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  createEffect(() => {
    const { rendering, animate, reason } = plan(effects(), osEnvironment());
    const host = canvas?.closest<HTMLElement>("[data-ambient-host]");
    if (rendering !== "shader" || !canvas || !host) {
      setRendering(rendering === "shader" ? "css" : rendering, reason);
      return;
    }
    setRendering("css"); // until the first frame is drawn
    // The renderer loads only now: Light and Off never download it.
    let stop: (() => void) | null | undefined;
    let cancelled = false;
    const target = canvas;
    import("./engine").then(
      ({ startBackdrop }) => {
        if (!cancelled) stop = startBackdrop(target, host, animate);
      },
      () => setRendering("css"),
    );
    onCleanup(() => {
      cancelled = true;
      stop?.();
    });
  });
  return <canvas ref={canvas} class={styles.canvas} aria-hidden="true" tabIndex={-1} data-free-style data-testid="backdrop" />;
}
