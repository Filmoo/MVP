/**
 * The UI's words, in English: the source catalogue, in two parts. This one holds what the first
 * screen needs (shell, title bar search, Home) and ships in the startup bundle; `en-views.ts`
 * holds the words of the other views and loads with the first of them. `fr.ts` and
 * `fr-views.ts` have exactly their shapes.
 *
 * Strings are whole phrases; anything that carries a value is a function of it, so each
 * language orders its words (and agrees them) its own way.
 */
import type { Role } from "../data/generated/Role";
import { games } from "../lib/format";

export const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const roles = { top: "Top", jungle: "Jungle", middle: "Mid", bottom: "Bot", support: "Support" } satisfies Record<Role, string>;

export const en = {
  common: {
    tryAgain: "Try again",
    dismiss: "Dismiss",
    somethingWrong: "Something went wrong",
    comingSoon: "Coming soon",
    panelFailed: "This panel failed to load",
    unknown: "Unknown",
    unranked: "Unranked",
    you: "You",
    champion: "Champion",
    yourChampion: "your champion",
    thisChampion: "This champion",
    championN: (id: number) => `Champion ${id}`,
    itemN: (id: number) => `Item ${id}`,
    spellN: (id: number) => `Spell ${id}`,
    runeN: (id: number) => `Rune ${id}`,
    runeTreeN: (id: number) => `Rune tree ${id}`,
    profileIcon: "Profile icon",
    /** `Name: what it does` (tooltips); French puts a no-break space before the colon. */
    colon: (label: string, text: string) => `${label}: ${text}`,
    /** `812 games`, `1.9M games`. */
    games: (n: number) => `${games(n)} ${plural(n, "game", "games")}`,
    lp: (lp: number) => `${lp} LP`,
    /** A win/loss record: `12W 8L`. */
    record: (wins: number, losses: number) => `${wins}W ${losses}L`,
    wins: (n: number) => `${n}W`,
    losses: (n: number) => `${n}L`,
    kda: (ratio: string) => `${ratio} KDA`,
    /** A win rate after its value, where space is short: `54% WR`. */
    wr: (pct: string) => `${pct} WR`,
    patch: (name: string) => `Patch ${name}`,
    updated: (ago: string) => `updated ${ago}`,
    /** `Last 5: win, win, loss…` for a row of result pips. */
    lastResults: (results: readonly boolean[]) => `Last ${results.length}: ${results.map((w) => (w ? "win" : "loss")).join(", ")}`,
  },

  format: {
    perfect: "Perfect",
    justNow: "just now",
    and: "and",
  },

  days: {
    today: "Today",
    yesterday: "Yesterday",
    /** A day of the last week: `Wednesday`. */
    weekday: (date: Date) => new Intl.DateTimeFormat("en", { weekday: "long" }).format(date),
    /** An older day: `12 Sep`. */
    date: (date: Date) =>
      `${date.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]}`,
  },

  roles,

  /** For tight spots such as role odds under a champion. */
  rolesShort: { top: "Top", jungle: "Jgl", middle: "Mid", bottom: "Bot", support: "Sup" } satisfies Record<Role, string>,

  /** Ranked tiers, as the League client names them. */
  tiers: {
    iron: "Iron",
    bronze: "Bronze",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
    emerald: "Emerald",
    diamond: "Diamond",
    master: "Master",
    grandmaster: "Grandmaster",
    challenger: "Challenger",
  },

  /** Riot's champion classes (Data Dragon tags). */
  classes: { Assassin: "Assassin", Fighter: "Fighter", Mage: "Mage", Marksman: "Marksman", Support: "Support", Tank: "Tank" } as Record<
    string,
    string
  >,

  /** Queue names by queue id. */
  queues: {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    480: "Swiftplay",
    490: "Quickplay",
    700: "Clash",
    900: "ARURF",
    1700: "Arena",
    1900: "URF",
    custom: "Custom",
  },

  soloDuo: "Ranked Solo/Duo",

  nav: {
    main: "Main",
    home: { label: "Home", short: "Home" },
    draft: { label: "Draft", short: "Draft" },
    live: { label: "Live game", short: "Live" },
    champions: { label: "Champions", short: "Champs" },
    tierList: { label: "Tier list", short: "Tiers" },
    settings: { label: "Settings", short: "Settings" },
  },

  shell: {
    connection: {
      connected: "League client connected",
      connecting: "Connecting to League…",
      notRunning: "Waiting for League client",
    },
    minimize: "Minimize",
    maximize: "Maximize",
    close: "Close",
    matchAccepted: "Match accepted",
    acceptFailed: (message: string) => `Couldn't accept the match: ${message}`,
    notFound: {
      title: "Page not found",
      state: "Nothing here",
      text: "This page doesn't exist. Pick a section in the menu.",
    },
  },

  search: {
    label: "Search champions and players",
    placeholder: "Champion or Name#TAG",
    region: "Region",
    results: "Search results",
    hint: "Search a champion, or a player by Riot ID:",
    example: "Name#TAG",
    sections: { recent: "Recent", champions: "Champions", players: "Players" },
    noChampion: "No champion by that name",
    typeRiotId: "Type a Riot ID, like Name#TAG, to find a player",
    player: (region: string) => `Player · ${region}`,
    searchOn: (riotId: string, region: string) => `Search ${riotId} on ${region}`,
    searching: (region: string) => `Searching ${region}…`,
    level: (level: number, region: string) => `Level ${level} · ${region}`,
    noPlayerOn: (region: string) => `No player with this Riot ID on ${region}`,
    checkFailed: "Couldn't check right now · Enter opens the page anyway",
    keys: { enter: "Enter", esc: "Esc", move: "to move", open: "to open", close: "to close" },
    clearRecent: "Clear recent searches",
    again: "Search again",
  },

  home: {
    loadFailed: "Couldn't load your profile",
    waiting: {
      title: "Waiting for the League client",
      text: "Start League of Legends: your profile, live games and champion select help appear here automatically.",
    },
  },

  profile: {
    level: (level: number) => `Level ${level}`,
    main: (champion: string) => `${champion} main`,
    last: (n: number) => `Last ${n}`,
    winRate: (pct: string) => `Win rate ${pct}`,
    lastGames: (n: number) => `Last ${plural(n, "game", `${n} games`)}`,
    stats: {
      winRate: "Win rate",
      kda: "KDA",
      csPerMinute: "CS per minute",
      mainRole: "Main role",
      averageGame: "Average game",
    },
    roleShare: (games: number, of: number) => `${games} of ${of}`,
  },

  matches: {
    title: "Match history",
    outcome: { win: "Victory", loss: "Defeat", remake: "Remake" },
    perfectKda: "Perfect KDA",
    perMinute: (value: string) => `${value} / min`,
    empty: { title: "No recent games", text: "Finish a game and it shows up here, with your stats and build." },
  },

  /** MVP's grade of a game, on each match row (what moved it is in the views' words, `gradeWhy`). */
  grade: {
    /** A place among the ten players: `1st`, `2nd`, `10th`. */
    place: (n: number) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`,
    mvp: "MVP",
    ace: "ACE",
    /** The chip for screen readers (the place follows it as text): `Grade A`. */
    label: (letter: string) => `Grade ${letter}`,
  },

  summary: {
    title: (n: number) => `Champions · last ${n} ${plural(n, "game", "games")}`,
    championsTitle: "Champions",
    empty: { title: "No stats yet", text: "Play a few games to see your form." },
    roles: "Roles",
    remakes: (n: number) => `${n} ${plural(n, "remake", "remakes")} not counted`,
  },
};

/** The words of the first screen. */
export type CoreMessages = typeof en;
