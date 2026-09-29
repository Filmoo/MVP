/**
 * The English words of the views besides Home (Draft, Live, stats pages, Settings, notices…),
 * loaded with the first of them (see `loadViewWords`). `fr-views.ts` has exactly this shape.
 */
import type { Role } from "../data/generated/Role";
import { games, integer, signedPoints } from "../lib/format";
import { en, plural, roles } from "./en";

const parts = { runes: "runes", itemSet: "item set", spells: "spells" };
/** Update progress: `(45 %)`. */
const progress = (pct: number | null) => (pct === null ? "" : ` (${pct} %)`);

export const enViews = {
  soloDuoShort: "Solo/Duo",

  brackets: { emeraldPlus: "Emerald+", diamondPlus: "Diamond+", masterPlus: "Master+" },

  players: {
    badLink: { title: "Player not found", text: "This link doesn't point to a Riot ID." },
    notFound: {
      title: "Player not found",
      text: (riotId: string, region: string) => `No player named ${riotId} on ${region}. Check the spelling, the tag and the region.`,
    },
    rateLimited: {
      title: "Too many lookups right now",
      text: (seconds: number | null) =>
        seconds === null
          ? "Riot limits how fast we can look players up. Try again in a moment."
          : `Riot limits how fast we can look players up. Try again in ${seconds} s.`,
    },
    unavailable: { title: "Player lookups are unavailable", text: "Our servers can't reach Riot right now. Try again in a moment." },
    network: { title: "Can't reach MVP's servers", text: "Check your internet connection, then try again." },
  },

  /** A match row opened: the whole game. */
  matchDetails: {
    columns: { damage: "Damage", gold: "Gold", cs: "CS", vision: "Vision", grade: "Grade" },
    /** A champion's level at the end of the game. */
    level: (n: number) => `Level ${n}`,
    damageTitle: (damage: string) => `${damage} damage to champions`,
    /** Why a game can't open (unreachable servers and rate limits read like the other lookups'). */
    errors: {
      title: "Couldn't open this game",
      notFound: "This game isn't available anymore.",
      unavailable: "MVP's server can't open games right now. Try again in a moment.",
    },
    note: "Each grade compares the player with the other nine of this game (kill participation, KDA, damage, vision and objectives, CS and gold against the lane opponent), weighted by role. It rates one game, not a player.",
    /** When the game ended: `Today, 21:34`, `12 Sep, 09:05` (`day` from `dayLabel`). */
    playedAt: (day: string, hours: number, minutes: number) =>
      `${day}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    close: "Close",
    /** Scroll to close: shown while the game is pulled past its end or its top. */
    keepScrolling: "Keep scrolling to close",
    /** The raw end-of-game numbers, like the League client's post-game Stats tab. */
    stats: {
      title: "End-of-game stats",
      groups: {
        combat: "Combat",
        damageDealt: "Damage dealt",
        damageTaken: "Damage taken and healing",
        vision: "Vision",
        income: "Income",
        objectives: "Objectives",
      },
      rows: {
        kda: "Kills / deaths / assists",
        largestKillingSpree: "Largest killing spree",
        largestMultiKill: "Largest multikill",
        firstBlood: "First blood",
        crowdControl: "Crowd control on enemies",
        toChampions: "To champions",
        physical: "Physical",
        magic: "Magic",
        trueDamage: "True",
        toTurrets: "To turrets",
        toObjectives: "To objectives",
        taken: "Damage taken",
        selfMitigated: "Self-mitigated",
        healing: "Healing",
        healingOnTeammates: "Healing on teammates",
        shieldingOnTeammates: "Shielding on teammates",
        visionScore: "Vision score",
        wardsPlaced: "Wards placed",
        wardsDestroyed: "Wards destroyed",
        controlWards: "Control wards bought",
        goldEarned: "Gold earned",
        goldSpent: "Gold spent",
        minions: "Minions killed",
        monsters: "Monsters killed",
        turrets: "Turrets destroyed",
        inhibitors: "Inhibitors destroyed",
      },
      /** Seconds of crowd control: `42 s`. */
      seconds: (value: string) => `${value} s`,
      /** First blood's mark, for screen readers. */
      yes: "Yes",
      /** A row's highest value, marked. */
      top: "The most in this game",
    },
  },

  /** Why a game got its grade (hover or focus a match row's grade). */
  gradeWhy: {
    /** `Grade A · 7.4 / 10`. */
    title: (letter: string, score: string) => `Grade ${letter} · ${score} / 10`,
    /** `2nd of 10 in this game`. */
    place: (place: string) => `${place} of 10 in this game`,
    mvp: "MVP: best of the winning team",
    ace: "ACE: best of the losing team",
    /** What moved the grade most, as facts of the scoreboard. */
    factors: {
      killParticipation: (pct: string) => `${pct} kill participation`,
      damageShare: (pct: string) => `${pct} of the team's damage`,
      damageTakenShare: (pct: string) => `${pct} of the damage the team took`,
      objectiveShare: (pct: string) => `${pct} of the team's damage to objectives`,
      visionShare: (pct: string) => `${pct} of the team's vision score`,
      csLead: (diff: string) => `${diff} CS vs the lane opponent`,
      goldLead: (diff: string) => `${diff} gold vs the lane opponent`,
    },
  },

  draft: {
    readFailed: "Couldn't read champion select",
    idle: {
      title: "Not in champion select",
      text: "When your champion select starts, picks for your role show up here and update with every hover, pick and ban.",
    },
    phases: { planning: "Planning", banning: "Banning", picking: "Picking", finalizing: "Finalizing" },
    yourTeam: "Your team",
    enemyTeam: "Enemy team",
    bans: (enemy: boolean): string => (enemy ? "Enemy team bans" : "Your team bans"),
    hovering: "Hovering",
    youHover: "You are hovering this champion",
    picking: "Picking…",
    waiting: "Waiting",
    winChance: "Win chance",
    oddsAria: (us: string, plusMinus: string) => `Win chance: your team ${us}, ± ${plusMinus}`,
    picks: "Picks",
    picksFor: (role: Role | null) => (role ? `Picks for ${roles[role]}` : "Picks for your role"),
    ifPicked: "Win chance if picked",
    teamNow: (pct: string) => `Your team now: ${pct}. The small number is the change.`,
    strength: "Strength",
    vs: (champion: string) => `vs ${champion}`,
    with: (champion: string) => `with ${champion}`,
    tier: (n: number) => `Tier ${n}`,
    best: (tied: boolean): string => (tied ? "Best · statistically tied" : "Best"),
    yourGames: (games: number, winRate: string) => `You · ${games} ${plural(games, "game", "games")} · ${winRate}`,
    yourMastery: (level: number) => `You · Mastery ${level}`,
    masteryTitle: (level: number, points: number) => `Your mastery: level ${level}, ${integer(points)} points`,
    noSuggestions: { title: "No suggestions yet", text: "Suggestions appear once your role is known." },
    noStats: {
      title: "Stats not available yet",
      text: "Pick suggestions need champion stats, which download once our stats service is live.",
    },
    aramPicks: "Yours and the bench",
    yours: "Yours",
    yoursMastery: (level: number) => `Yours · Mastery ${level}`,
    rerolls: (n: number) => `${n} ${plural(n, "reroll", "rerolls")} left`,
    aramWaiting: { title: "Waiting for your champion", text: "Yours and the bench show here." },
    enemiesHidden: "Shown once the game loads",
  },

  why: {
    title: (champion: string | undefined) => (champion ? `Why ${champion}` : "Why"),
    kinds: { base: "Strength", lane: "Lane", jungle: "Jungle", matchup: "Matchup", duo: "Duo" },
    empty: "Select a pick to see how its estimate is built.",
    vsTeamNow: (pct: string) => `vs team now (${pct})`,
    kept: (pct: string) => `${pct} kept`,
    weak: (pct: string) => `weak evidence, ${pct} kept`,
    keptTitle: (pct: string) => `Small samples are pulled toward zero: ${pct} of the observed effect is kept.`,
    roleOdds: (pct: string) => `${pct} role odds`,
    roleOddsTitle: (pct: string) => `Counts only if the role guess holds (${pct} likely).`,
    yourGames: (n: number) => `You: ${n} ${plural(n, "game", "games")}`,
    notInEstimate: "not in estimate",
    notInEstimateTitle: "Your own games are shown for reference; the estimate uses everyone's games.",
    tabs: { pick: "Pick", teams: "Teams" },
    tabsLabel: "Explain",
    teamsTitle: "Team compositions",
    withPick: (champion: string) => `Your team with ${champion}`,
  },

  /** Team compositions in Draft: what each team's champions usually bring. */
  comps: {
    none: "—",
    rows: {
      champions: "Champions",
      damage: "Damage",
      physical: "Physical",
      magic: "Magic",
      trueDamage: "True",
      frontline: "Frontline",
      cc: "Crowd control",
      late: "Late game",
      games: "Games each",
    },
    physicalDamage: "Physical damage",
    magicDamage: "Magic damage",
    times: (x: string) => `${x}×`,
    seconds: (s: string) => `${s} s`,
    atLeast: (n: string) => `≥ ${n}`,
    change: (label: string, from: string, to: string) => `${label} ${from} → ${to}`,
    value: (label: string, value: string) => `${label} ${value}`,
    frontlineTitle: (x: string) => `Damage taken and mitigated: ${x} usual picks in these roles`,
    ccTitle: (usual: string) => `Per game, added up (usual picks: ${usual} s)`,
    lateTitle: (buckets: string) => `Win rate against usual, points: ${buckets}`,
    under: (minutes: number) => `under ${minutes} min`,
    between: (from: number, to: number) => `${from}–${to} min`,
    over: (minutes: number) => `${minutes} min and more`,
    bucket: (length: string, points: string) => `${length} ${points}`,
    readings: {
      mostlyPhysical: "Mostly physical damage",
      mostlyMagic: "Mostly magic damage",
      littleFrontline: "Little frontline",
      lotsOfFrontline: "Lots of frontline",
      littleCc: "Little crowd control",
      lotsOfCc: "Lots of crowd control",
      early: "Stronger in short games",
      late: "Stronger in long games",
    },
    waiting: "Waiting for picks",
    note: (bracket: string, patch: string) =>
      `Usual numbers in each role (enemies: likely roles) · ${bracket} · patch ${patch} · not in the estimate`,
    noteAram: (bracket: string, patch: string) => `Usual numbers in ARAM · ${bracket} · patch ${patch} · not in the estimate`,
    noStats: { title: "No compositions yet", text: "They come with the champion stats." },
    noComps: { title: "No compositions yet", text: "They come with the next stats update." },
  },

  imports: {
    title: "Import build",
    parts: { runes: "Runes", itemSet: "Item set", spells: "Spells" },
    /** Parts inside a sentence ("Imported runes and item set."). */
    nouns: parts,
    importPart: (part: "runes" | "itemSet" | "spells") =>
      ({ runes: "Import runes", itemSet: "Import item set", spells: "Import spells" })[part],
    auto: "Also imported by itself at your first lock-in",
    idle: (flash: string) => `Your own rune pages and item sets are never changed, and ${flash} stays on your key.`,
    /** After the automatic import, your champion or role changed (a trade, a swap). */
    warning: {
      text: (built: string, now: string) => `MVP's build is for ${built}, you're now on ${now}.`,
      importFor: (now: string) => `Import for ${now}`,
    },
    pickFirst: "Hover or lock in a champion first",
    pick: "Hover or lock in a champion",
    notYet: "Builds come with the champion stats, not available yet",
    notYetStatus: "Builds come with the champion stats, which aren't available yet.",
    spellsInChampSelect: "Spells can only change during champion select",
    needsClient: "Open the League client to import into it",
    hovering: "hovering",
    lockedIn: "locked in",
    mostPlayedIn: (queue: 420 | 450, bracket: string) => `most played build in ${en.queues[queue]} · ${bracket}`,
    failed: (message: string) => `Couldn't import: ${message}`,
    fail: {
      noClient: "The League client isn't connected.",
      notAnswering: "The League client didn't answer. It may be busy: try again, or restart it.",
      noBuild: "No build for this champion and role in the stats yet.",
      noRunes: "The stats have no full rune page for this build yet.",
      noItems: "The stats have no items for this build yet.",
      noSpells: "The stats have no summoner spells for this build yet.",
      unsupportedMode: "MVP has no builds for this game mode.",
      noFreePage: "No free rune page: delete one, or rename one to “MVP” to let MVP use it.",
      client: (message: string) => `The League client refused: ${message}`,
    },
    skip: {
      paused: "Paused by MVP for now, while it's fixed for the latest League client.",
      notInChampSelect: "Spells can only change during champion select.",
      champSelectEnded: "Champion select ended before the import.",
      tooLate: (seconds: number) =>
        seconds > 0 ? `Spells not changed: only ${seconds} s left in champion select.` : "Spells not changed: the game is starting.",
    },
    flash: {
      kept: (flash: string, key: string) => `${flash} stays on ${key}, your usual key.`,
      guessed: (flash: string, key: string) => `No ${flash} in your recent games, so it went on ${key}. Pick your key in Settings.`,
      notInBuild: (flash: string) => `This build doesn't take ${flash}.`,
    },
    savedRunes: (name: string) => `“${name}” is your current rune page.`,
    savedItemSet: (name: string) => `Item set “${name}” is in the shop.`,
    spellsOn: (d: string, f: string) => `${d} on D, ${f} on F.`,
    spellsSet: (spells: string) => `Spells set: ${spells}`,
    spellsAlready: (spells: string) => `Spells already set: ${spells}`,
    imported: (parts: string) => `Imported ${parts}.`,
    importedFor: (parts: string, champion: string) => `Imported ${parts} for ${champion}.`,
    notesFor: (champion: string, notes: string) => `${champion}: ${notes}`,
    failedFor: (part: "runes" | "itemSet" | "spells", champion: string, reason: string) =>
      `Couldn't import ${parts[part]} for ${champion}: ${reason}`,
  },

  live: {
    title: "Live game",
    show: "Show",
    tabs: { players: "Players", build: "My build" },
    lookingUp: "Looking players up…",
    /**
     * Riot's live game had no names for this game: the game itself gives them once loaded.
     * When first, why after: narrow windows cut the end of the line.
     */
    names: {
      waiting: "Names after the loading screen",
      filtered: (queue: string) => `Names after the loading screen: Riot doesn't share live ${queue} games`,
    },
    readFailed: "Couldn't read the game",
    idle: {
      title: "Not in a game",
      text: "When your game loads, everyone in it shows up here: rank, recent form and experience on their champion.",
    },
    scouting: {
      busy: (seconds: number | null) =>
        seconds === null ? "Riot is busy: player cards paused" : `Riot is busy: player cards paused for ${seconds} s`,
      network: "Can't reach MVP's servers: no player cards",
      unavailable: "Player cards are unavailable right now",
    },
    otp: (champion: string) => `${champion} one-trick`,
    otpTitle: (share: string, champion: string) => `${share} of recent ranked games on ${champion}`,
    streak: (wins: number) => `${wins} wins in a row`,
    streakTitle: (wins: number) => `Won the last ${wins} ranked games`,
    veteran: "Veteran",
    veteranTitle: (games: number) => `${integer(games)} ranked games this season`,
    kdaOn: (kda: string, champion: string | undefined) => `${kda} KDA on ${champion ?? "this champion"}`,
    /** After a win rate on a card: `54% WR`. */
    wr: "WR",
    mostPlayed: "Most played lately",
    poolTitle: (champion: string, games: number, winRate: string) =>
      `${champion}: ${games} ${plural(games, "game", "games")}, ${winRate} WR`,
    streamer: "Streamer mode",
    mains: (roles: string) => `${roles} main`,
    hidden: "Hidden player",
    /** Not just "Bot": the bottom lane is "Bot" too. */
    bot: "AI bot",
    unknown: "Unknown player",
    cardUnavailable: "Card unavailable",
    noRankedData: "No ranked data",
    build: {
      page: "champion page",
      noMode: { title: "No builds for this mode", text: "MVP's builds cover Summoner's Rift and ARAM." },
      noChampion: { title: "Champion not known yet", text: "Your build shows as soon as the game says who you play." },
    },
  },

  stats: {
    queue: "Queue",
    rank: "Rank",
    role: "Role",
    all: "All",
    queueN: (id: number) => `Queue ${id}`,
    errors: {
      notFound: {
        title: "No stats published yet",
        text: "Nothing is counted for this queue and rank on the current patch yet. Stats appear here as soon as they are published.",
      },
      rateLimited: {
        title: "Too many requests right now",
        text: (seconds: number | null) => (seconds === null ? "Try again in a moment." : `Try again in ${seconds} s.`),
      },
      unavailable: { title: "Stats are unavailable", text: "Our stats service can't answer right now. Try again in a moment." },
      network: {
        title: "Can't reach MVP's servers",
        text: "Check your internet connection, then try again. Stats you opened before stay available offline.",
      },
    },
    tier: (grade: string) => `Tier ${grade}`,
    noGamesOf: (champion: string) => `No games of ${champion} yet`,
    nothingCounted: (scope: string) => `Nothing counted in ${scope} on this patch yet.`,
    nothingCountedNew: (scope: string) => `Nothing counted in ${scope} on this patch yet: new champions show up after their first games.`,
    notEnoughGames: "Not enough games yet.",
    winsInGames: (wins: number, games: number) => `${integer(wins)} wins in ${integer(games)} games`,
    pickedIn: (games: number, of: number) => `Picked in ${integer(games)} of ${integer(of)} games`,
    pick: "pick",
  },

  tierList: {
    title: "Tier list",
    note: "Tiers come from the score: the win rate pulled toward 50 % as if every champion had 1,000 more games at 50 % (so a lucky small sample can't top the list), minus 50 %. S ≥ +2 · A ≥ +0.75 · B ≥ −0.75 · C ≥ −2 · D below. Pick and ban rates are shares of all games counted.",
    columns: {
      rank: "#",
      champion: "Champion",
      tier: "Tier",
      winRate: "Win rate",
      pick: "Pick",
      ban: "Ban",
      score: "Score",
    },
    titles: {
      rank: "Rank by score",
      tier: "S ≥ +2 · A ≥ +0.75 · B ≥ −0.75 · C ≥ −2 · D below (score, points)",
      winRate: "Win rate shrunk toward 50 %: small samples count less",
      pick: "Share of games with this champion in this role",
      ban: "Share of games where it was banned",
      score: "Shrunk win rate minus 50 %, in points: what the tier is based on",
    },
    empty: {
      title: "No champion ranked here yet",
      text: "Champions need enough games in a role to be ranked. Try another role or rank.",
    },
    showAll: (n: number) => `Show all ${n}`,
  },

  champions: {
    title: "Champions",
    all: "All champions",
    search: "Search a champion",
    classes: "Classes",
    record: "Record",
    tiersFrom: { before: "Tiers from the ", link: "tier list", after: (scope: string) => `: ${scope}` },
    noMatch: (query: string) => `No champion matches “${query}”`,
    noneYet: "No champion here yet",
    checkSpelling: "Check the spelling, or clear the search.",
    whenLoaded: "Champions show once game data and stats are loaded.",
    sort: "Sort by",
    sorts: { tier: "Tier", pickRate: "Pick rate", name: "A–Z" },
    /** The group of champions without a tier: not enough games in their role. */
    fewGames: "Too few games",
    /** Why the grid is grouped by class: `reason` is why stats are missing (`Can't reach MVP's servers`). */
    noStats: (reason: string) => `${reason}. Champions are grouped by class until tiers and pick rates are available.`,
    noBuild: {
      title: "No build data yet",
      text: (champion: string, role: Role | undefined) =>
        `${champion} needs more games${role ? ` as ${roles[role]}` : ""} before its build is published.`,
    },
    /** The tier's score: `+3.1 pts over 50 %`. */
    pointsVs50: (score: number) => `${signedPoints(score)} pts ${score >= 0 ? "over" : "under"} 50 %`,
    pointsTitle: "Shrunk win rate minus 50 %, in points (what the tier is based on)",
    winRate: "Win rate",
    pickRate: "Pick rate",
    banRate: "Ban rate",
    patch: "Patch",
    /** Under the patch: which games it counts and when they were published (`Ranked Solo · Emerald+ · 20h ago`). */
    // Each dot goes to the next line with what follows it (no-break space after it).
    patchDetail: (queue: 420 | 450, bracket: string, ago: string) => `${en.queues[queue]} ·\u00A0${bracket} ·\u00A0${ago}`,
    ofGames: (n: number) => `of ${games(n)} ${plural(n, "game", "games")}`,
    bans: (n: number) => `${games(n)} ${plural(n, "ban", "bans")}`,
    shrunkTitle: (wins: number, games: number, raw: string) =>
      `Shrunk toward 50 %: ${integer(wins)} wins in ${integer(games)} games is ${raw} raw`,
    build: "Build",
    runes: "Runes",
    shards: "Shards",
    keystone: "Keystone",
    secondaryTree: "secondary tree",
    runePage: (keystone: string, secondary: string, winRate: string, pick: string) =>
      `${keystone} with ${secondary}: ${winRate} win rate, ${pick} pick`,
    mostPlayedPages: "Most played pages",
    spells: "Summoner spells",
    skills: "Skill order",
    maxOrder: (keys: readonly string[]) => `Max ${keys.join(", then ")}`,
    maxLabel: "Max order",
    levelsLabel: (levels: number) => `Levels 1–${levels}`,
    firstPointsLabel: "Skill taken at each of the first levels",
    items: "Items",
    starting: "Starting items",
    boots: "Boots",
    core: "Core build",
    nth: (n: number) => `${n}th item`,
    matchups: "Matchups",
    lane: "Lane",
    vsJungler: "vs Jungler",
    duos: "Duos",
    bestWith: "Best with",
    bestAgainst: "Best against",
    worstWith: "Worst with",
    worstAgainst: "Worst against",
    noEffect: "No clear effect yet.",
    effectTitle: "Win-rate effect beyond both champions' strength, in points, shrunk when games are few",
    effectNote: "The colored number is the effect on win rate in points, beyond both champions' strength, shrunk when games are few.",
    aram: {
      title: "No matchups in ARAM.",
      text: "Everyone shares one lane with random teams: there is no lane opponent to measure. The builds still apply.",
    },
    noMatchups: { title: "Not enough games yet", text: "Matchups show once enough games of this role are counted." },
    buildTitle: (champion: string, role: Role | undefined) => `${champion} ${role ? roles[role] : "ARAM"} build`,
    summary: { runes: "Runes", spells: "Spells", skills: "Skills", core: "Core items" },
    /** After the win rate: `53.1% win rate · 812 games`. */
    buildRecord: (n: number) => `win rate · ${games(n)} ${plural(n, "game", "games")}`,
  },

  /** Stat shards (Data Dragon doesn't describe them). */
  shards: {
    rows: { offense: "Offense", flex: "Flex", defense: "Defense" },
    names: {
      5001: { name: "Health Scaling", stat: "+10–180 Health (based on level)" },
      5002: { name: "Armor", stat: "+6 Armor" },
      5003: { name: "Magic Resist", stat: "+8 Magic Resist" },
      5005: { name: "Attack Speed", stat: "+10% Attack Speed" },
      5007: { name: "Ability Haste", stat: "+8 Ability Haste" },
      5008: { name: "Adaptive Force", stat: "+9 Adaptive Force" },
      5010: { name: "Move Speed", stat: "+2% Move Speed" },
      5011: { name: "Health", stat: "+65 Health" },
      5013: { name: "Tenacity and Slow Resist", stat: "+10% Tenacity and Slow Resist" },
    },
    unknown: "Stat shard",
    unknownN: (id: number) => `Stat shard ${id}`,
  },

  settings: {
    title: "Settings",
    loadFailed: "Couldn't load your settings",
    saveFailed: (message: string) => `Couldn't save this change. ${message}`,
    seconds: (n: number) => `${n} s`,
    spokenSeconds: (n: number) => `${n} ${plural(n, "second", "seconds")}`,
    automation: {
      title: "Automation",
      autoAccept: {
        title: "Auto-accept matches",
        text: "Accepts the match found pop-up for you, after a delay so you still see it. Declining in the client always wins.",
      },
      delay: "Delay before accepting",
      bringToFront: { title: "Bring MVP to the front", text: "Shows the window as soon as your champion select starts." },
      autoSwitch: {
        title: "Switch views with the game",
        text: "Draft in champion select, Live once the game loads, Home when it ends. Pages you open yourself stay open.",
      },
      paused:
        "Auto-accept is paused for everyone while we fix an issue with the League client. Your choice is kept and works again as soon as it's fixed.",
    },
    stats: {
      title: "Stats",
      bracket: "Rank",
      bracketText: "Games from this rank up count for Draft, imported builds, and the stats pages at first.",
    },
    imports: {
      title: "Imports",
      /** Each part's switch. */
      auto: "Auto import",
      runes: {
        title: "Rune page",
        text: "Writes the build's runes into MVP's own page, named “MVP”, and selects it. Your pages are never changed.",
      },
      itemSet: {
        title: "Item set",
        text: "Adds the build to the in-game shop as MVP's set for the champion. Your item sets are never changed.",
      },
      spells: { title: "Summoner spells", text: "Sets the build's spells in champion select, never in its last 5 seconds." },
      flashKey: {
        title: (flash: string) => `${flash} key`,
        text: (flash: string) => `${flash} always goes on this key, whatever the build lists.`,
      },
      fromGames: "From your games",
      footnote:
        "Auto import runs once, at your first lock-in. After a trade or a role swap, Draft offers to import again: MVP never does it by itself. The buttons in Draft and on champion pages always work.",
    },
    app: {
      title: "App",
      closeToTray: {
        title: "Close to tray",
        text: "Closing the window keeps MVP running in the tray, so automations keep working. Quit from the tray icon.",
      },
      launchAtStartup: { title: "Launch at startup", text: "Starts MVP with Windows, quietly in the tray." },
      crashReports: {
        title: "Send crash reports",
        text: "When MVP crashes or a panel fails, it sends what went wrong and the app and Windows versions to MVP's server. Player names, IDs and file paths are removed first, and reports are deleted after 30 days.",
      },
      reportId: {
        title: "Report ID",
        text: "Random, and not linked to your Riot account: with it, your reports can be deleted on request.",
      },
      effects: {
        title: "Visual effects",
        text: "How much glass and light MVP draws. Full bends the light like real glass, when your graphics card draws it easily.",
        levels: { full: "Full", light: "Light", off: "Off" },
        fallback: (reason: string) => `Showing Light for now: ${reason}.`,
        windowsOff: "Light, because Windows' transparency effects are off. Choose Full to keep the glass.",
        reasons: {
          "no-webgl": "this PC has no graphics acceleration for the window",
          slow: "your graphics card can't draw it cheaply",
          "context-lost": "the graphics driver restarted; it comes back on its own",
        } as Record<string, string>,
      },
      language: { title: "Language", text: "Auto follows the language of Windows." },
    },
    about: {
      title: "About",
      version: "Version",
      unknownVersion: "Version unknown",
      platforms: { windows: "Windows", macos: "macOS", linux: "Linux", web: "Browser preview" } as Record<string, string>,
      updates: "Updates",
      dataTitle: "Your data",
      data: "MVP reads the League client on this computer and keeps your settings here, with no account. Player searches and loading-screen cards go through MVP's server, which asks Riot. Crash reports are sent only if you turn them on. Game names and icons come from Riot's Data Dragon.",
      helpTitle: "Something not working?",
      help: "Copy the diagnostics into your report: they tell what MVP and the League client were doing, without your name or account.",
      copy: "Copy diagnostics",
      copied: "Copied: paste them into your report.",
      copyFailed: "Couldn't copy them: the log folder has the same.",
      openLogs: "Open log folder",
      legalTitle: "Legal",
      legal:
        "MVP isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.",
    },
    search: {
      label: "Search settings",
      /** The key that finds it, as printed on keyboards. */
      shortcut: "Ctrl F",
      clear: "Clear search",
      noMatch: (query: string) => `No setting matches “${query}”`,
      tryOther: "Try another word, or fewer words.",
      // What players type for a setting that its words on screen don't say (views/settings/search.ts).
      keywords: {
        autoAccept: "queue, ready check",
        bringToFront: "focus, foreground",
        runes: "keystone",
        itemSet: "items, shop",
        spells: "ignite, teleport",
        flashKey: "D, F, hotkey, keybind",
        bracket: "elo, ranked, tier",
        language: "English, French, Français",
        closeToTray: "minimize, background, systray, exit",
        launchAtStartup: "boot, autostart",
        crashReports: "bug, telemetry",
        effects: "blur, transparency, animations",
        updates: "version, upgrade",
        data: "privacy",
        help: "logs, bug, support, problem",
      },
    },
  },

  updates: {
    unavailable: (reason: string) => `This copy of MVP doesn't update itself (${reason}).`,
    idle: "MVP looks for updates by itself every few hours.",
    check: "Check for updates",
    checking: "Checking for updates…",
    upToDate: "MVP is up to date.",
    available: (version: string) => `Version ${version} is out: it downloads as soon as no game is running.`,
    downloading: (version: string, pct: number | null) => `Downloading version ${version}${progress(pct)}…`,
    ready: (version: string) => `Version ${version} is ready: it installs when you restart MVP, or when you quit.`,
    restart: "Restart to update",
    failed: (message: string) => `Couldn't check for updates: ${message}.`,
    restartFailed: (message: string) => `Couldn't restart into the update: ${message}`,
    required: {
      title: "Update MVP to keep going",
      unsupported: "This version of MVP is no longer supported.",
      inGame: "Finish your game first: MVP updates right after.",
      ready: (version: string) => `MVP ${version} is downloaded and ready.`,
      downloading: (version: string, pct: number | null) => `Downloading MVP ${version}${progress(pct)}…`,
      getting: "Getting the update…",
      cannot: "This copy of MVP can't update itself: please install the latest version.",
      failed: (message: string) => `Couldn't get the update: ${message}.`,
      check: "Check for the update",
    },
  },

  notices: {
    label: "Notices",
    moreInfo: "More info",
    ready: (mandatory: boolean): string => (mandatory ? "Important update ready" : "Update ready"),
    readyText: "installs when you restart, or when you quit.",
    restart: "Restart",
    later: "Later",
  },
};

/** The words of the lazy views. */
export type ViewMessages = typeof enViews;
