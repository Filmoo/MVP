import { createEffect, For, type JSX, on, onCleanup, onMount } from "solid-js";
import { Icon } from "../design/Icon";
import { liquid } from "../design/liquid/liquid";
import { reducedMotion, spring } from "../design/motion";
import { t } from "../i18n";
import { mainRoutes, path, type Route, settingsRoute } from "./router";
import styles from "./Sidebar.module.css";

/** The lens's glide between sections: quick, with a hair of overshoot. */
const GLIDE = spring({ stiffness: 420, damping: 30 });

function NavItem(props: { route: Route }): JSX.Element {
  const active = () => path() === props.route.path;
  const words = () => t().nav[props.route.nav];
  return (
    <a
      href={`#${props.route.path}`}
      class={`${styles.item} ${active() ? styles.active : ""} ${props.route.planned ? styles.planned : ""}`}
      aria-current={active() ? "page" : undefined}
      title={words().label}
      aria-label={words().label}
    >
      <Icon name={props.route.icon} size={20} />
      <span class={styles.label}>{words().short}</span>
    </a>
  );
}

/**
 * The rail. The current section sits on a drop of liquid glass (design/liquid) that glides to
 * the next one, stretching along the way and magnifying what it passes over; at rest it sits
 * behind the icon and label, which stay crisp. Moves run on the compositor; at rest nothing runs.
 */
export function Sidebar(): JSX.Element {
  let rail: HTMLElement | undefined;
  let lens: HTMLSpanElement | undefined;
  let glass: HTMLSpanElement | undefined;
  let at: { x: number; y: number; w: number; h: number } | undefined;
  /** Counts glides: only the last one to finish sets the drop down again. */
  let glides = 0;

  const place = (glide: boolean) => {
    if (!rail || !lens || !glass) return;
    const item = rail.querySelector<HTMLElement>('[aria-current="page"]');
    if (!item) {
      lens.dataset.hidden = "";
      at = undefined;
      return;
    }
    const to = { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight };
    const from = at;
    at = to;
    delete lens.dataset.hidden;
    const move = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px)`;
    lens.style.width = `${to.w}px`;
    lens.style.height = `${to.h}px`;
    lens.style.transform = move(to);
    if (!glide || !from || (from.x === to.x && from.y === to.y) || reducedMotion()) return;
    const moving = lens.animate([{ transform: move(from) }, { transform: move(to) }], {
      duration: GLIDE.duration,
      easing: GLIDE.easing,
    });
    // Over the items while it moves (it magnifies them), behind them again once it lands.
    const ticket = ++glides;
    lens.dataset.moving = "";
    const land = () => {
      if (ticket === glides && lens) delete lens.dataset.moving;
    };
    moving.finished.then(land, land);
    // Liquid, not solid: it stretches along the move, then gathers itself.
    const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
    const stretch = vertical ? "scale(0.9, 1.16)" : "scale(1.16, 0.9)";
    glass.animate([{ transform: "none" }, { transform: stretch, offset: 0.3 }, { transform: "none" }], {
      duration: GLIDE.duration,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  };

  // After the route's aria-current has moved (effects run once the DOM is updated).
  createEffect(on(path, () => place(true), { defer: true }));
  onMount(() => {
    place(false);
    // The layout moves items (rail ↔ tab bar, Settings pinned to the bottom): follow, no glide.
    const resizes = new ResizeObserver(() => place(false));
    if (rail) resizes.observe(rail);
    onCleanup(() => resizes.disconnect());
  });

  return (
    <nav class={styles.sidebar} aria-label={t().nav.main} data-refract="chrome" ref={rail}>
      <div class={`${styles.frost} glass-rim`} aria-hidden="true" ref={(el) => liquid(el, "clear")} />
      <div class={styles.nav}>
        <For each={mainRoutes}>{(route) => <NavItem route={route} />}</For>
      </div>
      <div class={styles.bottom}>
        <NavItem route={settingsRoute} />
      </div>
      <span class={styles.lens} ref={lens} aria-hidden="true" data-hidden data-testid="rail-lens">
        <span
          class={`${styles.glass} glass-rim`}
          ref={(el) => {
            glass = el;
            liquid(el, "lens");
          }}
        />
      </span>
    </nav>
  );
}
