import { type ComponentProps, type JSX, lazy, Suspense } from "solid-js";
import type { Penguin as PenguinMark } from "./Penguin";

/**
 * The penguin where it may appear (design pre-shoot): on the dev server only until the owner
 * picks, loaded on demand there. In every build this is `undefined`, so they pay nothing for it
 * (a static import used behind `import.meta.env.DEV` would still ship).
 */
const Penguin = import.meta.env.DEV ? lazy(() => import("./Penguin").then((m) => ({ default: m.Penguin }))) : undefined;

export function penguinArt(props: ComponentProps<typeof PenguinMark>): JSX.Element | undefined {
  return Penguin ? (
    <Suspense>
      <Penguin {...props} />
    </Suspense>
  ) : undefined;
}
