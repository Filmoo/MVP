/**
 * An opened match row: the whole game (both teams, every player's grade) and the why of a
 * grade. Lazy: it rides in the player page's chunk, which the match list loads on first use
 * with the views' words (RecentMatches `provideDetails`); while the game loads, the row's
 * Suspense shows a skeleton of the table's height.
 */
import { createResource, For, type JSX, onCleanup, Show } from "solid-js";
import { useData } from "../../data/context";
import type { BackendError } from "../../data/generated/BackendError";
import type { GradeFactor } from "../../data/generated/GradeFactor";
import type { MatchDetails as Game } from "../../data/generated/MatchDetails";
import type { MatchGrade } from "../../data/generated/MatchGrade";
import type { MatchPlayer } from "../../data/generated/MatchPlayer";
import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { MatchTeam } from "../../data/generated/MatchTeam";
import type { RiotId } from "../../data/generated/RiotId";
import { ChampionIcon, ItemIcon, SpellIcon } from "../../design/GameIcon";
import { ErrorState } from "../../design/States";
import { tip, untip } from "../../design/tip/Tip";
import { t } from "../../i18n";
import { decimal, integer, kdaRatio, percent, signedPoints } from "../../lib/format";
import { onHowlingAbyss } from "../../lib/queues";
import { formatRiotId, riotIdKey } from "../../lib/riot-id";
import { roleLabel } from "../../lib/roles";
import { Widget } from "../../widgets/Widget";
import { GradeChip } from "./GradeChip";
import styles from "./MatchDetails.module.css";
import table from "./MatchTable.module.css";

const ITEM_SLOTS = 6;

