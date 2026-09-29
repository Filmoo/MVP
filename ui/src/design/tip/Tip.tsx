/**
 * Tooltips: one pane at a time, over everything (a popover, in the top layer: no card clips it),
 * anchored to what it explains in CSS (`anchor-name`, flipping to the side with room near the
 * window's edges) and describing it for screen readers (`aria-describedby`). Gone when the
 * pointer or the focus leaves, on Escape or on a click.
 *
 * What uses it, through the app's pointer and focus events (follow.ts forwards them here once one
 * reached such an element; this code loads with the first):
 * - the game's things, `data-tip="item:3031"` (runes, stat shards, trees, spells, items): a card
 *   with the thing's icon, art and full text from the core;
 * - ideas the app explains, `data-tip="tier:S"` (a tier, a page of the app, the client's status):
 *   a compact card in the catalogue's words;
 * - any other explanation, `data-hint="…"` (lines split on `\n`, a heading in `data-hint-title`):
 *   a compact card with that text, the words the component computed;
 * - a grade's why (views/home/MatchDetails.tsx), with its own content.
 */
import { createMemo, createSignal, type JSX, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import type { Description } from "../../data/generated/Description";
import type { DescriptionKind } from "../../data/generated/DescriptionKind";
import type { TextSpan } from "../../data/generated/TextSpan";
import type { GameDataView } from "../../data/static-data";
import type { Transport } from "../../data/transport";
import { t } from "../../i18n";
import { integer } from "../../lib/format";
import styles from "./Tip.module.css";

/** A tooltip: what it hangs from, what it describes (for screen readers), its id and content. */
export interface Tip {
  anchor: HTMLElement;
  owner: HTMLElement;
  id: string;
  body: () => JSX.Element;
  /** Says what the owner's name already says (an icon button's label): not read twice. */
  quiet?: boolean;
  /** What it explains (`nav`, `item`…): where it sits (the rail's pages: beside the rail). */
  kind?: string;
  /** The thing's picture, its light behind the card's header; else a glow of this colour. */
  art?: string | undefined;
  glow?: string | undefined;
}

const [shown, setShown] = createSignal<Tip>();
/** Where the pane is drawn: in the app's root beside the shell (not a change under its glass). */
let host: HTMLElement | undefined;

function Pane(props: Tip): JSX.Element {
  // One pane per tooltip (`keyed` below): nothing here changes while it shows.
  const { id, anchor, body, kind, art, glow } = props;
  let el!: HTMLDivElement;
  onMount(() => {
    el.showPopover();
    // Shown once placed: right after a scroll, a new card's first frame still sees the anchor
    // where it was (Chromium places it with the last frame's scroll), the next one corrects it.
    requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute("data-placed", "")));
  });
  return (
    <div
      ref={el}
      id={id}
      data-testid={id}
      data-kind={kind}
      popover="auto"
      role="tooltip"
      class={/*@once*/ styles.tip}
      // The light behind the header is the card's own `::before` (Tip.module.css): no element.
      style={/*@once*/ { "--art": art && `url(${JSON.stringify(art)})`, "--glow": glow }}
      onToggle={(e) => e.newState === "closed" && untip(anchor)}
    >
      {body()}
    </div>
  );
}

/** When the last tooltip went: the next one within a moment shows at once (the pointer moved on). */
let hiddenAt = 0;

/** Shows `next` instead of the tooltip shown (nothing: hides it). */
export function tip(next?: Tip): void {
  const last = shown();
  if (last?.anchor === next?.anchor) return;
  last?.anchor.style.removeProperty("anchor-name");
  last?.owner.removeAttribute("aria-describedby");
  if (!next) hiddenAt = performance.now();
  if (next) {
    if (!host?.isConnected) {
      host = document.createElement("div");
      host.style.display = "contents";
      (document.getElementById("root") ?? document.body).append(host);
      render(
        () => (
          <Show when={shown()} keyed>
            {(s) => <Pane {...s} />}
          </Show>
        ),
        host,
      );
    }
    next.anchor.style.setProperty("anchor-name", "--tip");
    if (!next.quiet) next.owner.setAttribute("aria-describedby", next.id);
  }
  setShown(next);
}

