import { For, type JSX } from "solid-js";
import { Icon } from "../design/Icon";
import { mainRoutes, path, type Route, settingsRoute } from "./router";
import styles from "./Sidebar.module.css";

function NavItem(props: { route: Route }): JSX.Element {
  const active = () => path() === props.route.path;
  return (
    <a
      href={`#${props.route.path}`}
      class={`${styles.item} ${active() ? styles.active : ""} ${props.route.planned ? styles.planned : ""}`}
      aria-current={active() ? "page" : undefined}
      title={props.route.label}
      aria-label={props.route.label}
    >
      <Icon name={props.route.icon} size={20} />
      <span class={styles.label}>{props.route.short}</span>
    </a>
  );
}

export function Sidebar(): JSX.Element {
  return (
    <nav class={styles.sidebar} aria-label="Main" data-refract="chrome">
      <div class={styles.nav}>
        <For each={mainRoutes}>{(route) => <NavItem route={route} />}</For>
      </div>
      <div class={styles.bottom}>
        <NavItem route={settingsRoute} />
      </div>
    </nav>
  );
}
