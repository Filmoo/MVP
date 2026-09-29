/**
 * The whole game, as an opened game shows it (GameSheet.tsx): both teams, every player's grade
 * with its why, each Riot ID a link to that player's page; and the why of a grade on a match
 * row. Lazy: it rides in the opened game's chunk, which the match list loads on first use.
 */
import { createSignal, For, type JSX, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { useData } from "../../data/context";
import type { GradeFactor } from "../../data/generated/GradeFactor";
import type { MatchDetails as Game } from "../../data/generated/MatchDetails";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchPlayer } from "../../data/generated/MatchPlayer";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { MatchTeam } from "../../data/generated/MatchTeam";
import type { RiotId } from "../../data/generated/RiotId";
import { ChampionIcon, ItemIcon, SpellIcon } from "../../design/GameIcon";
import { t } from "../../i18n";
import { decimal, integer, kdaRatio, percent, signedPoints } from "../../lib/format";
import { onHowlingAbyss } from "../../lib/queues";
import { formatRiotId, isPlatform, playerPath, riotIdKey } from "../../lib/riot-id";
import { roleLabel } from "../../lib/roles";
import { GradeChip } from "./GradeChip";
import styles from "./MatchDetails.module.css";
import table from "./MatchTable.module.css";

const ITEM_SLOTS = 6;

const sameRiotId = (a: RiotId | null, b: RiotId | undefined) => !!a && !!b && riotIdKey("", a) === riotIdKey("", b);

/** The player a game names `focus` (the page owner), else yours. */
export const markedIn = (game: Game, focus: RiotId | undefined): MatchPlayer | undefined => {
  const players = game.teams.flatMap((team) => team.players);
  return players.find((p) => sameRiotId(p.riotId, focus)) ?? players.find((p) => p.isMe);
};

/** A fact of the scoreboard that moved a grade, in words. */
export function factorWords(f: GradeFactor, deaths: number): string {
  const words = t().gradeWhy.factors;
  switch (f.kind) {
    case "kda":
      return deaths === 0 ? t().matches.perfectKda : t().common.kda(decimal(f.value, 2));
    case "csLead":
      return words.csLead(signedPoints(f.value, 0));
    case "goldLead":
      return words.goldLead(signedPoints(f.value, 0));
    default:
      return words[f.kind](percent(f.value));
  }
}

/**
 * A keystone or a rune tree, small, its name on hover. Not the design system's `RuneIcon`: that
 * one lives in the Champions page's chunk, and sharing it would split it into a chunk of its own
 * (0.35 KB more to download in all).
 */
function Rune(props: { id: number | null; tree?: boolean }): JSX.Element {
  const { gameData } = useData();
  const rune = () => {
    const data = gameData();
    const id = props.id;
    if (!data || !id) return undefined;
    return props.tree ? data.runeStyles.get(id) : data.runes.get(id)?.rune;
  };
  return (
    <Show when={rune()} fallback={<span class={styles.rune} />}>
      {(r) => (
        <img class={styles.rune} src={`${gameData()?.artBase}/img/${r().icon}`} alt={r().name} title={r().name} width={16} height={16} />
      )}
    </Show>
  );
}

/** The player behind each line: the sheet's grades explain themselves from it. */
const lines = new WeakMap<Element, MatchPlayer>();

/** How the table links a player's page: `path` is the route (the sheet closes, then goes there). */
export type OpenPlayer = (path: string) => void;