/** Hides the tooltip if it hangs from `anchor`. */
export function untip(anchor: Element | null | undefined): void {
  if (anchor && shown()?.anchor === anchor) tip();
}

/**
 * Lays out the tooltip hanging from `anchor` again, in a fresh pane: its content grew (a text
 * that came late), and a placed box keeps its side while it grows, even past the window's edge.
 */
function relayout(anchor: HTMLElement): void {
  const now = shown();
  if (now?.anchor === anchor) setShown({ ...now });
}

// Escape closes the tooltip, and only it: an opened game under it stays open.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && shown()) {
      tip();
      e.stopPropagation();
    }
  },
  true,
);

/** What the game's tooltips need from the app. */
export interface TipContext {
  transport: Transport;
  gameData: () => GameDataView | undefined;
}

/** Descriptions asked for, per game data (a new patch or language asks again). */
const asked = new WeakMap<GameDataView, Map<string, Promise<Description | null>>>();

function describe(context: TipContext, data: GameDataView | undefined, kind: string, id: number): Promise<Description | null> {
  // Rune trees have no text: their name says it.
  if (!data || kind === "tree") return Promise.resolve(null);
  const known = asked.get(data) ?? new Map<string, Promise<Description | null>>();
  asked.set(data, known);
  const key = kind + id;
  const found = known.get(key) ?? context.transport.call("game_description", { kind: kind as DescriptionKind, id }).catch(() => null);
  known.set(key, found);
  return found;
}

let pending = 0;
/** The element whose tooltip is about to show (a hover waits a moment). */
let waiting: HTMLElement | undefined;

/** What a hover waits before a tooltip shows (none when one just showed: the pointer moves on). */
const INTENT_MS = 200;
const WARM_MS = 400;

/** The game's things, which the core describes; other `data-tip` kinds are ideas the app explains. */
const THINGS = new Set(["rune", "shard", "tree", "spell", "item"]);

/**
 * Follows the app's pointer and focus events (it forwards them all once one has reached a
 * `data-tip` or `data-hint` element): its tooltip shows while it is hovered (after a moment) or
 * while it, or a control inside it, has the keyboard focus.
 */