const sameRiotId = (a: RiotId | null, b: RiotId | undefined) => !!a && !!b && riotIdKey("", a) === riotIdKey("", b);

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
 * A keystone or a rune tree, small, what it is in a tooltip. Not the design system's `RuneIcon`:
 * that one lives in the Champions page's chunk, and sharing it would split it into a chunk of its
 * own (0.35 KB more to download in all).
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
        <img
          class={styles.rune}
          src={`${gameData()?.artBase}/img/${r().icon}`}
          alt={r().name}
          data-tip={`${props.tree ? "tree" : "rune"}:${r().id}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so its tooltip shows without a pointer (content on hover or focus)
          tabIndex={0}
          width={16}
          height={16}
        />
      )}
    </Show>
  );
}

function PlayerLine(props: { player: MatchPlayer; marked: boolean; top: number }): JSX.Element {
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
  return (
    <li
      class={`${table.player} ${props.marked ? styles.marked : ""}`}
      data-testid="game-player"
      data-marked={props.marked ? "" : undefined}
    >
      <span class={`${table.champ} ${styles.champ}`}>
        <span class={styles.portrait} data-hint={t().matchDetails.level(p().championLevel)}>
          <ChampionIcon championId={p().championId} size={32} />
          <span class={`${styles.level} num`}>{p().championLevel}</span>
        </span>
        <span class={styles.pair}>
          <For each={p().spells}>{(id) => <SpellIcon spellId={id} size={16} focusable />}</For>
        </span>
        <span class={styles.pair}>
          <Rune id={p().keystone} />
          <Rune id={p().secondaryTree} tree />
        </span>
      </span>
      <span class={`${table.name} ${styles.who}`}>
        <span class={`${styles.riotId} ${p().riotId ? "" : styles.unnamed}`} data-hint={whole()}>
          {p().riotId?.gameName ?? (p().hidden ? t().live.hidden : t().live.unknown)}
          <Show when={p().riotId?.tagLine}>{(tag) => <span class={styles.tag}> #{tag()}</span>}</Show>
        </span>
        <span class={styles.sub}>{sub()}</span>
      </span>
      <span class={`${table.kda} ${styles.stat} num`}>
        <span>
          {p().kills} <span class={styles.slash}>/</span> <span class={styles.deaths}>{p().deaths}</span>{" "}
          <span class={styles.slash}>/</span> {p().assists}
        </span>
        <span class={styles.sub}>{kdaRatio(p().kills, p().deaths, p().assists)}</span>
      </span>
      <span class={`${table.damage} ${styles.stat} num`} data-hint={t().matchDetails.damageTitle(integer(p().damageToChampions))}>
        <span>{integer(p().damageToChampions)}</span>
        <span class={styles.bar} aria-hidden="true">
          <span class={styles.fill} style={{ width: `${(p().damageToChampions / props.top) * 100}%` }} />
        </span>
      </span>
      <span class={`${table.gold} num`}>{integer(p().gold)}</span>
      <span class={`${table.cs} num`}>{p().creepScore}</span>
      <span class={`${table.vision} num`}>{p().visionScore}</span>
      <span class={`${table.items} ${styles.items}`}>
        <For each={slots()}>{(id) => <ItemIcon itemId={id} size={20} focusable />}</For>
        <ItemIcon itemId={p().trinket ?? undefined} size={20} focusable />
      </span>
      <span class={`${table.grade} ${styles.grade}`}>
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

function TeamLines(props: { team: MatchTeam; marked: MatchPlayer | undefined; top: number }): JSX.Element {
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
        {/* How a grade is made, on hover or focus (design/tip). */}
        <span
          class={table.grade}
          data-hint-title={columns().grade}
          data-hint={t().matchDetails.note}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: its explanation (design/tip) shows on keyboard focus too
          tabIndex={0}
        >
          {columns().grade}
        </span>
      </li>
      <For each={props.team.players}>{(player) => <PlayerLine player={player} marked={player === props.marked} top={props.top} />}</For>
    </ol>
  );
}

/**
 * Both teams, damage bars scaled on the game's top damage; `focus`'s line (else yours) is marked.
 * Games without vision (Howling Abyss: everyone's score is 0) have no vision column.
 */
export function MatchTable(props: { game: Game; focus: RiotId | undefined }): JSX.Element {
  const players = () => props.game.teams.flatMap((team) => team.players);
  const top = () => Math.max(1, ...players().map((p) => p.damageToChampions));
  const marked = () => players().find((p) => sameRiotId(p.riotId, props.focus)) ?? players().find((p) => p.isMe);
  const noVision = () => onHowlingAbyss(props.game.queueId) || players().every((p) => p.visionScore === 0);
  return (
    <div class={`${table.table} ${noVision() ? table.noVision : ""}`} data-vision={noVision() ? "none" : undefined}>
      <For each={props.game.teams}>{(team) => <TeamLines team={team} marked={marked()} top={top()} />}</For>
    </div>
  );
}

/** An opened match row: the game, loaded on demand, or why it can't show (with a retry when that can help). */
export function MatchDetails(props: { matchId: string; focus: RiotId | undefined; onClose: () => void }): JSX.Element {
  const { transport } = useData();
  const [game, { refetch }] = createResource(
    () => props.matchId,
    (matchId) => transport.call("match_details", { matchId }),
  );
  // The core's `BackendError` (anything else reads as unreachable), worded like the other lookups.
  const failure = () => {
    const { players, stats, matchDetails } = t();
    const error: BackendError = (game.error as { detail?: BackendError } | undefined)?.detail ?? { kind: "network", message: "" };
    if (error.kind === "network") return { ...players.network, retry: true };
    if (error.kind === "rateLimited") {
      return { title: stats.errors.rateLimited.title, text: stats.errors.rateLimited.text(error.retryAfter), retry: true };
    }
    return { title: matchDetails.errors.title, text: matchDetails.errors[error.kind], retry: error.kind !== "notFound" };
  };
  // Escape (from the row, the game, or nowhere in particular) closes the game and gives the focus
  // back to its row.
  const onKey = (e: KeyboardEvent) => {
    const row = document.getElementById(`match-${props.matchId}`);
    const from = e.target as Node;
    if (e.key !== "Escape" || (from !== document.body && !row?.parentElement?.contains(from))) return;
    props.onClose();
    row?.focus();
  };
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
  return (
    <Widget name="match-details">
      <section
        id={`game-${props.matchId}`}
        aria-labelledby={`match-${props.matchId}`}
        class={`${styles.game} glass-pill`}
        data-testid="game"
      >
        <Show
          when={!game.error}
          fallback={
            <Show when={failure().retry} fallback={<ErrorState title={failure().title} message={failure().text} />}>
              <ErrorState title={failure().title} message={failure().text} onRetry={() => void refetch()} />
            </Show>
          }
        >
          <Show when={game()}>{(g) => <MatchTable game={g()} focus={props.focus} />}</Show>
        </Show>
      </section>
    </Widget>
  );
}

/**
 * Why a game got its grade (design/tip's pane, under its chip or over it when there's no room
 * below): the grade, the place, and the facts that moved it most.
 */
export function GradeWhy(props: { grade: MatchGrade; match: { deaths: number } }): JSX.Element {
  const words = () => t().gradeWhy;
  return (
    <>
      <p class={styles.whyTitle}>
        <GradeChip grade={props.grade} />
        <span class="num">{words().title(props.grade.letter, decimal(props.grade.score, 1))}</span>
      </p>
      <p class={`${styles.whyPlace} ${props.grade.badge ? styles.whyBadge : ""}`}>
        {((badge) => (badge ? words()[badge] : words().place(t().grade.place(props.grade.place))))(props.grade.badge)}
      </p>
      <ul class={styles.factors}>
        <For each={props.grade.factors}>
          {(f) => <li class={`num ${f.points >= 0 ? styles.up : styles.down}`}>{factorWords(f, props.match.deaths)}</li>}
        </For>
      </ul>
    </>
  );
}

/**
 * Follows the match list's pointer and focus events (it forwards them all): a grade's why shows
 * while its chip is hovered, or while its row has the keyboard focus, and goes when they leave.
 */
export function hint(e: Event, find: (matchId: string) => { match: MatchSummary; grade: MatchGrade } | undefined): void {
  const target = e.target as Element;
  const row = target.closest<HTMLElement>("button[id^='match-']");
  const chip = row?.querySelector<HTMLElement>("[data-chip]");
  const on = e.type === "pointerover" ? target.closest("[data-grade]") : e.type === "focusin" && row?.matches(":focus-visible");
  const found = on && row && find(row.id.slice("match-".length));
  if (found && chip && row) {
    tip({ anchor: chip, owner: row, id: "grade-why", body: () => <GradeWhy {...found} /> });
  } else if (e.type.endsWith("out")) {
    // Out of the grade (not into another part of it), or the focus out of its row.
    const to = (e as FocusEvent).relatedTarget as Element | null;
    if (e.type === "focusout" ? !row?.contains(to) : to?.closest("[data-grade]") !== target.closest("[data-grade]")) untip(chip);
  }
}