function PlayerLine(props: {
  player: MatchPlayer;
  marked: boolean;
  top: number;
  platform: string | undefined;
  onPlayer?: OpenPlayer;
}): JSX.Element {
  const { gameData } = useData();
  const p = () => props.player;
  const champion = () => gameData()?.champions.get(p().championId)?.name ?? t().common.championN(p().championId);
  const slots = () => Array.from({ length: ITEM_SLOTS }, (_, i) => p().items[i]);
  const sub = () => {
    const role = p().role;
    return role ? `${champion()} · ${roleLabel(role)}` : champion();
  };
  /** The whole Riot ID, on hover of a cut one. */
  const whole = () => {
    const id = p().riotId;
    return id ? formatRiotId(id) : undefined;
  };
  /** Their page: named players only (never a hidden one, nor a bot). */
  const page = () => {
    const id = p().riotId;
    return id && props.platform ? playerPath(props.platform, id) : undefined;
  };
  const name = () => (
    <>
      {p().riotId?.gameName ?? (p().hidden ? t().live.hidden : t().live.unknown)}
      <Show when={p().riotId?.tagLine}>{(tag) => <span class={styles.tag}> #{tag()}</span>}</Show>
    </>
  );
  return (
    <li
      ref={(el) => lines.set(el, props.player)}
      class={`${table.player} ${props.marked ? styles.marked : ""}`}
      data-testid="game-player"
      data-marked={props.marked ? "" : undefined}
    >
      <span class={`${table.champ} ${styles.champ}`}>
        <span class={styles.portrait} title={t().matchDetails.level(p().championLevel)}>
          <ChampionIcon championId={p().championId} size={32} />
          <span class={`${styles.level} num`}>{p().championLevel}</span>
        </span>
        <span class={styles.pair}>
          <For each={p().spells}>{(id) => <SpellIcon spellId={id} size={16} tooltip />}</For>
        </span>
        <span class={styles.pair}>
          <Rune id={p().keystone} />
          <Rune id={p().secondaryTree} tree />
        </span>
      </span>
      <span class={`${table.name} ${styles.who}`}>
        <Show when={page()} fallback={<span class={`${styles.riotId} ${p().riotId ? "" : styles.unnamed}`}>{name()}</span>}>
          {(to) => (
            <a
              class={`${styles.riotId} ${styles.link}`}
              href={`#${to()}`}
              title={whole()}
              onClick={(e) => {
                if (!props.onPlayer) return;
                e.preventDefault();
                props.onPlayer(to());
              }}
            >
              {name()}
            </a>
          )}
        </Show>
        <span class={styles.sub}>{sub()}</span>
      </span>
      <span class={`${table.kda} ${styles.stat} num`}>
        <span>
          {p().kills} <span class={styles.slash}>/</span> <span class={styles.deaths}>{p().deaths}</span>{" "}
          <span class={styles.slash}>/</span> {p().assists}
        </span>
        <span class={styles.sub}>{kdaRatio(p().kills, p().deaths, p().assists)}</span>
      </span>
      <span class={`${table.damage} ${styles.stat} num`} title={t().matchDetails.damageTitle(integer(p().damageToChampions))}>
        <span>{integer(p().damageToChampions)}</span>
        <span class={styles.bar} aria-hidden="true">
          <span class={styles.fill} style={{ width: `${(p().damageToChampions / props.top) * 100}%` }} />
        </span>
      </span>
      <span class={`${table.gold} num`}>{integer(p().gold)}</span>
      <span class={`${table.cs} num`}>{p().creepScore}</span>
      <span class={`${table.vision} num`}>{p().visionScore}</span>
      <span class={`${table.items} ${styles.items}`}>
        <For each={slots()}>{(id) => <ItemIcon itemId={id} size={20} tooltip />}</For>
        <ItemIcon itemId={p().trinket ?? undefined} size={20} tooltip />
      </span>
      {/* Focusable: the keyboard gets the why too. */}
      <span class={`${table.grade} ${styles.grade}`} data-grade={p().grade ? "" : undefined} tabindex={p().grade ? 0 : undefined}>
        <Show when={p().grade}>
          {(g) => (
            <>
              <GradeChip grade={g()} />
              <span class={`${styles.score} num`}>{decimal(g().score, 1)}</span>
            </>
          )}
        </Show>
      </span>
    </li>
  );
}

function TeamLines(props: {
  team: MatchTeam;
  marked: MatchPlayer | undefined;
  top: number;
  platform: string | undefined;
  onPlayer?: OpenPlayer | undefined;
}): JSX.Element {
  const total = (key: "kills" | "deaths" | "assists") => props.team.players.reduce((sum, p) => sum + p[key], 0);
  const columns = () => t().matchDetails.columns;
  const result = () => t().matches.outcome[props.team.win ? "win" : "loss"];
  return (
    <ol class={`${table.team} ${props.team.win ? "" : styles.lost}`} aria-label={result()}>
      <li class={table.head}>
        <span class={`${table.result} num`}>
          <span class={props.team.win ? styles.win : styles.loss}>{result()}</span> · {total("kills")} / {total("deaths")} /{" "}
          {total("assists")}
        </span>
        <span class={table.kda}>{t().profile.stats.kda}</span>
        <span class={table.damage}>{columns().damage}</span>
        <span class={table.gold}>{columns().gold}</span>
        <span class={table.cs}>{columns().cs}</span>
        <span class={table.vision}>{columns().vision}</span>
        <span class={table.items}>{t().champions.items}</span>
        <span class={table.grade} title={t().matchDetails.note}>
          {columns().grade}
        </span>
      </li>
      <For each={props.team.players}>
        {(player) => (
          <PlayerLine
            player={player}
            marked={player === props.marked}
            top={props.top}
            platform={props.platform}
            {...(props.onPlayer ? { onPlayer: props.onPlayer } : {})}
          />
        )}
      </For>
    </ol>
  );
}

/**
 * Both teams, damage bars scaled on the game's top damage; `focus`'s line (else yours) is marked,
 * a grade explains itself on hover or keyboard focus. Games without vision (Howling Abyss:
 * everyone's score is 0) have no vision column. `onPlayer`: how a player's link opens their
 * page (a plain link without it).
 */
export function MatchTable(props: { game: Game; focus: RiotId | undefined; onPlayer?: OpenPlayer }): JSX.Element {
  const players = () => props.game.teams.flatMap((team) => team.players);
  const top = () => Math.max(1, ...players().map((p) => p.damageToChampions));
  const marked = () => markedIn(props.game, props.focus);
  const noVision = () => onHowlingAbyss(props.game.queueId) || players().every((p) => p.visionScore === 0);
  /** Player pages live on the game's platform (`EUW1_…` → `euw1`). */
  const platform = () => {
    const id = props.game.matchId.split("_")[0]?.toLowerCase() ?? "";
    return isPlatform(id) ? id : undefined;
  };
  const explainHere = (e: Event) => explain(e, locateInGame);
  return (
    <div
      class={`${table.table} ${noVision() ? table.noVision : ""}`}
      data-vision={noVision() ? "none" : undefined}
      onPointerOver={explainHere}
      onPointerOut={explainHere}
      onFocusIn={explainHere}
      onFocusOut={explainHere}
    >
      <For each={props.game.teams}>
        {(team) => <TeamLines team={team} marked={marked()} top={top()} platform={platform()} onPlayer={props.onPlayer} />}
      </For>
    </div>
  );
}

/**
 * Why a game got its grade, under its chip (over it when there's no room below): the grade, the
 * place, and the facts that moved it most. A popover over everything, anchored to the chip in
 * CSS so it follows the page as it scrolls; it goes when the pointer or the focus leaves, on
 * Escape, or on a click elsewhere.
 */
export function GradeWhy(props: { grade: MatchGrade; deaths: number; onClose: () => void }): JSX.Element {
  let el!: HTMLDivElement;
  const words = () => t().gradeWhy;
  onMount(() => el.showPopover());
  return (
    <div
      ref={el}
      id="grade-why"
      popover="auto"
      role="tooltip"
      class={`${styles.why} glass-rim`}
      data-testid="grade-why"
      onToggle={(e) => e.newState === "closed" && props.onClose()}
    >
      <p class={styles.whyTitle}>
        <GradeChip grade={props.grade} />
        <span class="num">{words().title(props.grade.letter, decimal(props.grade.score, 1))}</span>
      </p>
      <p class={`${styles.whyPlace} ${props.grade.badge ? styles.whyBadge : ""}`}>
        {((badge) => (badge ? words()[badge] : words().place(t().grade.place(props.grade.place))))(props.grade.badge)}
      </p>
      <ul class={styles.factors}>
        <For each={props.grade.factors}>
          {(f) => <li class={`num ${f.points >= 0 ? styles.up : styles.down}`}>{factorWords(f, props.deaths)}</li>}
        </For>
      </ul>
    </div>
  );
}

/** A grade being explained: the facts, its chip (the popover's anchor), what it describes and where the popover lives. */
interface Shown {
  grade: MatchGrade;
  deaths: number;
  chip: HTMLElement;
  /** Described by the why while it shows: a match row, a player's grade. */
  owner: HTMLElement;
  /** Where the popover is drawn (its widget: inside the sheet for the sheet's grades). */
  at: Element;
}

const [shown, setShown] = createSignal<Shown>();
/** Where the why is drawn: boxless, so the layout around it doesn't see it. */
let host: HTMLElement | undefined;
let unmount: (() => void) | undefined;

/** Explains `next` (or nothing): its chip becomes the popover's anchor and its owner is described by it. */
function show(next?: Shown): void {
  const last = shown();
  last?.chip.style.removeProperty("anchor-name");
  last?.owner.removeAttribute("aria-describedby");
  next?.chip.style.setProperty("anchor-name", "--grade-why");
  next?.owner.setAttribute("aria-describedby", "grade-why");
  setShown(next);
}

/** Hides a why that shows (Escape in the sheet goes to it first): whether one showed. */
export function dismissWhy(): boolean {
  const was = !!shown();
  show();
  return was;
}

/**
 * Follows pointer and focus events: a grade's why shows while its chip is hovered, or while its
 * row or grade has the keyboard focus, and goes when they leave. `locate` finds the grade an
 * event is about.
 */
function explain(e: Event, locate: (target: Element) => Shown | undefined): void {
  const target = e.target as Element;
  const on = e.type === "pointerover" ? target.closest("[data-grade]") : e.type === "focusin" && target.matches(":focus-visible");
  const found = on ? locate(target) : undefined;
  if (found) {
    if (shown()?.chip === found.chip) return;
    if (host?.parentElement !== found.at) {
      unmount?.();
      host?.remove();
      host = document.createElement("div");
      host.style.display = "contents";
      found.at.append(host);
      unmount = render(
        () => <Show when={shown()}>{(s) => <GradeWhy grade={s().grade} deaths={s().deaths} onClose={() => show()} />}</Show>,
        host,
      );
    }
    show(found);
  } else if (
    e.type.endsWith("out") &&
    ((e as PointerEvent).relatedTarget as Element | null)?.closest("[data-grade]") !== target.closest("[data-grade]")
  ) {
    // Leaving for another part of the same grade keeps it.
    show();
  }
}

/** A player's grade in an opened game. */
function locateInGame(target: Element): Shown | undefined {
  const cell = target.closest<HTMLElement>("[data-grade]");
  const line = cell?.closest("[data-testid=game-player]");
  const player = line && lines.get(line);
  const chip = cell?.querySelector<HTMLElement>("[data-chip]");
  const at = cell?.closest("[data-widget]");
  return cell && player?.grade && chip && at ? { grade: player.grade, deaths: player.deaths, chip, owner: cell, at } : undefined;
}

/**
 * Follows the match list's pointer and focus events (it forwards them all): a grade's why shows
 * while its chip is hovered, or while its row has the keyboard focus.
 */
export function hint(e: Event, find: (matchId: string) => { match: MatchSummary; grade: MatchGrade } | undefined): void {
  explain(e, (target) => {
    const row = target.closest<HTMLElement>("button[id^='match-']");
    const chip = row?.querySelector<HTMLElement>("[data-chip]");
    const found = row && find(row.id.slice("match-".length));
    const at = row?.closest("[data-widget]");
    return found && chip && row && at ? { grade: found.grade, deaths: found.match.deaths, chip, owner: row, at } : undefined;
  });
}
