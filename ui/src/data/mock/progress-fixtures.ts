/**
 * After a game and over time, made up and the same on every run: the LP of the fixtures' ranked
 * games (the core's ladder: 100 LP per division, apex tiers plain LP), the last game's summary,
 * mastery, and a history long enough to page through.
 */
import type { ChampionMastery } from "../generated/ChampionMastery";
import type { Division } from "../generated/Division";
import type { LpGame } from "../generated/LpGame";
import type { MatchPlayer } from "../generated/MatchPlayer";
import type { MatchSummary } from "../generated/MatchSummary";
import type { PlayerProfile } from "../generated/PlayerProfile";
import type { PostGame } from "../generated/PostGame";
import type { RankedEntry } from "../generated/RankedEntry";
import type { Tier } from "../generated/Tier";
import { FIXTURE_NOW, profile } from "./fixtures";
import { gameFor } from "./match-fixtures";

const TIERS: Tier[] = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
const DIVISIONS: Division[] = ["IV", "III", "II", "I"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The core's ladder (`companion::lp::ladder`): Iron IV 0 LP is 0, Master 0 LP 2800. */
export function ladder(entry: RankedEntry): number {
  const tier = TIERS.indexOf(entry.tier);
  if (tier >= 7) return 2800 + entry.leaguePoints;
  return (tier * 4 + DIVISIONS.indexOf(entry.division ?? "IV")) * 100 + entry.leaguePoints;
}

/** A standing from its place on the ladder (Master for the apex tiers' shared ladder). */
function standing(value: number, wins: number, losses: number): RankedEntry {
  if (value >= 2800) return { tier: "master", division: null, leaguePoints: value - 2800, wins, losses };
  const step = Math.floor(value / 100);
  return {
    tier: TIERS[Math.floor(step / 4)] ?? "iron",
    division: DIVISIONS[step % 4] ?? "IV",
    leaguePoints: value % 100,
    wins,
    losses,
  };
}

const gameIdOf = (matchId: string) => Number(matchId.slice(matchId.lastIndexOf("_") + 1));

/**
 * The LP of a profile's ranked solo games as the core keeps them (newest first), ending on the
 * profile's standing: +18 to +24 a win, −14 to −19 a loss; `newest` sets the last game's.
 */
export function lpFor(p: PlayerProfile, newest?: number): LpGame[] {
  const now = p.soloQueue;
  if (!now) return [];
  let after = ladder(now);
  let { wins, losses } = now;
  const games: LpGame[] = [];
  p.recentMatches.forEach((m, i) => {
    if (m.queueId !== 420 || m.durationSeconds <= 300) return;
    const delta = i === 0 && newest !== undefined ? newest : m.win ? 18 + ((i * 5) % 7) : -(14 + ((i * 3) % 6));
    const afterEntry = games.length === 0 ? now : standing(after, wins, losses);
    const before = after - delta;
    if (m.win) wins--;
    else losses--;
    games.push({
      gameId: gameIdOf(m.matchId),
      queue: "solo",
      at: m.endedAt,
      before: standing(before, wins, losses),
      after: afterEntry,
      delta,
      ladder: after,
    });
    after = before;
  });
  return games;
}

export const masteryFixture: ChampionMastery[] = [
  { championId: 103, level: 12, points: 412_300 },
  { championId: 134, level: 9, points: 245_800 },
  { championId: 61, level: 7, points: 98_400 },
  { championId: 893, level: 5, points: 41_200 },
  { championId: 517, level: 5, points: 38_900 },
  { championId: 99, level: 4, points: 21_000 },
];

const damageShare = (p: MatchPlayer, team: readonly MatchPlayer[]) =>
  p.damageToChampions /
  Math.max(
    1,
    team.reduce((sum, q) => sum + q.damageToChampions, 0),
  );

/** The summary the core makes of `match` (`companion::post_game::summarize`). */
export function postGameFor(p: PlayerProfile, match: MatchSummary, lp: LpGame | null, lpPending = false): PostGame {
  const game = gameFor(match, p.riotId);
  const mine = game.teams.find((team) => team.players.some((pl) => pl.isMe)) ?? game.teams[0];
  const theirs = game.teams.find((team) => team !== mine);
  const me = mine?.players.find((pl) => pl.isMe);
  if (!mine || !theirs || !me) throw new Error("the fixture's game has your line and two teams");
  const opponent = me.role
    ? (theirs.players.find((pl) => pl.role === me.role) ?? null)
    : ([...theirs.players].sort(
        (a, b) =>
          Math.abs(damageShare(a, theirs.players) - damageShare(me, mine.players)) -
          Math.abs(damageShare(b, theirs.players) - damageShare(me, mine.players)),
      )[0] ?? null);
  return {
    matchId: match.matchId,
    queueId: match.queueId,
    durationSeconds: match.durationSeconds,
    endedAt: match.endedAt,
    win: mine.win,
    me,
    opponent,
    lp,
    lpPending,
  };
}

/** A game that just ended (4 minutes ago), first in `p`'s history. */
function justPlayed(p: PlayerProfile, game: Partial<MatchSummary>): PlayerProfile {
  const [first, ...rest] = p.recentMatches;
  if (!first) return p;
  return { ...p, recentMatches: [{ ...first, ...game, endedAt: FIXTURE_NOW - 4 * MINUTE }, ...rest] };
}

// A win worth +21 LP: Emerald II 46 → 67 LP.
export const winProfile = justPlayed(profile, {});
export const winLp = lpFor(winProfile, 21);
export const winPostGame = postGameFor(winProfile, winProfile.recentMatches[0] as MatchSummary, winLp[0] ?? null);

// A loss with a demotion: Emerald IV 10 LP → Platinum I 75 LP (35 below on the ladder).
const sylas = profile.recentMatches[4] as MatchSummary;
export const demotionProfile: PlayerProfile = {
  ...justPlayed(profile, { ...sylas, matchId: (profile.recentMatches[0] as MatchSummary).matchId }),
  soloQueue: { tier: "platinum", division: "I", leaguePoints: 75, wins: 142, losses: 129 },
};
export const demotionLp = lpFor(demotionProfile, -35);
export const demotionPostGame = postGameFor(demotionProfile, demotionProfile.recentMatches[0] as MatchSummary, demotionLp[0] ?? null);

// A ranked game MVP didn't see start: its LP is unknown; the others' are known.
export const unknownLp = winLp.slice(1);
export const unknownPostGame = postGameFor(winProfile, winProfile.recentMatches[0] as MatchSummary, null);
export const pendingPostGame = postGameFor(winProfile, winProfile.recentMatches[0] as MatchSummary, null, true);

// ARAM: no LP, the opponent is the closest share of damage.
export const aramGameProfile = justPlayed(profile, { queueId: 450, role: null });
export const aramPostGame = postGameFor(aramGameProfile, aramGameProfile.recentMatches[0] as MatchSummary, null);

/** 47 games (flex and ARAM among them), the first 20 on the profile: three pages to load. */
export const longHistory: MatchSummary[] = Array.from({ length: 47 }, (_, i) => {
  const base = profile.recentMatches[i % profile.recentMatches.length] as MatchSummary;
  const queueId = i % 9 === 4 ? 440 : i % 11 === 7 ? 450 : 420;
  return {
    ...base,
    matchId: `EUW1_7510350${String(1000 + i)}`,
    queueId,
    role: queueId === 450 ? null : base.role,
    win: i % 3 === 1 ? !base.win : base.win,
    endedAt: FIXTURE_NOW - Math.round((1.2 + i * 2.6) * HOUR),
  };
});
export const longProfile: PlayerProfile = { ...profile, recentMatches: longHistory.slice(0, 20) };
/** The pages further back, as the core answers `older_matches`. */
export const olderFrom = ({ begIndex }: { begIndex: number }) => longHistory.slice(begIndex, begIndex + 20);
