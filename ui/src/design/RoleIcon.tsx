import { type JSX, Show } from "solid-js";
import { coreArt } from "../data/core-art";
import type { Role } from "../data/generated/Role";
import { LineIcon } from "./Icon";
import styles from "./RoleIcon.module.css";

/** League's position icons by role, once the core has them. */
const usePositionIcons = coreArt("position-icons", (art) => art.icons.map((i) => [i.role, i.url] as const));

/**
 * MVP's own drawings of the positions (the Icon family's grid and stroke), shown until the core
 * has League's: the lane on a map square (top and bottom along the edges, mid across), the
 * jungle's talons, the support's winged crest.
 */
const DRAWN: Record<Role, string> = {
  top: "M4 20V4h16M9 9h5v5H9z",
  jungle:
    "M12 20.5C10.3 15.6 10.5 9 12.8 3.5c1.4 5.3 1.6 11.4-.8 17zM11.2 20.2C8.2 18.2 5.8 14.2 5 8.5c2.6 2.2 4.9 5.9 6.2 11.7zM12.8 20.2c3-2 5.4-6 6.2-11.7-2.6 2.2-4.9 5.9-6.2 11.7z",
  middle: "M5 19 19 5M4 9V4h5M20 15v5h-5",
  bottom: "M20 4v16H4M10 10h5v5h-5z",
  support:
    "M12 8.2l3.2 3.6L12 20.5 8.8 11.8zM9.5 10.6C7.3 8.6 4.8 7.9 2.5 8.3c1 2.7 3.6 4.2 6.6 4.2M14.5 10.6c2.2-2 4.7-2.7 7-2.3-1 2.7-3.6 4.2-6.6 4.2M12 3.5l1.4 1.6L12 6.7l-1.4-1.6z",
};

/**
 * A role's icon: League's own (the client's position icons, downloaded and cached by the core,
 * never bundled), in the text's colour; MVP's drawing until the core has it (offline on a first
 * start).
 */
export function RoleIcon(props: { role: Role; size?: 14 | 16 | 20; class?: string | undefined; label?: string | undefined }): JSX.Element {
  const icons = usePositionIcons();
  return (
    <Show
      when={icons().get(props.role)}
      fallback={<LineIcon d={DRAWN[props.role]} size={props.size} class={props.class} label={props.label} />}
    >
      {(url) => (
        <span
          class={`${styles.icon} ${props.class ?? ""}`}
          style={{ "--icon": `url("${url()}")`, "--size": `${props.size ?? 20}px` }}
          role="img"
          aria-label={props.label}
          aria-hidden={props.label ? undefined : "true"}
          data-free-style
        />
      )}
    </Show>
  );
}