export function hint(e: Event, context: TipContext): void {
  const from = e.target as Element;
  const el = from.closest?.<HTMLElement>("[data-tip],[data-hint]");
  if (!el) return;
  const hovered = e.type === "pointerover";
  if (hovered || (e.type === "focusin" && from.matches(":focus-visible"))) {
    // Already shown, or about to be (the pointer crossed into another part of it).
    if (shown()?.anchor === el || (hovered && waiting === el)) return;
    const mine = ++pending;
    waiting = el;
    const show = (next: Omit<Tip, "anchor" | "owner">) => {
      if (mine !== pending) return;
      waiting = undefined;
      if (el.isConnected) tip({ anchor: el, owner: el, ...next });
    };
    const warm = shown() || performance.now() - hiddenAt < WARM_MS;
    const intent = new Promise((ok) => setTimeout(ok, hovered && !warm ? INTENT_MS : 0));
    // `kind:id`, and for a stat shard its row of the page.
    const [kind = "", n = "", row] = (el.dataset.tip ?? "").split(":");
    if (!THINGS.has(kind)) {
      const literal = el.dataset.hint !== undefined;
      let [title, text] = literal ? [el.dataset.hintTitle, el.dataset.hint] : idea(kind, n);
      // A heading that only repeats what the element shows goes (the card starts with its news).
      if (literal && title && el.textContent?.includes(title)) title = undefined;
      const quiet = !title && text === el.getAttribute("aria-label");
      // An idea shows the thing's mark (a tier's badge, a page's icon, the status dot) in its colour.
      const from = literal ? null : el.matches("[data-mark]") ? el : el.querySelector("[data-mark], svg");
      const mark = picture(from);
      const tone = from && !(from instanceof SVGElement) ? tint(from) : undefined;
      if (text) {
        void intent.then(() =>
          show({
            id: "hint",
            kind,
            quiet,
            glow: title && mark ? tone : undefined,
            body: () => <Hint title={title} lines={text.split("\n")} mark={mark} />,
          }),
        );
      }
      return;
    }
    const id = Number(n);
    const data = context.gameData();
    // Its picture as shown: the image (its address, set even before a lazy image loads), or a
    // stat shard's glyph in its stat's colour.
    const art = el instanceof HTMLImageElement ? el.src : undefined;
    const glyph = picture(el.querySelector("svg"));
    const tone = glyph && getComputedStyle(el).getPropertyValue("--shard-tone");
    const [text, setText] = createSignal<Description | null>();
    let placed = false;
    const loaded = describe(context, data, kind, id).then((d) => {
      setText(d);
      // Later than the card: it grew, so it finds its side again.
      if (placed && d) relayout(el);
    });
    // The text too (the core answers in a few ms), so the card doesn't grow once shown; not more
    // than the moment a hover waits anyway.
    void Promise.all([intent, Promise.race([loaded, new Promise((ok) => setTimeout(ok, INTENT_MS))])]).then(() => {
      show({
        id: "game-tip",
        kind,
        art,
        glow: art ? undefined : tone,
        body: () => <GameTip kind={kind} id={id} row={row} data={data} text={text()} art={art} glyph={glyph} tone={tone} />,
      });
      placed = true;
    });
  } else if (e.type.endsWith("out") && !el.contains((e as FocusEvent).relatedTarget as Node | null)) {
    pending++;
    waiting = undefined;
    untip(el);
  }
}

/**
 * A copy of a thing's picture for its card: shown, never focused nor explained again, and never
 * an anchor (a tier badge is its own tooltip's anchor: a copy named `--tip` inside the card would
 * take the name from it, and the card would lose its place).
 */
function picture(from: Element | null | undefined): Element | undefined {
  const copy = from?.cloneNode(true) as Element | undefined;
  for (const name of ["tabindex", "data-tip", "style"]) copy?.removeAttribute(name);
  return copy;
}

/** A mark's colour: its border's when it has one (a tier's badge), else its fill (the status dot). */
function tint(from: Element): string {
  const style = getComputedStyle(from);
  return Number.parseFloat(style.borderTopWidth) > 0 ? style.borderTopColor : style.backgroundColor;
}

/** An idea the app explains (`data-tip="tier:S"`): its name and what it means, from the catalogue. */
function idea(kind: string, key: string): [string | undefined, string | undefined] {
  const { tip, nav, shell, stats } = t();
  const pick = <T,>(words: Record<string, T>): T | undefined => (Object.hasOwn(words, key) ? words[key] : undefined);
  if (kind === "tier") return [stats.tier(key), pick(tip.tiers)];
  if (kind === "nav") return [(pick(nav) as { label?: string } | undefined)?.label, pick(tip.nav)];
  if (kind === "status") return [pick(shell.connection), pick(tip.status)];
  return [undefined, undefined];
}

/**
 * A plain explanation: a heading when it helps (after the thing's mark, which the card lights in
 * its colour, when it has one), then its lines.
 */
function Hint(props: { title: string | undefined; lines: readonly string[]; mark: Node | undefined }): JSX.Element {
  const { title, lines, mark } = props;
  return (
    <>
      {title && (
        <div class={/*@once*/ styles.hintHead}>
          {mark && (
            <span class={/*@once*/ styles.mark} aria-hidden="true">
              {mark}
            </span>
          )}
          <p class={/*@once*/ styles.hintTitle}>{title}</p>
        </div>
      )}
      {lines.map((line) => (
        <p class={/*@once*/ styles.hintLine}>{line}</p>
      ))}
    </>
  );
}

