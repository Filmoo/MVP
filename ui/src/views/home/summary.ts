import type { MatchSummary } from "../../data/generated/MatchSummary";
import type { Role } from "../../data/generated/Role";
import { REMAKE_MAX_SECONDS } from "../../lib/format";

export interface ChampionLine {
  championId: number;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export interface Summary {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  csPerMinute: number;
  /** Average game length in seconds (0 without games). */
  averageSeconds: number;
  champions: ChampionLine[];
  roles: Array<{ role: Role; games: number }>;
}

/** Aggregates recent games; remakes are excluded like in-client stats. */
export function summarize(matches: readonly MatchSummary[]): Summary {
  const counted = matches.filter((m) => m.durationSeconds > REMAKE_MAX_SECONDS);
  const champions = new Map<number, ChampionLine>();
  const roles = new Map<Role, number>();
  let cs = 0;
  let minutes = 0;
  const totals = { wins: 0, kills: 0, deaths: 0, assists: 0 };

  for (const m of counted) {
    const line = champions.get(m.championId) ?? {
      championId: m.championId,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    };
    line.games++;
    line.wins += m.win ? 1 : 0;
    line.kills += m.kills;
    line.deaths += m.deaths;
    line.assists += m.assists;
    champions.set(m.championId, line);
    if (m.role) roles.set(m.role, (roles.get(m.role) ?? 0) + 1);
    totals.wins += m.win ? 1 : 0;
    totals.kills += m.kills;
    totals.deaths += m.deaths;
    totals.assists += m.assists;
    cs += m.creepScore;
    minutes += m.durationSeconds / 60;
  }

  return {
    games: counted.length,
    ...totals,
    csPerMinute: minutes > 0 ? cs / minutes : 0,
    averageSeconds: counted.length > 0 ? (minutes * 60) / counted.length : 0,
    champions: [...champions.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || a.championId - b.championId),
    roles: [...roles.entries()].map(([role, games]) => ({ role, games })).sort((a, b) => b.games - a.games),
  };
}
