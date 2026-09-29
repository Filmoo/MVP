import type { TipContext } from "./Tip";

/**
 * Where the tooltips' code is: the player page's chunk carries it (an opened game uses it), with
 * the views' words. A chunk of its own would split the startup chunks it shares (App.tsx).
 */
export type TipsChunk = () => Promise<{ tipHint: (e: Event, context: TipContext) => void }>;

/**
 * The app's tooltips (`data-tip="item:3031"`, `data-hint="…"`: see Tip.tsx), for the whole app:
 * its pointer and focus events go to the tooltips' code, which loads the first time such an
 * element is hovered or focused. Until then a pointer crossing into an element costs one
 * `closest()`; at rest nothing runs.
 */
export function followTips(context: TipContext, load: TipsChunk): () => void {
  let tips: ReturnType<TipsChunk> | undefined;
  const on = (e: Event) => {
    if (!tips && !(e.target as Element).closest?.("[data-tip],[data-hint]")) return;
    tips ??= load();
    void tips.then((m) => m.tipHint(e, context));
  };
  const events = ["pointerover", "pointerout", "focusin", "focusout"];
  for (const type of events) document.addEventListener(type, on);
  return () => {
    for (const type of events) document.removeEventListener(type, on);
  };
}
