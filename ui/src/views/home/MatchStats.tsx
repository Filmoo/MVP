/**
 * The raw end-of-game numbers of an opened game, like the League client's post-game Stats tab:
 * stats in groups as rows, the ten players as columns (their champions as heads, in their team's
 * colour, the page owner's column marked), each row's highest value marked. A row no player of
 * the game has is left out (no wards on Howling Abyss, what the source doesn't count). Narrow
 * sheets scroll it sideways under its sticky first column.
 */
import { For, type JSX } from "solid-js";
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

const GROUPS: ReadonlyArray<[keyof Words["groups"], Stat[]]> = [
  [
    "combat",
    [
      // Ranked by KDA ratio (a game without deaths counts its takedowns).
      ["kda", (p) => (p.kills + p.assists) / Math.max(1, p.deaths), "kda"],
      ["largestKillingSpree", of("largestKillingSpree")],
      ["largestMultiKill", of("largestMultiKill")],
      ["firstBlood", of("firstBlood"), "flag"],
      ["crowdControl", of("crowdControlSeconds"), "seconds"],
    ],
  ],
  [
    "damageDealt",
    [
      ["toChampions", (p) => p.damageToChampions],
      ["physical", of("physicalDamageToChampions"), "sub"],
      ["magic", of("magicDamageToChampions"), "sub"],
      ["trueDamage", of("trueDamageToChampions"), "sub"],
      ["toTurrets", of("damageToTurrets")],
      ["toObjectives", of("damageToObjectives")],
    ],
  ],
  [
    "damageTaken",
    [
      ["taken", of("damageTaken")],
      ["selfMitigated", of("damageSelfMitigated")],
      ["healing", of("healing")],
      ["healingOnTeammates", of("healingOnTeammates")],
      ["shieldingOnTeammates", of("shieldingOnTeammates")],
    ],
  ],
  [
    "vision",
    [
      ["visionScore", (p) => p.visionScore],
      ["wardsPlaced", of("wardsPlaced")],
      ["wardsDestroyed", of("wardsDestroyed")],
      ["controlWards", of("controlWards")],
    ],
  ],
  [
    "income",
    [
      ["goldEarned", (p) => p.gold],
      ["goldSpent", of("goldSpent")],
      ["minions", of("minions")],
      ["monsters", of("monsters")],
    ],
  ],
  [
    "objectives",
    [
      ["turrets", of("turretsDestroyed")],
      ["inhibitors", of("inhibitorsDestroyed")],
    ],
  ],
];

interface Row {
  key: keyof Words["rows"];
  kind: Kind | undefined;
  values: Array<number | null>;
  top: number;
}

/** The groups and rows `game` has: a row shows when a player has more than nothing in it. */
export function statRows(game: MatchDetails): Array<{ group: keyof Words["groups"]; rows: Row[] }> {
  const players = game.teams.flatMap((team) => team.players);
  return GROUPS.flatMap(([group, stats]) => {
    // Howling Abyss has no wards: no vision there (like the team tables' column).
    if (group === "vision" && onHowlingAbyss(game.queueId)) return [];
    const rows = stats.flatMap(([key, value, kind]) => {
      const values = players.map(value);
      const top = Math.max(0, ...values.map((v) => v ?? 0));
      return top > 0 ? [{ key, kind, values, top }] : [];
    });
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

export function MatchStats(props: { game: MatchDetails; marked: MatchPlayer | undefined }): JSX.Element {
  const { gameData } = useData();
  const words = () => t().matchDetails.stats;
  const columns = () => props.game.teams.flatMap((team) => team.players.map((player, i) => ({ player, win: team.win, first: i === 0 })));
  const groups = () => statRows(props.game);
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
  // A column's cells: its team's side (the second team starts after a gap) and the owner's mark.
  const cell = (c: { player: MatchPlayer; win: boolean; first: boolean }, i: number) =>
    `${c.first && i > 0 ? styles.split : ""} ${c.player === props.marked ? styles.marked : ""}`;
  return (
    // A region: on narrow sheets it scrolls sideways, and takes the keyboard's arrows for it.
    <section class={styles.scroll} tabindex="0" aria-labelledby="game-stats" data-testid="game-stats">
      <table class={`${styles.table} num`}>
        <thead>
          <tr>
            <td class={styles.corner} />
            <For each={columns()}>
              {(c, i) => (
                <th scope="col" class={`${cell(c, i())} ${c.win ? styles.win : styles.loss}`} title={name(c.player)}>
                  <ChampionIcon championId={c.player.championId} size={24} />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <For each={groups()}>
          {(group) => (
            <tbody>
              {/* Its own cells too: the owner's column and the teams' hairline run unbroken. */}
              <tr class={styles.group}>
                <th scope="rowgroup">{words().groups[group.group]}</th>
                <For each={columns()}>{(c, i) => <td class={cell(c, i())} />}</For>
              </tr>
              <For each={group.rows}>
                {(row) => (
                  <tr data-stat={row.key}>
                    <th scope="row" class={row.kind === "sub" ? styles.sub : undefined}>
                      {words().rows[row.key]}
                    </th>
                    <For each={columns()}>
                      {(c, i) => {
                        const v = row.values[i()] ?? null;
                        const top = v === row.top;
                        return (
                          <td class={cell(c, i())} data-top={top ? "" : undefined} title={top ? words().top : undefined}>
                            {value(row, c.player, v)}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          )}
        </For>
      </table>
    </section>
  );
}
