import { type ComponentProps, type JSX, lazy, Suspense } from "solid-js";
import type { Penguin } from "./Penguin";

const Drawing = lazy(() => import("./Penguin").then((m) => ({ default: m.Penguin })));

/**
 * The penguin, loaded when a page first shows it (it isn't on the first screen of a player with
 * League running): its box is kept meanwhile, so nothing moves when it arrives, and the page says
 * it is still loading (tests wait for it).
 */
export function PenguinArt(props: ComponentProps<typeof Penguin>): JSX.Element {
  return (
    <Suspense fallback={<span style={{ display: "block", width: `${props.size}px`, height: `${props.size}px` }} data-state="loading" />}>
      <Drawing {...props} />
    </Suspense>
  );
}
