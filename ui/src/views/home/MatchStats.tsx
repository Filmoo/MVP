/**
 * The raw end-of-game numbers of an opened game, like the League client's post-game Stats tab, a
 * few groups at a time: the tabs of a window past its scoreboard (`STAT_TABS`), each one fitting a
 * window (nothing scrolls there). Stats in groups as rows, the ten players as columns (their
 * champions as heads, in their team's colour, the page owner's column marked), each row's highest
 * value marked. A row no player of the game has is left out (no wards on Howling Abyss, what the
 * source doesn't count). A narrow window has no room for ten columns: it turns the table around,
 * the players as rows and the tab's leading stats as columns, as many as fit.
 */
import { createMemo, For, type JSX, Show } from "solid-js";
import { useData } from "../../data/context";
import type { EndOfGameStats } from "../../data/generated/EndOfGameStats";
import type { MatchDetails } from "../../data/generated/MatchDetails";
import type { MatchPlayer } from "../../data/generated/MatchPlayer";
import { ChampionIcon } from "../../design/GameIcon";
import { Icon } from "../../design/Icon";
import { t } from "../../i18n";
import { integer } from "../../lib/format";
import { onHowlingAbyss } from "../../lib/queues";
import { formatRiotId } from "../../lib/riot-id";
import styles from "./MatchStats.module.css";

type Words = ReturnType<typeof t>["matchDetails"]["stats"];
type Group = keyof Words["groups"];

/** How a stat reads: a count (default), a detail of the row above, seconds, a mark, or K / D / A. */
type Kind = "sub" | "seconds" | "flag" | "kda";
/** A stat: its words, its value for a player (`null`: the game doesn't count it), how it reads. */
type Stat = [keyof Words["rows"], (p: MatchPlayer) => number | null, Kind?];

const of =
  (key: keyof EndOfGameStats) =>
  (p: MatchPlayer): number | null => {
    const value = p.stats[key];
    return value === null ? null : Number(value);
  };

const GROUPS: Record<Group, Stat[]> = {
  combat: [
    // Ranked by KDA ratio (a game without deaths counts its takedowns).
    ["kda", (p) => (p.kills + p.assists) / Math.max(1, p.deaths), "kda"],
    ["largestKillingSpree", of("largestKillingSpree")],
    ["largestMultiKill", of("largestMultiKill")],
    ["firstBlood", of("firstBlood"), "flag"],
    ["crowdControl", of("crowdControlSeconds"), "seconds"],
  ],
  damageDealt: [
    ["toChampions", (p) => p.damageToChampions],
    ["physical", of("physicalDamageToChampions"), "sub"],
    ["magic", of("magicDamageToChampions"), "sub"],
    ["trueDamage", of("trueDamageToChampions"), "sub"],
    ["toTurrets", of("damageToTurrets")],
    ["toObjectives", of("damageToObjectives")],
  ],
  damageTaken: [
    ["taken", of("damageTaken")],
    ["selfMitigated", of("damageSelfMitigated")],
    ["healing", of("healing")],
    ["healingOnTeammates", of("healingOnTeammates")],
    ["shieldingOnTeammates", of("shieldingOnTeammates")],
  ],
  vision: [
    ["visionScore", (p) => p.visionScore],
    ["wardsPlaced", of("wardsPlaced")],
    ["wardsDestroyed", of("wardsDestroyed")],
    ["controlWards", of("controlWards")],
  ],
  income: [
    ["goldEarned", (p) => p.gold],
    ["goldSpent", of("goldSpent")],
    ["minions", of("minions")],
    ["monsters", of("monsters")],
  ],
  objectives: [
    ["turrets", of("turretsDestroyed")],
    ["inhibitors", of("inhibitorsDestroyed")],
  ],
};

/** A window's tabs past its scoreboard: the stats' groups, two by two (each tab fits a window). */
export const STAT_TABS = {
  damage: ["damageDealt", "damageTaken"],
  vision: ["vision", "income"],
  combat: ["combat", "objectives"],
} as const satisfies Record<string, readonly Group[]>;
export type StatTab = keyof typeof STAT_TABS;

interface Row {
  key: keyof Words["rows"];
  kind: Kind | undefined;
  values: Array<number | null>;
  top: number;
}