/** A game thing's tooltip: which thing, and its text once the core answered (`null`: none). */
export interface GameTipProps {
  kind: string;
  id: number;
  /** A stat shard's row of the rune page. */
  row?: string | undefined;
  data: GameDataView | undefined;
  text: Description | null | undefined;
  /** Its image (the icon hovered): the card's icon, and its light behind the card. */
  art?: string | undefined;
  /** A stat shard's glyph (it has no image), and its stat's colour. */
  glyph?: Node | undefined;
  tone?: string | undefined;
}

/**
 * What a tooltip says above the text: the thing's name, what it is (`""`: nothing to add) and a
 * figure beside the name (an item's cost). Stat shards the core couldn't name (offline before
 * their first download) get the catalogue's words.
 */
function heading({ kind, id, row, data, text }: GameTipProps): [string, string, string] {
  const { common, tip, shards, champions } = t();
  if (kind === "item") {
    const item = data?.items.get(id);
    return [item?.name ?? common.itemN(id), "", item?.gold ? tip.gold(integer(item.gold)) : ""];
  }
  if (kind === "spell") {
    const cooldown = text?.cooldown;
    return [data?.spells.get(id)?.name ?? common.spellN(id), cooldown ? `${tip.spell} · ${tip.cooldown(cooldown)}` : tip.spell, ""];
  }
  if (kind === "shard") {
    const inRow = (shards.rows as Partial<Record<string, string>>)[row ?? ""];
    const name = text?.name ?? (shards.names as Partial<Record<number, { name: string }>>)[id]?.name;
    return [name ?? shards.unknown, inRow ? `${shards.unknown} · ${inRow}` : shards.unknown, ""];
  }
  if (kind === "tree") return [data?.runeStyles.get(id)?.name ?? common.runeTreeN(id), tip.tree, ""];
  const entry = data?.runes.get(id);
  const what = entry?.row === 0 ? champions.keystone : tip.rune;
  return [entry?.rune.name ?? common.runeN(id), entry ? `${what} · ${entry.style.name}` : what, ""];
}

/**
 * A rune, stat shard, rune tree, summoner spell or item as a card: its icon, name (with an item's
 * cost) and what it is, then what it does in full when the core has the text. Its own picture,
 * blurred, lights the header from behind (the pane's `art`).
 */
export function GameTip(props: GameTipProps): JSX.Element {
  // The thing and its picture stay while the card shows (only its text may come later): set once.
  const { kind, id, art, glyph, tone } = props;
  const color = tone ? { color: tone } : undefined;
  const head = createMemo(() => heading(props));
  const lines = (): readonly TextSpan[][] => {
    const text = props.text?.text ?? [];
    const stat = kind === "shard" && !text.length && (t().shards.names as Partial<Record<number, { stat: string }>>)[id]?.stat;
    return stat ? [[{ text: stat }]] : text;
  };
  return (
    <>
      <div class={/*@once*/ styles.head}>
        <span class={/*@once*/ styles.icon} data-kind={kind} style={/*@once*/ color} aria-hidden="true">
          {art ? <img src={art} alt="" /> : glyph}
        </span>
        <div class={/*@once*/ styles.titles}>
          <p class={/*@once*/ styles.nameRow}>
            <span class={/*@once*/ styles.name}>{head()[0]}</span>
            <Show when={head()[2]}>
              <span class={/*@once*/ `${styles.figure} num`}>{head()[2]}</span>
            </Show>
          </p>
          <Show when={head()[1]}>
            <p class={/*@once*/ styles.what}>{head()[1]}</p>
          </Show>
        </div>
      </div>
      <Show when={lines().length}>
        {/* Line by line (an empty one is the space between two paragraphs); drawn anew if the text changes. */}
        <div class={/*@once*/ styles.text}>
          {lines().map((line) => (
            <p>{line.map(({ text, tone }) => (tone ? <span data-tone={tone}>{text}</span> : text))}</p>
          ))}
        </div>
      </Show>
    </>
  );
}
