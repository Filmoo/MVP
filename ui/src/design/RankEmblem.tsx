import { type JSX, Show } from "solid-js";
import { useRankEmblems } from "../data/emblems";
import type { Tier } from "../data/generated/Tier";
import styles from "./RankEmblem.module.css";

/**
 * Emblem boxes, 4:3 like Riot's art: the crest in the middle, ornaments of higher tiers wider.
 * `xl` at 2× is exactly the core's 192 × 144 crop.
 */
const SIZES = { sm: [48, 36], md: [64, 48], lg: [80, 60], xl: [96, 72] } as const;
export type EmblemSize = keyof typeof SIZES;

interface Ornaments {
  /** Crest scale: higher tiers stand taller, as in the client. */
  scale: number;
  /** Crown points on top (0: none). */
  crown: 0 | 1 | 3 | 5;
  /** Blades out of the shoulders, px (0: none). */
  blades: number;
  /** Wings, as a share of their full sweep (0: none). */
  wings: number;
  /** Horns (Grandmaster). */
  horns?: boolean;
}

const ORNAMENTS: Record<Tier, Ornaments> = {
  iron: { scale: 0.86, crown: 0, blades: 0, wings: 0 },
  bronze: { scale: 0.88, crown: 1, blades: 0, wings: 0 },
  silver: { scale: 0.9, crown: 1, blades: 4, wings: 0 },
  gold: { scale: 0.93, crown: 3, blades: 4, wings: 0 },
  platinum: { scale: 0.95, crown: 3, blades: 6, wings: 0 },
  emerald: { scale: 0.97, crown: 5, blades: 6, wings: 0 },
  diamond: { scale: 1, crown: 5, blades: 8, wings: 0 },
  master: { scale: 1, crown: 5, blades: 0, wings: 0.7 },
  grandmaster: { scale: 1.02, crown: 3, blades: 0, wings: 0.85, horns: true },
  challenger: { scale: 1.05, crown: 5, blades: 0, wings: 1 },
};

/** The shield, centered on (32, 24) in a 64 × 48 box. */
const SHIELD = "M32 7 44 11.5V23.5C44 31.5 38.6 37.3 32 41 25.4 37.3 20 31.5 20 23.5V11.5Z";
/** The same, 3 px in: the bevel's inner edge. */
const BEVEL = "M32 10.2 41 13.6V23.5C41 29.6 37 34.3 32 37.4 27 34.3 23 29.6 23 23.5V13.6Z";

/** A right wing sweeping out of the shoulder, three feathers deep; the left one is its mirror. */
function wing(k: number): string {
  const x = (d: number) => (44 + d * k).toFixed(2);
  return `M43 14 C${x(6)} 9 ${x(12)} 6.5 ${x(17)} 6 L${x(14)} 11 L${x(16)} 11.5 L${x(11)} 16.5 L${x(13)} 17 L${x(7)} 22 L${x(8.5)} 22.5 L43.5 26 Z`;
}

/** Where the shield's peaked top is at `x` (from 11.5 at its shoulders up to 7 in the middle). */
const roof = (x: number) => 11.5 - 4.5 * (1 - Math.min(1, Math.abs(x - 32) / 12));

/** The same path mirrored across the crest's middle (x → 64 − x; absolute commands only). */
function mirror(path: string): string {
  let x = true;
  return path.replace(/-?\d+(?:\.\d+)?/g, (n) => {
    const value = x ? (64 - Number(n)).toFixed(2) : n;
    x = !x;
    return value;
  });
}

/** Crown points standing on the shield's top edge, the middle one tallest. */
function crown(points: number): string {
  if (points === 0) return "";
  const left = 24;
  const right = 40;
  const out: string[] = [];
  for (let i = 0; i < points; i++) {
    const cx = points === 1 ? 32 : left + ((right - left) * i) / (points - 1);
    const middle = points === 1 || i === Math.floor(points / 2);
    const tall = middle ? 6 : i === 0 || i === points - 1 ? 3.5 : 4.8;
    const half = middle ? 2.4 : 2;
    // The base sinks 2 px under the edge so the point grows out of the metal.
    const base = (x: number) => (roof(x) + 2).toFixed(2);
    out.push(
      `M${(cx - half).toFixed(2)} ${base(cx - half)} L${cx.toFixed(2)} ${(roof(cx) - tall).toFixed(2)} L${(cx + half).toFixed(2)} ${base(cx + half)}Z`,
    );
  }
  return out.join(" ");
}

function blades(len: number): string {
  if (len === 0) return "";
  return `M44 13 L${44 + len} 10.5 L44 19Z M20 13 L${20 - len} 10.5 L20 19Z`;
}

/** Grandmaster's horns, curling out of the shield's top corners. */
const HORNS = "M22 12.5C19 9 17.5 5.5 18.5 2.5 20.5 5.5 23 8 25.5 10.5Z M42 12.5C45 9 46.5 5.5 45.5 2.5 43.5 5.5 41 8 38.5 10.5Z";

const SVG_NS = "http://www.w3.org/2000/svg";
const TIERS: readonly Tier[] = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "emerald",
  "diamond",
  "master",
  "grandmaster",
  "challenger",
];