/** The groups and rows of `tab` that `game` has: a row shows when a player has more than nothing in it. */
export function statRows(game: MatchDetails, tab: StatTab): Array<{ group: Group; rows: Row[] }> {
  const players = game.teams.flatMap((team) => team.players);
  return STAT_TABS[tab].flatMap((group) => {
    // Howling Abyss has no wards: no vision there (like the scoreboard's column).
    if (group === "vision" && onHowlingAbyss(game.queueId)) return [];
    const rows = GROUPS[group].flatMap(([key, value, kind]) => {
      const values = players.map(value);
      const top = Math.max(0, ...values.map((v) => v ?? 0));
      return top > 0 ? [{ key, kind, values, top }] : [];
    });
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

/** A narrow window's columns, most telling first: each group's first stat, then each one's second… (never a detail of the row above). */
function leading(groups: ReadonlyArray<{ rows: Row[] }>): Row[] {
  const lists = groups.map((g) => g.rows.filter((row) => row.kind !== "sub"));
  const most = Math.max(0, ...lists.map((list) => list.length));
  return Array.from({ length: most }, (_, i) => lists.flatMap((list) => list[i] ?? [])).flat();
}

type Column = { player: MatchPlayer; win: boolean; first: boolean };

export function MatchStats(props: {
  game: MatchDetails;
  tab: StatTab;
  marked: MatchPlayer | undefined;
  /** A narrow window: the players as rows, the tab's leading stats as columns. */
  narrow?: boolean | undefined;
}): JSX.Element {
  const { gameData } = useData();
  const words = () => t().matchDetails.stats;
  const columns = createMemo(() =>
    props.game.teams.flatMap((team) => team.players.map((player, i): Column => ({ player, win: team.win, first: i === 0 }))),
  );
  const groups = createMemo(() => statRows(props.game, props.tab));
  const lead = createMemo(() => leading(groups()));
  const name = (p: MatchPlayer) => {
    const champion = gameData()?.champions.get(p.championId)?.name ?? t().common.championN(p.championId);
    const who = p.riotId ? formatRiotId(p.riotId) : p.hidden ? t().live.hidden : t().live.unknown;
    return `${champion} · ${who}`;
  };
  const value = (row: Row, p: MatchPlayer, v: number | null): JSX.Element => {
    if (v === null) return "–";
    switch (row.kind) {
      case "kda":
        return (
          <>
            {p.kills}
            <span class={styles.slash}>/</span>
            {p.deaths}
            <span class={styles.slash}>/</span>
            {p.assists}
          </>
        );
      case "flag":
        return v > 0 ? <Icon name="check" size={14} label={words().yes} /> : "";
      case "seconds":
        return words().seconds(integer(v));
      default:
        return integer(v);
    }
  };
  // A player's cells: their team's side (the second team starts after a hairline) and the owner's mark.
  const side = (c: Column, i: number) => `${c.first && i > 0 ? styles.split : ""} ${c.player === props.marked ? styles.marked : ""}`;
  /** Player `i`'s number in `row`, the row's highest marked. */
  const number = (row: Row, c: Column, i: number, cls?: string) => {
    const v = row.values[i] ?? null;
    return (
      <td class={cls} data-top={v === row.top ? "" : undefined} data-zero={v === 0 ? "" : undefined}>
        {value(row, c.player, v)}
      </td>
    );
  };
  /** A player: their champion, on their team's colour, and who they are (its name, and its card on hover). */
  const player = (c: Column, scope: "col" | "row", cls = "") => (
    <th scope={scope} class={`${cls} ${c.win ? styles.win : styles.loss}`} aria-label={name(c.player)} data-hint={name(c.player)}>
      <ChampionIcon championId={c.player.championId} size={24} />
    </th>
  );
  return (
    <div class={styles.stats}>
      <Show
        when={props.narrow}
        fallback={
          <table
            class={`${styles.table} ${styles.rows} num`}
            aria-label={t().matchDetails.tabs[props.tab]}
            // Its lines share the window's height (MatchStats.module.css).
            style={{ "--lines": String(groups().reduce((n, g) => n + 1 + g.rows.length, 0)) }}
            data-testid="game-stats"
          >
            <thead>
              <tr>
                <td class={styles.corner} />
                <For each={columns()}>{(c, i) => player(c, "col", side(c, i()))}</For>
              </tr>
            </thead>
            <For each={groups()}>
              {(group) => (
                <tbody>
                  {/* Its own cells too: the owner's column and the teams' hairline run unbroken. */}
                  <tr class={styles.group}>
                    <th scope="rowgroup">{words().groups[group.group]}</th>
                    <For each={columns()}>{(c, i) => <td class={side(c, i())} />}</For>
                  </tr>
                  <For each={group.rows}>
                    {(row) => (
                      <tr data-stat={row.key}>
                        <th scope="row" class={row.kind === "sub" ? styles.sub : undefined}>
                          {words().rows[row.key]}
                        </th>
                        <For each={columns()}>{(c, i) => number(row, c, i(), side(c, i()))}</For>
                      </tr>
                    )}
                  </For>
                </tbody>
              )}
            </For>
          </table>
        }
      >
        <table class={`${styles.table} ${styles.across} num`} aria-label={t().matchDetails.tabs[props.tab]} data-testid="game-stats">
          <thead>
            <tr>
              <td class={styles.corner} />
              <For each={lead()}>
                {(row) => (
                  <th scope="col" data-stat={row.key}>
                    {words().rows[row.key]}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={columns()}>
              {(c, i) => (
                <tr class={side(c, i())}>
                  {player(c, "row")}
                  <For each={lead()}>{(row) => number(row, c, i())}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