/**
 * What every crest shares, defined once for the whole page (a hidden SVG): each tier's metal and
 * enamel (gradients that take the tier's colour from their class) and the crest's body (metal
 * shield, enamel field, cut gem) drawn from `--rank-metal` / `--rank-field` and `currentColor`,
 * which each crest sets. A crest is then a handful of nodes: its ornaments and a `<use>` of the body.
 */
function ensureShared(): void {
  if (typeof document === "undefined" || document.querySelector("svg[data-rank-shared]")) return;
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const svg = el("svg", { "data-rank-shared": "", "aria-hidden": "true" });
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  const defs = el("defs", {});
  const gradient = (id: string, tier: Tier, stops: Array<[number, string | undefined]>) => {
    const g = el("linearGradient", { id, class: styles[tier] ?? "", x1: "0", y1: "0", x2: "0", y2: "1" });
    for (const [offset, cls] of stops) g.appendChild(el("stop", { offset: String(offset), class: cls ?? "" }));
    defs.appendChild(g);
  };
  for (const tier of TIERS) {
    gradient(`rank-metal-${tier}`, tier, [
      [0, styles.light],
      [0.5, styles.mid],
      [1, styles.dark],
    ]);
    gradient(`rank-field-${tier}`, tier, [
      [0, styles.fieldTop],
      [1, styles.fieldBottom],
    ]);
  }
  const body = el("g", { id: "rank-body" });
  body.append(
    el("path", { d: SHIELD, class: styles.shield ?? "" }),
    // Enamel inside the metal rim, then the rim's inner edge.
    el("path", { d: BEVEL, class: styles.field ?? "" }),
    el("path", { d: BEVEL, class: styles.bevel ?? "" }),
    // The gem, the brightest thing in the crest: four facets lit from the top left.
    el("path", { d: "M32 15 38 23 32 23Z", class: styles.facetA ?? "" }),
    el("path", { d: "M32 15 26 23 32 23Z", class: styles.facetB ?? "" }),
    el("path", { d: "M26 23 32 32 32 23Z", class: styles.facetC ?? "" }),
    el("path", { d: "M38 23 32 32 32 23Z", class: styles.facetD ?? "" }),
  );
  defs.appendChild(body);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

/**
 * MVP's own crest for a tier (Riot's emblems aren't in the repository, and may not be
 * downloaded yet): a metal shield with a bevel and a cut gem, in the tier's colour, with
 * ornaments that grow with the tier like the client's (blades, crowns, then wings).
 */
export function TierCrestArt(props: { tier: Tier; width: number; height: number; class?: string | undefined }): JSX.Element {
  ensureShared();
  const o = () => ORNAMENTS[props.tier];
  const transform = () => `translate(32 24) scale(${o().scale}) translate(-32 -24)`;
  return (
    <svg
      class={`${styles.art} ${styles[props.tier]} ${props.class ?? ""}`}
      width={props.width}
      height={props.height}
      viewBox="0 0 64 48"
      aria-hidden="true"
    >
      <g transform={transform()}>
        <Show when={o().wings > 0}>
          <path d={`${wing(o().wings)} ${mirror(wing(o().wings))}`} class={styles.wings} />
        </Show>
        <path d={`${o().horns ? HORNS : ""} ${crown(o().crown)} ${blades(o().blades)}`} class={styles.ornament} />
        <use href="#rank-body" />
      </g>
    </svg>
  );
}

/** No rank: an empty slot where the crest would sit (not a dimmed Iron). */
function UnrankedArt(props: { width: number; height: number }): JSX.Element {
  return (
    <svg class={styles.slot} width={props.width} height={props.height} viewBox="0 0 64 48" aria-hidden="true">
      <g transform="translate(32 24) scale(0.9) translate(-32 -24)">
        <path d={SHIELD} class={styles.slotShield} />
        <path d="M32 15 38 23 32 32 26 23Z" class={styles.slotGem} />
      </g>
    </svg>
  );
}

/**
 * A tier's emblem: Riot's own art once the core has it (downloaded once and cached), else MVP's
 * crest in the same 4:3 box. `unranked` draws an empty slot.
 */
export function RankEmblem(props: { tier: Tier | "unranked"; size: EmblemSize; class?: string | undefined }): JSX.Element {
  const emblems = useRankEmblems();
  const box = () => SIZES[props.size];
  const url = () => (props.tier === "unranked" ? undefined : emblems().get(props.tier));
  return (
    <span
      class={`${styles.emblem} ${props.class ?? ""}`}
      style={{ width: `${box()[0]}px`, height: `${box()[1]}px` }}
      data-emblem={url() ? "riot" : "crest"}
      aria-hidden="true"
    >
      <Show
        when={url()}
        fallback={
          props.tier === "unranked" ? (
            <UnrankedArt width={box()[0]} height={box()[1]} />
          ) : (
            <TierCrestArt tier={props.tier} width={box()[0]} height={box()[1]} />
          )
        }
      >
        {(src) => <img class={styles.image} src={src()} alt="" width={box()[0]} height={box()[1]} decoding="async" draggable={false} />}
      </Show>
    </span>
  );
}
