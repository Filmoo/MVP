# C — LoL Stats Websites: exhaustive feature catalog + data requirements

Research date: 2026-09-27 · Scope: web surfaces of U.GG, OP.GG, Lolalytics, League of Graphs, DPM.lol, Mobalytics, METAsrc, Deeplol, League of Items, Probuildstats, Tracker.gg, plus other notable sites (Porofessor web, xdx.gg, lol.ps, onetricks.gg, lolpros, dodgetracker, championmastery.gg, gol.gg, Blitz web). Desktop apps are only mentioned where the website points to them; another researcher covers them.

---

## 0. How to read this

**Availability tags (as the brief asked):** `[FREE]` works without paying · `[PREMIUM]` needs a paid plan · `[?]` not verified in this session (ambiguous source or prior knowledge). Treat `[?]` as "probably exists, check before relying on it".

**Evidence codes** (in braces after an item) say where each claim comes from:
- `{P}` first-party: the site's own page, help center, official X/Twitter post, or a saved copy of the site's HTML.
- `{C}` reverse-engineered from third-party code on GitHub (API clients, scrapers, captured payloads). Field names given in `code font` are literal.
- `{S}` secondary source: an article, a competitor-analysis doc, or a review.
- `{K}` prior knowledge of the site, not re-checked in this session. These items are always also tagged `[?]`.

Source IDs such as `[S14]` point to §4.

**Method and limits.** Direct fetches of u.gg, op.gg, lolalytics.com, dpm.lol, mobalytics.gg and similar sites are blocked from this environment. The session's shared WebSearch budget ran out after about 40 of my queries. After that, the research relied on GitHub:
- two saved first-party pages: a **U.GG** Yasuo build page (patch 16.6, 2026) and a **League of Graphs** Mel stats page (patch 16.17, 2026);
- captured API payloads: U.GG SSR JSON and OP.GG API fixtures;
- reverse-engineered clients: U.GG GraphQL (investigation dated 2026-07-14), OP.GG API types, the official OP.GG MCP server, Lolalytics mega/Qwik payload types, Mobalytics GraphQL (May 2026), Deeplol b2c API (July 2026), and DPM routes.

**Patch-label caveat.** In 2026, sites label the same patch differently. OP.GG, Lolalytics and League of Graphs show the game version (**16.19**). METAsrc, U.GG ARAM pages and Blitz use Riot's year-based name (**26.19**). Our app should either show both or pick one convention and state it.

---

## 1. Per-site catalogs (taxonomy A–K)

### 1.1 U.GG (u.gg)

**Identity.** The page footer reads "© 2017-2026 **Outplayed Inc.**" and lists sister brands Icy Veins, The Sims Resource, Addicting Games, Fantasy Football Scout and Pocket Gamer {P}[S5]. Enthusiast Gaming acquired U.GG in 2021 and launched U.GG PLUS {P}[S3][S56]. Traffic is about 33–44M visits/month, 55% of it from organic search {S}[S33]. U.GG also owns ProBuildStats {S}[S33].

**Top-nav games {P}[S5]:** LoL, Valorant, Marvel Rivals, Rematch, TFT, Deadlock (NEW), World of Warcraft, Helldivers 2, 2XKO (SOON). There is also a "Download Now" link to the desktop app at `/app`.

**LoL nav {P}[S5]:** Tier List · ARAM Mayhem (NEW) · Champions · Multisearch · Leaderboards · Live Games · Items · Watch (NEW) · News · Probuild Stats.

**Routes seen {P}[S5]:**
- `/lol/tier-list`, `/lol/aram-tier-list`
- `/lol/champions/{c}/build[/{role}]`, `/lol/champions/{c}/counter`
- `/lol/champions/aram/{c}-aram`, `/lol/champions/arena/{c}-arena-build`
- `/lol/champion-leaderboards/{c}`, `/lol/leaderboards`
- `/lol/multisearch`, `/lol/items`, `/watch`
- `/lol/profile/{region}/{name}-{tag}/overview`

#### A. Client integration & automation
- **"Auto-Import" button** on the build page. It pushes runes and items into the client through the U.GG desktop app. `[FREE]` {P}[S5]
- **"Recommended" vs archetype builds** can be imported per archetype `[FREE]` {P}[S5]. The desktop app is Windows-only {S}[S45].

#### B. Champion select / draft
- **Counters page** (`/counter`): best and worst matchups per role `[FREE]` {P}[S5]. Each opponent row is backed by: `win_rate`, `matches`, `pick_rate`, and 15-minute lane advantages `xp_adv_15`, `gold_adv_15`, `cs_adv_15`, `jungle_cs_adv_15`, `kill_adv_15`. Bot-lane pairs have `duo_*` variants (`duo_gold_adv_15`, `duo_xp_adv_15`, `duo_cs_adv_15`, `duo_kill_adv_15`). Rows also carry `carry_percentage_15`, `duo_carry_percentage_15` and `team_gold_difference_15` {C}[S8][S9].
- **"Toughest Matchups"** block on the build page: 10 counters, each with WR% and match count (e.g. Yasuo mid vs Annie: 40.7%, 381 matches) `[FREE]` {P}[S5].
- **Duo synergy data**: the `champion_duos` endpoint returns `[partnerId, wins, matches]` per champion and role `[FREE]` {C}[S13].
- **Duo tier list** (bot-lane pairs) `[FREE]` {S}[S45] `[?]`.
- **Personal tier list**, and personalized counters and tier lists `[PREMIUM]` (U.GG PLUS) {P}[S2][S3].
- **Multisearch** (paste the lobby, get each player's stats) `[FREE]` {P}[S5].

#### C. Pre-game & loading screen (player lookup)
- **Live game lookup** from a profile `[FREE]` {C}[S6][S11]:
  - GraphQL `LiveGameExists` drives a live badge on the profile;
  - `GetLiveGame` returns `gameType`, `queueId`, `gameLengthSeconds`, and `teamA`/`teamB` participants with `championId`, Riot ID, `summonerIconId`, `summonerSpellA/B`, `currentRole`, and `championStats{kills,deaths,assists}` (the player's KDA on that champion).
- **"Live Games"** nav entry exists {P}[S5]. Its content (e.g. a directory of live games of notable players) was not verified `[?]`.

#### D. In-game
- No web in-game view beyond the live-game page. Overlays live in the desktop app.

#### E. Post-game & match analysis
Each match summary (`FetchMatchSummaries`) includes `[FREE]` {C}[S6][S10]:
- `kills`/`deaths`/`assists`, `cs`, `jungleCs`, `killParticipation`, `damage`, `gold`, `level`, `maximumKillStreak`, `visionScore`
- `items`, `runes`, `primaryStyle`, `subStyle`, `summonerSpells`, `augments` (Arena)
- **`roleQuestCompletion`, `roleBoundItem`** (2026 role quests)
- `queueType`, `role`, `version`, `matchDuration`, `matchCreationTime`, `win`
- **Performance Score split into `psHardCarry` and `psTeamPlay`**, also given for all 10 players via `teamA`/`teamB` `hardCarry` and `teamplay`
- Arena `placement` and `playerSubteamId`
- **LP change per game**: `lpInfo{lp, placement, promoProgress, promoTarget, promotedTo{tier,rank}}`
- **LP snapshots**: `getSummonerRankSnapshots{insertedAt, losses, lp, promoProgress, queueId, rank, tier, wins}`

Expanded match detail (per-player build and skill order, team graphs) `[?]` {K}.

#### F. Profile, match history & progression
- **Profile header**: icon, level, Riot ID, `memberStatus`, `premium` flag, `lastModified` `[FREE]` {C}[S6].
- **Ranked cards** per queue/role/season: `tier`, `rank`, `lp`, `wins`, `losses`, `promoProgress` `[FREE]` {C}[S6].
- **Ladder rank**: `overallRanking` and `totalPlayerCount`, which together give a percentile `[FREE]` {C}[S6][S10].
- **Season history**: `getHistoricRanks` gives `lp`, `queueId`, `rank`, `regionId`, `season`, `tier` `[FREE]` {C}[S6].
- **Champion Stats tab** (`getPlayerStats` → `basicChampionPerformances`), per queue, role and season `[FREE]` {C}[S6][S12]:
  - `totalMatches`, `wins`, `kills`, `deaths`, `assists`, `cs`, `damage`, `damageTaken`, `gold`
  - `doubleKills`, `tripleKills`, `quadraKills`, `pentaKills`, `maxKills`, `maxDeaths`
  - **`lpAvg`** (average LP per game on the champion)
  - `firstPlace` and `totalPlacement` (Arena)
- **Match-history filters**: champion, queue (e.g. 420/440), role (1=Jungle, 2=Support, 3=ADC, 4=Top, 5=Mid, 7=All), seasons (e.g. `[26,25]`), and a **"played with" duo filter** (`duoRiotUserName`/`duoRiotTagLine`). Pagination is 1-based and loads more near the bottom of the page. `[FREE]` {C}[S6]
- **Update button** (`UpdatePlayerProfile`) `[FREE]` {C}[S6].
- **Profile customization** `[PREMIUM]` {C}[S6]{P}[S2][S4]: `customizationData{headerBg, twitchName, twitterName, youtubeName}`, "custom profile features", **golden flair**, **name highlight**, and linking YouTube/Twitch to gain followers.

#### G. Champion data (build page, patch 16.6 snapshot) {P}[S5]
- **Tabs**: Build · Arena · ARAM · Counters · Leaderboards · Pro Builds · More Stats.
- **Header**: Tier (e.g. "D") · Win Rate 49.54% · **Rank 40/54** (within role) · Pick Rate 8.3% · Ban Rate 18.9% · Matches 24,594 `[FREE]`.
- **Filter bar**: build type ("Rec." dropdown), role, rank ("Emerald +"), "More…" (region, patch, queue) `[FREE]`.
- **Build archetypes**: Recommended (`overview`), On-Hit, Crit, Lethality, AD, AP, Tank. Each is a separate data file (`onhit-overview`, `crit-overview`, …) `[FREE]` {P}[S5]{C}[S7].
- **Runes**: primary tree, secondary tree and stat shards, with WR and matches (e.g. "51.77% WR (2,092 Matches)") `[FREE]`.
- **Summoner spells** with WR and matches `[FREE]`.
- **Skill Priority** (max order, e.g. Q>E>W) with WR and matches, plus **Skill Path** (most popular levelling order, levels 1–18) `[FREE]`.
- **Items** `[FREE]`:
  - Starting Items with WR and matches ("Best for most matchups");
  - Core Items (3, boots included) with WR and matches;
  - Fourth, Fifth and Sixth Item Options (2–3 options each, each with WR and matches, "Options after core build").
- **Role Quest panel (2026)** `[FREE]`: Total Points 1350; point sources Kills 25, Minions 1, Plates 20, Towers 25, Epic Monsters 30; "Points acquired are doubled in the mid lane"; average **quest completion goal: 12:46**; rewards (tier-3 boot upgrade, empowered 4-second recall).
- **Counters tab**: see B.
- **Leaderboards tab** (best players on the champion) `[FREE]`.
- **Pro Builds tab** `[FREE]`.
- **More Stats tab** `[?]`. It is backed by U.GG data families named `combat` and `objectives` {C}[S8].
- **Items section** (`/lol/items`) `[FREE]` {P}.
- **Tier list** (`/lol/tier-list`) `[FREE]`:
  - methodology: "an algorithm which takes **win rate, pick rate, and weighted ban rate** into account… a champion's efficacy in [role] is factored in" {P}[S1];
  - the per-champion-role `rankings` data also carries `stdevs`, `effective_winrate`, `distribution_mean`, `distribution_stdevs`, `distribution_count`, `real_matches`, `total_matches`, `bans` and `be_all_picks`. This suggests tiers are **standard-deviation bands of an "effective win rate"** relative to the role distribution {C}[S8];
  - the same object carries `roleWins`, `roleMatches`, `rank`, `total_rank`, `avg_damage`, `avg_gold`, `avg_kda`, `avg_cs`, `win_rate`, `pick_rate`, `ban_rate` and top `counters` {C}[S8];
  - columns (Rank, Role, Champion, Tier, WR, PR, BR, counter picks, Matches) `[?]` {K}.
- **Filters** (champion and tier pages) {C}[S7]{P}[S5]:
  - Rank: Challenger, Grandmaster, Master, Master+, Diamond, Diamond 2+, Diamond+, Emerald, **Emerald+ (default)**, Platinum, Platinum+, Gold, Silver, Bronze, Iron, All ("Overall").
  - Region: World, NA1, EUW1, EUN1, KR, BR1, LA1, LA2, OC1, RU, TR1, JP1, PH2, SG2, TH2, TW2, VN2, ME1.
  - Role: Top, Jungle, Mid, ADC, Support.
  - Patch: current and older patches (patch is part of the data URL).
  - Queue/mode: `ranked_solo_5x5`, `normal_aram`, `arena`, `urf` (ARURF), `pick_urf`, `one_for_all`, `nexus_blitz`, plus the ARAM Mayhem pages (2026).

#### H. Game modes
- **ARAM** champion pages and ARAM tier list `[FREE]` {P}[S5][S54].
- **ARAM Mayhem** tier list (NEW, 2026) `[FREE]` {P}[S5].
- **Arena** builds `[FREE]` {C}[S7]:
  - `augments` with `wins` and `matches`;
  - `prismatic_items`, `consumables`, `starting_items`, `core_items`, `item_4/5/6_options`;
  - **`champion_synergies`** (`top_four`, `first`, `picked`, `sum_of_placements`), which gives top-4 rate, first-place rate and average placement;
  - a `low_sample_size` flag.
- **URF/ARURF, One for All, Nexus Blitz** champion rankings (`champion_ranking/world/{patch}/{mode}`) `[FREE]` {C}[S8].

#### I. Social, multi-search, leaderboards, pro/esports
- Multisearch · ladder Leaderboards · champion leaderboards `[FREE]` {P}[S5].
- **Probuild Stats** (probuildstats.com, see §1.10) `[FREE]` {P}.

#### J. Media
- **Watch** (NEW) section `[?]`. It exists {P}[S5]; its content (VOD, streams or clips) was not verified.
- **News** (patch notes and articles) `[FREE]` {P}.

#### K. Settings, UX, platform, monetization
- **Free tier is ad-supported.**
- **U.GG PLUS** `[PREMIUM]` {P}[S2][S3]:
  - ad-free across website and app;
  - personalized champion insights, counters and tier lists;
  - profile customizations, golden flair, name highlight;
  - priority customer support;
  - "more perks added over time" (H2 2026 features planned);
  - price **$3.99/month or $29.88/year** ($2.49/month) {S}[S33][S45].
- English-only UI; no mobile app (acknowledged in the FAQ) {S}[S45].
- The API sits behind a Cloudflare challenge: cookieless GraphQL calls return 403 {C}[S6].
- **UX strengths:** clean build page with one clear "recommended" path, WR and matches on every choice, archetype tabs, lane @15 stats {P}{C}.
- **Complaints:** English only; no mobile app {S}[S45]; the recommended build can be thin on data early in a patch `[?]`.

---

### 1.2 OP.GG (op.gg)

**Identity.** Korean, founded 2012. It is the largest site: about 62–76M visits/month {S}[S33], with 24 languages {S}[S45].
- Multi-game: LoL, TFT, Valorant, PUBG, Overwatch and others {P}.
- Help Center at help.op.gg {P}.
- **Official MCP server** for AI agents (`https://mcp-api.op.gg/mcp`) {P}[S22].
- Mobile app on Android {P}[S25]; iOS `[?]`.
- Desktop app via Overwolf, with its own patch-notes page {P}[S25].

#### A. Client integration & automation
- Desktop app: rune/item import, overlay, game recording `[FREE]` {P}[S25]{S}[S45].
- Matches carry `is_recorded` and `record_info`, so games recorded by the app can be replayed on the web {C}[S24].
- **MCP server tools** `[FREE]` {P}[S22]:
  - `lol_get_champion_analysis`, `lol_get_champion_synergies`, `lol_get_lane_matchup_guide`
  - `lol_list_champion_details`, `lol_list_champion_leaderboard`, `lol_list_champions`, `lol_list_lane_meta_champions`
  - `lol_get_summoner_profile`, `lol_list_summoner_matches`, `lol_get_summoner_game_detail`
  - `lol_list_items`, `lol_list_discounted_skins`
  - `lol_get_pro_player_riot_id`, `lol_esports_list_schedules`, `lol_esports_list_team_standings`
  - TFT and Valorant tools
  - A `desired_output_fields` parameter selects which fields are returned.

#### B. Champion select / draft
- **Counters** (weak/strong against) per position `[FREE]` {P}{C}[S23].
- **Lane matchup guide** `[FREE]` {P}[S22].
- **Synergies** `[FREE]` {C}[S23].
- **Master/Expert builds** `[FREE]` {P}[S19]: builds used by top-ranked players in their recent matches, including items, skills and runes chosen *against specific champions*.
- Ban suggestions `[?]` {S}[S33].
- Multi-search `[FREE]` {C}[S50].

#### C. Pre-game & loading screen
- **Live Game** tab on the profile (`/summoners/{region}/{name}-{tag}/ingame`) `[FREE]` {C}[S41]{S}.
- **Spectate** (including live pro games) `[FREE]` {S}[S45]. Exact current UI `[?]`.

#### D. In-game
- Desktop overlay only (out of web scope) {S}.
- "OP.GG AI Voice" `[?]` {S}[S45].

#### E. Post-game & match analysis
- **OP Score** `[FREE]` {P}[S16][S17]{C}[S24]:
  - rated 0–10 per player per game from summoner stats (kills, deaths, assists, CS, gold, …);
  - `op_score_rank` gives the player's rank inside the game;
  - `is_opscore_max_in_team` drives the MVP/ACE-style highlight;
  - the help center says the score is still **"beta"** and may be inaccurate.
- **Timeline OP Score** `[FREE]` {P}[S17]{C}[S24]:
  - recomputed **every 5 minutes on Summoner's Rift and every 3 minutes in ARAM**; the final value is the official score;
  - fields `op_score_timeline[{second, score}]` and `op_score_timeline_analysis{left,right,last}`;
  - the curve's shape maps to **14 keywords**. API fixture labels are: Unstoppable*, Leader, Victor, Devoted, Late bloomer, Resilient, Average, Rollercoaster, Downfall, Struggle, Innocent*, Unlucky, Slow starter, Unyielding (* = `is_op`). The help center's examples "Tenacity" and "Indomitable Will" are localized variants.
- **Lane score** per player (`lane_score`) `[FREE]` {C}[S24].
- **Lobby average tier** (`average_tier_info`) `[FREE]` {C}[S24].
- **Per-player stats in the game model** `[FREE]` {C}[S24]:
  - champion level;
  - damage: self-mitigated, to objectives, to turrets, magic to champions, physical to champions, physical taken, total taken, total dealt, total to champions, largest critical strike;
  - time CCing others;
  - vision: vision score, control and sight wards bought, wards placed, wards killed;
  - objectives: turret kills, inhibitor (barrack) kills;
  - combat: K/D/A, largest multi-kill, largest killing spree;
  - farm: minion kills, neutral kills split into own-jungle and enemy-jungle;
  - gold earned, total heal, result.
- **Team stats** `[FREE]` {C}[S24]: win flag and bans; for each objective both the count and whether the team took it first: champion kills, inhibitors, Rift Herald, dragons, barons, towers, **horde (void grubs)**; gold and K/D/A.
- **Match detail page** `[FREE]` {P}[S18]:
  - **VOD replay** (when recorded) and overall match analysis;
  - per-player rune and item builds;
  - **movement paths during the first 5 minutes**;
  - **positional distribution on the map at 1-minute intervals**;
  - **timeline graphs comparing gold, XP and objectives** of both teams.
- `memo` field on a game (user notes) `[?]` {C}[S24].
- "AI tips summary (Beta)" `[?]` {S}[S45].

#### F. Profile, match history & progression
- **Header** `[FREE]`: icon, level, Riot ID, `updated_at`, and **update/renew with a cooldown** (`renewable_at`; the web uses `renewalStatus`/`renewal` server actions) {C}[S24][S46].
- **Ladder rank** `[?]` {K}.
- **Previous seasons**: badges per season with tier, division and LP (`previous_seasons`) `[FREE]` {C}[S24].
- **Ranked Solo & Flex cards** `[FREE]` {C}[S24]: tier, division, LP, W/L, series, plus flags `is_hot_streak`, `is_fresh_blood`, `is_veteran`, `is_inactive` (these come from Riot League-V4).
- **Most champions per season and game type** `[FREE]` {C}[S24]: `play`, `win`, `lose`, K/D/A, `minion_kill`, `neutral_minion_kill`, `gold_earned`, `damage_dealt_to_champions`, `damage_taken`, multi-kills, `vision_wards_bought_in_game`, **average `op_score`**, and `game_length_second` (for per-minute rates).
- Match list with up to 20 games per page, paged by `endedAt` cursor; filters by game type and champion `[FREE]` {C}[S46].
- Tabs: Summary · Champions · **Mastery** · **Live Game** `[FREE]` {S}.
- **LP-per-game graph** `[FREE]` {S}[S52].
- Recent-20 summary (W/L, KDA, KP, preferred positions) and "Recently played with" `[?]` {K}.
- **Personalized stats dashboard for a main account** ("My Page") and **upgraded favorites** `[PREMIUM]` {P}[S20].

#### G. Champion data
- **Tier list** (`/lol/champions`, by position) `[FREE]` {P}[S26]:
  - "OP Tier" marks the strongest champions {P}[S14];
  - the API's `tier_data{tier, rank, rank_prev, rank_prev_patch}` shows rank movement {C}[S23].
- **Tier calculation** {P}[S14]: data from **Platinum-and-above ranked games**; a proprietary algorithm using pick and ban rates, win rates, gold, experience, crowd control, KDA, damage taken and damage dealt.
- **RIP threshold** {P}[S15]: a position is shown only with a **pick rate ≥ 0.5%**. A champion under 0.5% in every position is an "RIP champion": greyscale portrait, no analysis.
- **Champion build data** per position and mode `[FREE]` {C}[S23]:
  - `summary.average_stats`: `play`, `win_rate`, `pick_rate`, `ban_rate`, `kda`, `tier`, `rank`, `role_rate`, `kills`/`deaths`/`assists` (plus `total_place`/`first_place` in Arena);
  - `positions[]` with stats and counters; `roles` (e.g. FIGHTER|SLAYER); `is_rotation`; `is_rip`;
  - `rune_pages` (primary+secondary bundles containing `builds` with `primary_rune_ids`, `secondary_rune_ids`, `stat_mod_ids`, `play`, `win`, `pick_rate`), `runes`, `summoner_spells`;
  - items: `starter_items`, `core_items`, `boots`, `last_items` (each with `ids`, `win`, `play`, `pick_rate`); legacy `mythic_items`;
  - skills: `skill_masteries` (max order), `skills` (level order), **`skill_evolves`** (evolving champions);
  - **`trends`**: `win`/`pick`/`ban` history plus `total_rank` and `total_position_rank`, with points `{version, rate, rank, created_at}`;
  - **`game_lengths`**: `{game_length, rate, average, rank}`, i.e. WR by game length;
  - `counters` `{champion_id, play, win}` and `synergies`;
  - Arena: `augment_group`, `prism_items`.
- **Champion statistics page** (`/lol/statistics/champions`: "win rates, pick rates & more", in-game data) `[FREE]` {P}[S26].
- **Champion leaderboard** (best players per champion) `[FREE]` {P}[S22].
- **Champion details** (abilities, tips, lore, base stats) `[FREE]` {P}[S22].
- **Filters** {C}[S23]:
  - Region: global, na, euw, kr, br, eune, jp, lan, las, oce, tr, ru, sg, id, ph, th, vn, tw, me.
  - Tier: all, ibsg (Iron–Gold), gold_plus, platinum_plus, emerald_plus, diamond_plus, master, master_plus, grandmaster, challenger.
  - Version (patch) and position.
  - Mode: ranked, aram, aram_mayhem, arena, nexus_blitz, urf.
  - Update cadence claimed "hourly" {S}[S33] `[?]`.

#### H. Game modes
- **ARAM** `[FREE]` {C}[S23]:
  - builds;
  - an **ARAM balance modifiers** table per champion: `damage_dealt`, `damage_taken`, `attack_speed`, `cooldown_reduction`, `healing`, `tenacity`, `shield_amount`, `energy_regen`, `area_of_effect_damage`.
- **ARAM Mayhem** `[FREE]` {C}[S23]: champion tiers (`/api/contents/tiers?type=aram_mayhem`) and per-champion **augment tiers** (`tier`, `performance`, `popular`).
- **Arena** `[FREE]` {C}[S23]: augments grouped by rarity with `win`, `play`, `pick_rate`, `total_place`, `first_place`; prismatic items; synergies with `op_rank`.
- **URF** and **Nexus Blitz** `[FREE]` {C}[S23].
- Other games: TFT, Valorant {P}[S22].

#### I. Social, multi-search, leaderboards, pro/esports
- Multi-search `[FREE]` {C}[S50].
- Ladder leaderboards `[?]` {K}; champion leaderboards `[FREE]` {P}.
- **Find DUO** (duo/clan/Clash recruitment posts) `[FREE]`. With the Ad-free plan, posts get a badge and highlight, and Clan/Clash posts can be bumped **daily instead of every 3 days** `[PREMIUM]` {P}[S20].
- **Esports** (esports.op.gg) `[FREE]` {P}[S21][S26]: schedules and results, standings, team/player rankings, **"OP Score Rankings"** for pros.
- Pro player → Riot ID lookup `[FREE]` {P}[S22].
- Discounted skins list `[FREE]` {P}[S22].
- Coaching marketplace `[?]` {S}[S45].

#### J. Media
- VOD replays of recorded games in match detail `[FREE]` {P}[S18].
- Spectate live games, including pros `[FREE]` {S}[S45] `[?]`.

#### K. Settings, UX, platform, monetization
- **Ads**, including criticized dark patterns (the "close" button redirected to the advertiser, documented Aug 2024) {S}[S45].
- **OP.GG Ad-free** `[PREMIUM]` {P}[S20]:
  - no ads in any OP.GG service or app;
  - personalized stats dashboard;
  - upgraded favorites;
  - Find DUO badge/highlight;
  - daily bump;
  - about **$3–3.99/month** {S}[S33][S45].
- 24 languages; Android app; Chrome extension (third-party "OP.GG Summoner Search") `[?]`.
- **Strengths:** breadth and speed, the default "look someone up" site, multi-search, esports hub, official MCP API.
- **Complaints:** aggressive ads {S}; OP Score still beta {P}; cluttered UI `[?]`.

---

### 1.3 Lolalytics (lolalytics.com)

**Identity.** Independent. It says it is "the only League of Legends stats site to analyse every champion from every ranked game" {P}[S28]. About 6.5M visits/month {S}[S33]; English only; **ads only, no premium** {S}[S45].
- Qwik front end with JSON embedded in the page.
- Internal "mega" API at `ax.`/`a1.lolalytics.com/mega/?ep=…`, with endpoints `champion`, `counter`, `rune`, `build-itemset`, `build-team`, `tier`, `list` {C}[S30][S33][S34][S35].
- The site says it "hope[s] in future to release a public API" {S}[S45].

#### A / C / D / J
- No client integration, no live game, no media features on the web.

#### B. Champion select / draft
- **Counters per enemy lane** `[FREE]` {C}[S30]{P}[S29]. Each row is `[championId, wr, d1, d2, pr, n]` (header `enemy_h: ["id","wr","d1","d2","pr","n"]`).
  - **Delta 1** = matchup WR − (100 − opponent's overall average WR).
  - **Delta 2** = matchup WR − *normalised* expected WR in the matchup.
  - Positive values mean the champion wins the matchup more than expected.
- **Synergy (team)** per ally lane `[FREE]`. It uses `d2`, the "normalized synergy delta (adjusted to 50% baseline WR)" {C}[S33][S30].
- **Matchup-specific build pages**: `/lol/{champ}/vs/{opponent}/build/?vslane={lane}` (API: `vs`, `vslane`) `[FREE]` {C}[S30].
- The header shows the top counters as `counters{strong[], weak[]}` `[FREE]` {C}[S30].
- A 100-game minimum for matchup listing is reported `[?]` {S}[S45].

#### E / F
- No player profiles and no match pages (not a profile site). Leaderboards: see I.

#### G. Champion data (`/lol/{champ}/build/?lane=&tier=&patch=&region=&queue=`)
- **Header** `[FREE]` {C}[S30]{P}[S29]:
  - `wr`, **`avgWr`** (average WR of the bracket), **`avgWrDelta`**, `pr`, `br`;
  - **tier grade** (S+…D with +/- steps, e.g. "A-"), **`rank`/`rankTotal`** (e.g. "ranked 33 of 110"), games `n`;
  - `defaultLane` and **lane distribution** (`nav.lanes` % for each of the 5 lanes);
  - **damage profile** `damage{physical, magic, true}`;
  - **best-player stats** `topWin`/`topElo`.
- **Build summary with two sets** `[FREE]` {C}[S30]{S}[S45]: "Most Common" (`pick`) and "Highest Win" (`win`). Each has:
  - runes: page (`pri`/`sec` trees) and set (`pri[]`, `sec[]`, `mod[]`) with `wr`, `n`;
  - summoner spells (`sums`);
  - skill priority and skill order;
  - starting set (`set`, `setUnique`, `count`), core (3 items), and item4/item5/item6 options, each with `wr` and `n`.
- **Full rune table**: every rune and shard with its stats (`runes.stats`) `[FREE]` {C}.
- **Skills** `[FREE]` {C}[S30]:
  - `skillEarly` (early levelling order);
  - **`skill6`/`skill10`/`skill15`** (which ranks are taken by levels 6/10/15);
  - `skillOrder` list with WR and games.
- **Items** `[FREE]` {C}[S30]:
  - `startSet`, `startItem`, `earlyItem`, `boots`, **`supportItem`**;
  - `popularItem`, `winningItem`, `item`;
  - **`item1`…`item5`** (stats per build slot);
  - item paths `itemSets.itemBootSet1/2/3` (boots bought 1st/2nd/3rd) and `builtBootSet3`.
  - Item completion timing `[?]` {K}.
- **Spells table** (`spells` rows with games, WR, …) `[FREE]` {C}.
- **Graphs** `[FREE]` {C}[S30]: daily series (`graph.dates`) of `wr`, `wrs` (smoothed WR), `pr`, `br`, `n`. **Each series is split by elo**: all, diamond_plus, emerald, platinum, gold, silver, bronze, iron. That gives WR by rank bracket over time.
- **Sidebar** `[FREE]` {C}[S30]:
  - `topList` (best players);
  - `topStats{toppick, toprank, topcount, topwin, topelo}`;
  - `depth`;
  - a general `stats` table with `count`;
  - **`time`/`timeWin`** (game-length distribution and **WR by game length**);
  - **`objective`** (win/lose splits for objectives; exact objectives `[?]`).
- **Tier list** (`/lol/tierlist/`) `[FREE]` {P}[S28]:
  - **methodology**: tier rank is "based upon champion win rate, PBI index, best on champion win rate and best on champion average elo". The "best players" are Diamond+ with ≥50 games on the champion over the last 90 days;
  - **PBI** (Pick Ban Influence) = (win − AvgWinOfTier) × 100 × pick / (100 − ban);
  - **"Win rate delta"** = WR using *individual player tiers* (Lolalytics' method) − WR using *game-averaged tier* (the "simpler method used by some other websites");
  - the tier-list payload also carries **"last days" trend values** (rank, WR and games over recent days, by lane) {C}[S32].
- **Filters** {C}[S30][S33]{P}[S28]:
  - Lane: top, jungle, middle, bottom, support.
  - Tier values seen: `emerald_plus` (default), `diamond_plus`, `platinum_plus`, `gold_plus`, `gold`, `emerald`, `all`, **`1trick`**. More brackets (Challenger, GM+, Master+, D2+, Silver, Bronze, Iron…) `[?]`.
  - Patch: a specific patch such as 16.19, **or a rolling window** (`patch=30` = last 30 days; 7/14-day options `[?]`).
  - Region: `all` or a single region.
  - Queue: `420` (ranked solo), ARAM, Arena; flex/normal `[?]`.

#### H. Game modes
- **ARAM** champion pages (`/lol/{c}/aram/build/`) with tier and rank (e.g. "ranked 60 of 173, B+") `[FREE]` {P}[S29].
- **Arena** champion pages (`/lol/{c}/arena/build/`) and an Arena tier list `[FREE]` {P}[S28][S29]. The Arena header carries **`place1`…`place8`** (placement distribution) and team (duo) synergy rows {C}[S31].

#### I. Leaderboards
- Leaderboards across 14 regions, including per-champion "best players" (feeds the 1-trick tier) `[FREE]` {S}[S45]{P}[S28].
- "Patch Notes Champions Performance" page `[?]` {S}[S45].

#### K. Monetization & UX
- **Ads only** {S}.
- **Strengths:** the most granular transparency (games on every row), normalized matchup deltas, per-player tier brackets, rolling windows, matchup-specific builds {P}{C}.
- **Complaints:** documented "asymmetric sampling" critique (inflated perceived WRs) and declining popularity {S}[S45]; dense, expert-oriented UI `[?]`.

---

### 1.4 League of Graphs (leagueofgraphs.com)

**Identity.** Part of the **M.O.B.A. Network** (MOBAFire, League of Graphs, **Porofessor**, Counterstats, WildriftFire, RuneterraFire, …) per the page footer {P}[S36]. Founder Jean-Nicolas Mastin; the network announced a listing suspension effective 2026-01-01 {S}[S45]. © 2013–2026.
- 20 UI languages (CS, DE, EL, EN, ES, FR, HU, IT, JA, KO, NL, PL, PT, RO, RU, TH, TR, UA, VN, ZH) {P}[S36].
- LoL and TFT sections, an Android app, dark-mode toggle, and banners promoting the Porofessor in-game app {P}[S36].

**Full site map (from the saved page, patch 16.17) {P}[S36]:**
- **Champions:** Tier List · Champions stats · Pro Builds · Full Builds · Matchups · Runes · Skill Orders · Items · Summoner Spells · **Jungle Paths** · **Arena Augments** · More… (other-stats).
- **Rankings:** Best Players · **Rank distribution** · **Records** · **Mastery Points** · **Challenges**.
- **Stats (game-wide):** **Blue vs. Red** · **Drake stats** · **Win Stats** · **Surrender stats** · **AFK stats** · **Game Durations** · **Warding** · **Flash: D vs F** · **Pings**.
- **Arena:** **Trios** · Highest winrate champions · Popular Augments.
- **Infographics.**
- **Replays:** All Replays · With PentaKills · With High KDA · With Pros · Twitch Replays (filterable by champion, rank and queue).

#### G. Champion data (Stats tab, Mel, patch 16.17) {P}[S36]
- **Champion tabs**: Overview · Stats · Pro Builds · Full Builds · Matchups · Runes · Skills · Items · Summoner Spells.
- **Headline** `[FREE]`: Popularity 8.5% · Winrate 46.2% · Ban Rate 28.7% · **Mained by 0.8%** (share of players who main it).
- **History charts since release** (Apr 2025 → Jul 2026): Popularity History, Winrate History, Ban Rate History `[FREE]`.
- **Roles table** (popularity and winrate for each role) and **Release date** `[FREE]`.
- **Damage dealt split**: Physical / Magic / True `[FREE]`.
- **Per-game averages** `[FREE]`: Average KDA (8.9 / 7.1 / 6.3); **Pentakills / Quadrakills / Triplekills / Doublekills per match**; Gold/min; CS/min; **Wards placed/min**; Damage/min.
- **Curves against game duration**: Gold, Minions, Kills+Assists, Deaths `[FREE]`.
- **Winrate / Game Duration** `[FREE]`.
- **Winrate / Ranked Games Played** (a 0–80 games experience curve) `[FREE]`.
- **Winrate / (Kills − Deaths) @10 min** and **@20 min** `[FREE]`.
- **Best {champion} players** (rank, region, per-champion rank #, WR, games) `[FREE]`.
- **Mastery points ranking** `[FREE]`.
- **Positions heatmaps: Kills and Deaths** (where the champion gets kills or dies) `[FREE]`.
- **Sample banner**: "174,864 matches (Last 2 days)"; sitewide "3,175,163 matches (Last 2 days)" `[FREE]`.
- **Filters** `[FREE]`:
  - Role: All, Top, Jungler, Mid, AD Carry, Support.
  - Rank: Iron+, Bronze+, Silver+, Gold+, **Platinum+ (default)**, Emerald+, Diamond+, Master+.
  - Region: All, BR, EUNE, EUW, JP, KR, LAN, LAS, ME, NA, OCE, RU, SEA, TR, TW, VN.
  - Queue: Normal & Ranked, **Ranked games only**, ARAM, Arena.
- Other champion views `[FREE]` {P}[S36]: Pro Builds; Full Builds (full item build orders); Matchups; Runes; Skill Orders; Items; Summoner Spells; **Jungle Paths**; **Arena Augments** per champion.

#### F. Profile (`/summoner/{region}/{name}-{tag}`)
- Current rank, LP, W/L, win rate per queue (Solo/Flex) `[FREE]` {C}[S37].
- **"Personal Ratings"** block `[FREE]` {C}[S37].
- **Past ranks per season/split** `[FREE]` {C}[S37].
- Roles, champions and "records" blocks `[FREE]` {C}[S37] (named in scraper code).
- Tags/badges, "recently played with", LP graph, match history `[?]` {K}.

#### C / D
- Live game goes through Porofessor (linked from LoG) `[FREE]` {P}[S36].

#### H. Game modes
- ARAM and Arena queues on champion stats `[FREE]`.
- Arena: **Trios**, best champions, popular augments, champion augments `[FREE]` {P}[S36].
- TFT section `[FREE]` {P}.

#### I. Social / leaderboards
- Best players per champion, rank distribution, records, mastery points, challenges `[FREE]` {P}[S36].
- Game-wide meta stats pages (listed above) `[FREE]`.

#### J. Media
- **Replays library** (pentakills, high KDA, pros, Twitch) `[FREE]` {P}[S36]; community replays {S}[S45].

#### K. Monetization & UX
- Ads (the M.O.B.A. Network shares many ad partners) {S}[S45].
- **Strengths:** unmatched breadth of "fun" and analytical graphs (experience curve, K−D@10/@20, heatmaps, game-wide stats), explicit sample sizes, 20 languages.
- **Complaints:** dated design `[?]`; corporate instability of the network {S}.

---

### 1.5 DPM.lol (dpm.lol)

**Identity.** Launched June 2024 and took off after Caedrel featured it in July 2024 {S}[S40]. Co-owned by Kameto (Karmine Corp) {S}[S45].
- Reach: "2 million monthly users", 30M page views/month, 18 languages {S}[S45][S39].
- ToS forbids scraping {S}[S45]; Cloudflare-challenged {C}.
- Self-described as "the biggest database for champion pro builds, tierlists and leaderboards" {P}[S39].
- **Routes {C}[S41][S50]:**
  - profiles: `/{gameName}-{tagLine}`, `/{name}-{tag}/live`, `/{name}-{tag}/lens`
  - champions: `/champions/{Champ}/build`, `/champions/{Champ}/build/pro`, `/champions/{Champ}/matchups`
  - tier lists: `/tierlist`, `/tierlist/aram`, `/tierlist/arena`
  - leaderboards: `/leaderboards/otps/{Champ}`
  - esports: `/pro/{player}`, `/esport/soloq[/{league}[/leaderboard]]`, `/esport/leagues/{league}/{year}/{split}/matches`, `/esport/players/{player}/{year}/{LEAGUE}/{split}`
  - data: `/studio/...`, `/changelog`, `/premium`, `/app`
  - API: `/v1/search?gameName=`, `/v1/esport/schedule?league=&year=&split=`

#### A. Client integration & automation
- **Login with Riot** (RSO, since Jan 2025), which unlocks personal features `[FREE]` {P}[S38].
- **DPM Desktop App** `[FREE → ?]` {P}[S38]{S}[S45]:
  - launched late Sept 2026; "Draft Helper. Overlays. Replays. Native. No ads. No Overwolf.";
  - free for everyone until Sat Oct 3 (paid after that `[?]`);
  - v1.6.0: new champ-select designs, post-game advanced stats, skin collection, clips gallery, 7 new languages;
  - v1.9.0 (2026-09-24): Howling Abyss overlays, health-relic timers on the minimap, ARAM Mayhem augment tier cards;
  - desktop beta had been limited to 6-month/1-year Premium members.

#### B. Champion select / draft
- **Laning Phase Matchups** in champion builds ("how every matchup plays out in lane") `[FREE]` {P}[S38].
- `/matchups` page `[FREE]` {C}[S41].
- "30,000+ matchup videos" {S}[S45] `[?]`.
- Draft Helper (desktop) {P}; "IA draft assistant" {S}.

#### C. Pre-game & loading screen
- **Live Game** (`/{name}-{tag}/live`): "Know your teammates. Know your opponents. Real-time insights on every player in your match" `[FREE]` {P}[S38].

#### D. In-game
- The web live page works as a second screen `[FREE]`. Overlays are in the desktop app {P}.

#### E. Post-game & match analysis
- **DPM Score** per game. Clicking it opens "detailed insights based on **dozens of variables**… where you performed best and where you can improve" `[FREE]` {P}[S38].
- **Vote & Ratings**: predict game results, **rate players after each match**, see the community's opinion `[FREE]` {P}[S38].
- Post-game advanced stats (desktop) {P}.

#### F. Profile, match history & progression
- Profile with match history, champion stats and DPM Score `[FREE]` {P}{K}.
- **DPM Lens** (`/lens`): mechanics-oriented stats such as **"skillshots dodged/min"** `[FREE]` {P}[S38][S39].
- **Peak ELO in real time** `[FREE]` {S}[S45].
- **Unified search** that also matches pro players, with team logos `[FREE]` {C}[S41].
- **Exclusive profile badges** and **profile customization** `[PREMIUM]` {P}[S38][S39].
- "Friend-related features" planned `[?]` {P}.

#### G. Champion data
- **Build page**: runes, item plans, **skill max order**, summoner spells. Pro builds are listed next to ranked/community builds; builds are "updated in real time" `[FREE]` {S}{P}[S39].
- **Pro Builds** (`/build/pro`) `[FREE]` {C}.
- **Tier lists**: ranked, ARAM and Arena, "using live ranked and pro data" `[FREE]` {P}[S39].
- **DPM Data Studio** (`/studio`): "The Largest League of Legends Stats Hub. Every champion, every rank, every region"; "hundreds of stats"; e.g. `/studio/skillshots/champion` `[FREE]` {P}[S38][S39].
- **Patch-change charts** ("Patch 16.10 changes") and patch previews `[FREE]` {P}[S38].
- Trivia stats (e.g. the top-3 most used profile icons by champion) `[FREE]` {P}[S38].
- Rank and region filters and methodology `[?]` (not verified).

#### H. Game modes
- ARAM leaderboards, tier lists and builds (Nov 2024); Arena tier list `[FREE]` {P}[S38][S39].
- ARAM Mayhem augment tiers (desktop overlay); augment recommendations for Mayhem and Arena planned {S}[S39].

#### I. Social, multi-search, leaderboards, pro/esports
- **OTP leaderboards per champion**: at least 10 games on the champion, ordered by SoloQ rank `[FREE]` {P}[S39].
- **Custom leaderboards**: "create your own leaderboards, with your friends or with pro players, or even create your own competitive challenge" `[FREE]` {P}[S38].
- **Pro SoloQ rankings** by league (LCK, LEC, LPL, LCS…), team and player SoloQ leaderboards `[FREE]` {P}[S39].
- **Pro player pages** (`/pro/{name}`: Pro Stats, SoloQ, Esports) `[FREE]` {P}[S39].
- **Esports**: schedule/results per league/year/split; player split pages with champion stats (games, WR, KDA, KP), stat cards (e.g. VISION SCORE) and "performances" `[FREE]` {C}[S41].
- **Pick'Ems** (predict tournament winners, MVPs, top killers, most unique champions) `[FREE]` {S}.
- **Hall of Fame** listing every Premium member `[PREMIUM]` {P}[S39].
- "RFT", a separate esports website, was planned for 2026 {P}.

#### J. Media
- Desktop: game recorder, **replays**, **clips gallery**, "DPM Cloud" link sharing {P}{S}. None of this is on the website itself.

#### K. Settings, UX, platform, monetization
- **DPM Premium** (live May 2025) `[PREMIUM]` {P}[S38]{S}[S45]:
  - "new features, in-depth data, and the best way to support the project";
  - exclusive badges, profile customization, Hall of Fame, early desktop access;
  - **3.99 €/month, 19.99 €/6 months, 35.99 €/year**;
  - a second premium level for app features {P}[S38].
- Ads on the free web tier `[?]`.
- **Strengths:** modern UI, creator-driven growth, pro/SoloQ angle, community features (ratings, custom leaderboards, pick'ems), native ad-free app.
- **Complaints:** anti-scraping ToS {S}; TFT support not before 2027 {S}.

---

### 1.6 Mobalytics (mobalytics.gg)

**Identity.** Founded 2016 {K}; acquired by ESL FACEIT Group (March 2025) {S}[S33][S45]; 17 languages (community-translated) {S}.
- Multi-game "Multigame Profile" (LoL, TFT, Valorant, Deadlock, NGF docs) {C}[S43].
- GraphQL endpoints: `mobalytics.gg/api/lol/graphql/v1/query` and a static `/api/league/gql/static/v1` {C}[S43].

#### A. Client integration & automation
- Desktop app on Overwolf: Live Companion overlay, rune import `[FREE]` {S}[S33][S45] (out of web scope).

#### B. Champion select / draft
- **Counters** `[FREE]` {C}[S43]:
  - best/worst picks with `matchupSlug`, `matchupRole`, `wins`/`looses`, **`matchupDelta`**;
  - sortable (`sortField`, `order`, `skip`, `top`);
  - per-matchup tips and **counter video**;
  - **when a Riot ID is supplied, "player vs champion stats"**: the user's own record against that champion.
- **Matchups** (lane-by-lane WR with sample) `[FREE]` {S}[S43].
- **Synergies** (duo partners with `winRate`) `[FREE]` {C}[S43].

#### E. Post-game & match analysis
- **Match details** `[FREE]` {C}[S44]: `seasonId`, `queue`, `startedAt`, `duration`, `patch`; **`avgTier` per team**; participants (`championId`, `championLevel`, `team`, `role`).
- **Match history** with `lp{lpDiff}` per game `[FREE]` {C}[S44].
- GPI-based post-game analysis `[?]` {S}.

#### F. Profile, match history & progression (`/lol/profile/{region}/{name}-{tag}/overview`)
- **GPI – Gamer Performance Index** `[FREE]` {P}[S42]:
  - machine-learning scores (0–100) in **8 areas: Aggression, Consistency, Farming, Fighting, Survivability, Teamplay, Versatility, Vision**;
  - these define playstyle, strengths and weaknesses;
  - shown as a GPI graph on the profile.
- **Recommended runes and items "based on your play style and success"** over a shown patch range `[FREE]` {P}[S42].
- **Queue stats** (`virtualQueue`, rank, `lp`, wins, losses, winrate, gamesCount) `[FREE]` {C}[S44].
- **Role stats** (wins/losses per role) `[FREE]` {C}[S44].
- **Champion stats** (`kda`, `csm`, `damagePerMinute`, `gpm`, `cs`, `wards`, `lp`, wins/losses) `[FREE]` {C}[S44].
- **LP gains history** (`LolProfilePageLpGainsQuery`, 150 entries per page, paged) `[FREE]` {C}[S44].
- **Refresh with progress** (`LolSummonerUpdateSubscription` → current/total) `[FREE]` {C}[S44].
- **Multigame profile (MGP)** `[FREE/PREMIUM?]` {C}[S43]{P}[S42]: avatar, frames, plate, cover, title, cursor icon, theme, app icon, bio; **Reward Pass** with a premium track at $9.99.

#### G. Champion data (`/lol/champions/{slug}/{build|counters|matchups|runes|combos|guides|aram-builds|arena-builds}`) {C}[S43]
- **Tier (S+…D)**, `totalMatchCount`, and **per-patch history** of WR/PR/BR (`winRateHistory`, `pickRateHistory`, `banRateHistory`) `[FREE]`.
- **Builds** `[FREE]`:
  - multiple variants;
  - items per slot with **`timeToTarget`** (timing);
  - `skillOrder`, `skillMaxOrder`, `spells`, runes (`style`, `subStyle`, perk `IDs`);
  - `wins`/`matchCount` per build.
- **Power spikes** (early/mid/late) `[FREE]` {S}[S43].
- **Combos**: description, execution text, notes, **video**, tags, key sequence, difficulty `[FREE]`.
- **Guides**: UGC and wiki documents with author, tags, favorites, "featured", embedded tier lists and build variants `[FREE]`.
- **Tier list**: tiers per role and **"skillLevel" (low-elo vs high-elo)** `[FREE]`; exact columns `[?]`.
- **Filters**: role (TOP/JUNGLE/MID/ADC/SUPPORT); rank (e.g. EMERALD_PLUS; tier list low/high elo); patch (`patch_26_10`); queue (RANKED_SOLO); region (ALL or a single region).

#### H. Game modes
- ARAM builds and Arena builds (augments, duos) `[FREE]` {C}[S43]; TFT and other games {P}.

#### I. Social
- **Referral program** with a leaderboard and an RP raffle `[FREE]` {C}[S43].
- "Challenges" `[?]` {S}[S45].
- Esports hub `[?]` {S}[S52].

#### J. Media
- Combo and counter videos `[FREE]` {C}.
- "Smart Highlights" (desktop) {S}[S45].

#### K. Monetization & UX
- **Mobalytics Plus**: **$7.99/month or $69.99/year** {S}[S33][S45]. Plus is "account-overlay only and does not gate champion-page data" {C}[S43].
- **Reward Pass** premium track: $9.99 {P}[S42].
- **Strengths:** coaching framing (GPI, playstyle), combos/guides, personal matchup record.
- **Complaints:** heavy desktop resource use (Overwolf) {S}[S33]; mandatory arbitration clause {S}[S45].

---

### 1.7 METAsrc (metasrc.com)

**Identity.** Based in Boulder, CO; free with ads; about 18–19 languages; multi-game {S}[S45]. No public API; its FAQ page answered one bot with HTTP 402 {C}[S34].

- **G. Champion data:**
  - Champion build pages ("Builds, Stats, and Tier Lists") with core items and 4th/5th/6th-slot items `[FREE]` {P}[S48]{C}[S48];
  - runes, skill order, spells, starting items and counters on build pages `[?]` {K};
  - tier list **S+ → D** `[FREE]` {S}[S45];
  - columns Score/Trend/Win%/Role%/Pick%/Ban%/KDA `[?]` {K};
  - filters for region, rank, role and patch `[?]` {K}.
- **B. Champion select / draft:**
  - **Counter Picker**: takes the full draft (bans, ally picks, enemy picks) and returns filtered champion suggestions using live WR, counter and synergy data, updated each patch `[FREE]` {S}[S33];
  - "live champion counter" (343.5K processed) {S}[S45];
  - **Duos** `[FREE]` {S}[S45].
- **H. Game modes:** ARAM, **ARAM Mayhem**, Arena ("Patch 26.19" pages) `[FREE]` {P}[S48]{C}[S48]; URF, One for All, Nexus Blitz `[?]` {K}.
- **Other:** **"League Classic"**, a restoration of Season 3 / patch 3.13 data `[FREE]` {S}[S45].
- **K. UX:** "flat data presentation; no per-champion breakdown depth; no user configuration" {S}[S33].

---

### 1.8 Deeplol (deeplol.gg)

**Identity.** GameEye Corp (Korea). Korean-first, KR default platform {C}[S46]; mobile site `m.deeplol.gg` {C}.
- Proprietary **"AI Score"** and tier prediction {S}[S45].
- B2B contracts with pro teams (5 confirmed: AR, BR, JP, KR, US) {S}[S45].
- Its main X account was suspended on 2026-07-17 {S}.
- Public JSON API at `b2c-api-cdn.deeplol.gg` {C}[S46].

#### C / D
- **Live game** (`/summoner/{region}/{name}-{tag}/ingame`; API `ingame/summoner-cached`) `[FREE]` {C}[S41][S46].

#### F. Profile `[FREE]` {C}[S46]
- Basic info: PUUID, level, profile icon, Riot ID.
- **Pro/streamer tagging** (`pro_streamer_info_dict`): team, status, and links to **Twitch, YouTube, AfreecaTV, Chzzk, Kick, X/Twitter, Leaguepedia**.
- **Previous season tiers**.
- Realtime solo/flex rank (tier, division, LP, W/L, **ladder `ranking` and `ranking_rate` percentile**, mini-series).
- **Challenges** (`title_id`, `challenge_list` with percentile, level, value).
- **Tier chart** (rank history).
- **Champion stats** per season, including **`ai_score`** and **`stats_by_enemy`** (per-opponent breakdown).
- Match list (20 per page, filterable) and match detail (`match-cached`).
- **Refresh**: check availability first; **45-second official cooldown**.
- Pro/streamer directory (`strm_pro_info`: all accounts of a pro, `last_game_date`).

#### G. Champion data (`/champion/build?platform_id=&champion_id=&game_version=&tier=Emerald+`) `[FREE]` {C}[S46]
- `build_by_lane` → `champion_tier`, `rank`, `win_rate`, `pick_rate`, `ban_rate`, `games`.
- **Multiple build variants** (`build_lst`), each with `win_rate`, `pick_rate`, `games`:
  - rune `main_build`/`sub_build`;
  - `item.build` (core) and **`item.detail` (full chronological purchase order, with prices)**;
  - spells, `start_item`, `boots`;
  - `skill.build` (max priority) and `skill.detail` (15-level order).
- `match_up`: `strong_against` / `weak_against` (`enemy_champion_id`, `win_rate`, `games`, **`match_rate`**) and `synergy_champion`.
- An "Aram" lane key exists.

#### K. Monetization
- Ad-tech seen: Venatus, IntentIQ, Microsoft Clarity, Google Analytics, Lotame {C}[S46].

---

### 1.9 League of Items (leagueofitems.com)

**Identity.** "Like U.GG but for items and runes." All data is **scraped from U.GG, Plat+ all regions, updated every 4 hours**. Open-source front end {P}[S47].

- **G. Item pages** `[FREE]`:
  - item description;
  - **Highest pickrate champions** and **Highest winrate champions** for the item;
  - **"Champion stats by order"**: WR and games when the item is the 1st…5th item, with a toggle to compare against the previous patch.
- **G. Item tier list** `[FREE]`: columns Item · Winrate · **WR increase** · Pickrate · **PR increase** · Champions · Matches.
- **G. Rune pages and rune tier list** `[FREE]`.
- **G. Champion pages** ("more data than U.GG": shows good but rarely built items) `[FREE]`.
- **G. Builds explorer** `[FREE]`: filter by champion, item or rune; toggles for keystones, small runes and build paths; favourites only; **"only 500+ matches"**.
- **K. Home page:** patch overview/"rundown" with **patch-note changes** (buffs/nerfs), popular items, favourites, random page, dark theme `[FREE]`.
- **FAQ methodology** {P}[S47]:
  - item WRs are inflated because winning teams buy more items; late items (e.g. Guardian Angel, Warmog's) show higher WR; some items are built only when ahead (Mejai's);
  - "pickrate" = matches with the item ÷ all matches, so it **can exceed 100%**.

---

### 1.10 Probuildstats (probuildstats.com)

**Identity.** Owned by U.GG (Outplayed). About 1.9M visits/month {S}[S33]; linked in U.GG's nav {P}[S5].

- **G/I.** Feed of pro players' recent SoloQ games: pro name/team, champion vs opponent, KDA, items in purchase order, runes, spells, skill order, W/L, time ago `[?]` {K}.
- **G/I.** Filters by champion, role, region/league, player and team `[?]` {K}.
- **G/I.** Pro player pages `[?]` {K}.
- **G/I.** The same data powers U.GG's "Pro Builds" tab {P}.
- **K.** Ad-supported `[?]`.

---

### 1.11 Tracker.gg — League of Legends (tracker.gg/lol)

- **F.** Profile at `/lol/profile/riot/{name}#{tag}/overview?playlist=RANKED_SOLO_5x5` `[FREE]` {P}[S49].
- **F.** Stats come as segments per playlist: tier (rank name, `leaguePoints`, icon), wins, losses, `wlPercentage`, `kda`, **`peakTier`** `[FREE]` {C}[S49].
- **F.** Champion stats and match history `[?]` {K}.
- **K.** The Tracker Network public API **excludes LoL** {S}[S45]. Cross-game premium ad removal `[?]` {K}.

---

### 1.12 Other notable sites (brief)

- **Porofessor.gg (web)**:
  - live-game pages `/live/{region}/{name}-{tag}` plus a `/ranked-only` variant {C}[S41][S50];
  - "best-in-class opponent scouting": rank history, champion pool and recent match data for all 9 other players {S}[S33];
  - profile pages `/profile/{region}/{name}` {C};
  - ad-supported, with a premium tier since Q3 2025 {S}[S33];
  - part of M.O.B.A. Network.
- **xdx.gg**: profile (`/{name}-{tag}`) and **multi-search** (`/lol/multi/{region}/`). Used as a scouting site in the German Prime League tooling {C}[S50]. Feature details `[?]`.
- **lol.ps (KR)**: per-lane counter lists (counters and "easy" matchups with WR and games), lane share %, a **power curve** (WR over game time, `graphs.json`), and versus stats {C}[S51].
- **onetricks.gg**: one-trick rankings and builds {P}[S54].
- **lolpros.gg / trackingthepros**: pro account mapping (lolpros covers EUW) {C}[S50].
- **dodgetracker.com**: per-player dodge history {C}[S50].
- **championmastery.gg / masterychart.com**: mastery highscores, player lookup, live games {P}[S54].
- **gol.gg / Oracle's Elixir**: pro esports stats. gol.gg has Patreon tiers (€1 ad-free, €5, €9 analyst); Oracle's Elixir is now "powered by GRID" {S}[S45].
- **Blitz.gg (web)**: tier lists including ARAM ("Patch 26.19") {P}[S54]; mostly a desktop product.
- **loltheory.gg, rewind.lol**: **could not be verified in this session** (no evidence found through GitHub, and search was exhausted). Their features are unknown `[?]`.

---

## 2. Merged feature matrix

**Site abbreviations:** UGG = U.GG · OPGG = OP.GG · LOLA = Lolalytics · LOG = League of Graphs · DPM = DPM.lol · MOBA = Mobalytics · META = METAsrc · DEEP = Deeplol · LOI = League of Items · PBS = Probuildstats · TRK = Tracker.gg · PORO = Porofessor web · XDX = xdx.gg · LOLPS = lol.ps.

A site marked `?` means the feature is unverified for that site. Premium-only features are marked in the Notes column.

| Feature | Category | Sites that have it | Notes |
|---|---|---|---|
| One-click rune/item import from a web page | A | UGG (Auto-Import via app), OPGG (desktop), DPM (desktop), MOBA (desktop) | The web button needs a companion app; LCU import is covered by the desktop researcher |
| Native desktop companion (no Overwolf) | A | DPM (2026), UGG app, OPGG (Overwolf listing too) | DPM: free until 2026-10-03, then `?` |
| Riot Sign-On account linking | A/F | DPM (Login with Riot), OPGG (main account via My Page), MOBA (accounts) | Unlocks personal features |
| Official AI-agent API (MCP) | A/I | OPGG | JSON-RPC; `desired_output_fields` projection |
| Counter list per role (best/worst matchups) | B/G | UGG, OPGG, LOLA, LOG, DPM, MOBA, META?, DEEP, LOLPS | All show WR; most show games |
| Matchup-specific build ("X vs Y") | B/G | LOLA (/vs/ pages), OPGG (Master builds vs champs, lane matchup guide), MOBA (vs pages with tips/video) | UGG opponent filter `?` |
| Lane-phase diffs @15 (gold/XP/CS/kills) per matchup | B/G | UGG (@15 + duo + team gold diff + carry %), DPM (laning phase matchups) | Needs Timeline frames |
| Normalized matchup delta | B/G | LOLA (Delta 1, Delta 2), MOBA (`matchupDelta`) | Controls for each champion's base WR |
| Ally synergy / duo stats | B/G | UGG (champion_duos, duo tier list?), OPGG, LOLA (team by lane, d2), MOBA, DEEP, META (duos) | Bot-lane pairs matter most |
| Full-draft counter picker (bans + allies + enemies) | B | META (Counter Picker), DPM (desktop Draft Helper) | Web gap: no big site does full-draft scoring on the web |
| Ban suggestions | B | OPGG?, PORO (desktop) | |
| Personalized counters / tier list for your pool | B/G | UGG | PLUS only |
| Your own record vs a champion on its counter page | B/F | MOBA | Pass a Riot ID to the counters query |
| Multi-search (paste lobby) | B/C/I | UGG, OPGG, XDX, DPM?, PORO (live) | Classic champ-select hook |
| Live game lookup for any Riot ID | C | OPGG (/ingame), UGG (GetLiveGame), DPM (/live), DEEP (/ingame), PORO (/live) | Riot Spectator-V5 |
| Live-game badge on profile | C | UGG (LiveGameExists), OPGG? | |
| Per-player champion stats in live game | C | UGG (KDA on champ), PORO, DPM | |
| Pro/streamer identification | C/I | DEEP (pro_streamer_info + social links), DPM (pro search), PORO? | Needs a curated pro-account list |
| Directory of live notable games | C/J | UGG ("Live Games")?, OPGG (spectate pros)? | |
| Web live page as second screen | D | DPM, PORO, OPGG | Overlays are desktop-only |
| In-game timers/augment tiers overlays | D | DPM desktop (relic timers, Mayhem augment tiers), OPGG desktop, MOBA Live Companion | Outside web scope |
| Per-game performance score | E/F | OPGG (OP Score 0–10), UGG (Hard Carry + Teamplay), DPM (DPM Score + details), DEEP (AI Score), MOBA (GPI) | All proprietary; none published |
| Score timeline + narrative keywords | E | OPGG (5-min SR / 3-min ARAM; 14 keywords) | Unique |
| MVP/ACE-style highlight | E | OPGG (`is_opscore_max_in_team`, `op_score_rank`) | |
| Lane score | E | OPGG (`lane_score`) | |
| Gold/XP/objective timeline graphs | E | OPGG, DPM (desktop post-game), LOG?, MOBA?, UGG? | Timeline-V5 |
| Early-game movement paths + per-minute position map | E | OPGG | Timeline participantFrames positions |
| Per-player build and skill order in match detail | E | OPGG, UGG?, LOG? | Timeline events |
| LP change per game | E/F | UGG (`lpInfo`, rank snapshots), MOBA (`lpDiff`), OPGG?, DPM? | Needs League-V4 polling around each game |
| Lobby / team average rank | E | OPGG (`average_tier_info`), MOBA (`avgTier` per team) | Needs rank lookups for all 10 players |
| Community ratings/predictions per match | E/I | DPM (Vote & Ratings) | Unique |
| Notes on a match | E | OPGG (`memo`)? | |
| VOD replay of your recorded game | E/J | OPGG (desktop-recorded), DPM (desktop replays) | |
| AI summary/tips of games | E | OPGG (AI tips summary beta)? | |
| Rank cards (solo/flex, LP, W/L) | F | All profile sites | League-V4 |
| Ladder rank + percentile | F | UGG (`overallRanking`/`totalPlayerCount`), DEEP (`ranking`, `ranking_rate`), OPGG? | Needs a full-ladder crawl |
| Season history (past ranks) | F | UGG, OPGG, LOG, DEEP | Not in Riot API; sites must snapshot at season end |
| Peak rank | F | TRK (`peakTier`), DPM ("peak ELO real-time") | |
| LP history graph | F | MOBA (LP gains), UGG (rank snapshots), OPGG, DEEP (tier chart), LOG? | Polling-based |
| Streak / veteran / fresh blood / inactive flags | F | OPGG | From League-V4 |
| Season champion stats table | F | All profile sites | UGG adds `lpAvg`; OPGG adds avg OP Score |
| Champion stats by enemy | F | DEEP (`stats_by_enemy`) | |
| Role distribution | F | MOBA (role stats), OPGG?, LOG | |
| Played-with / duo filter | F/I | UGG (duo filter), OPGG?, LOG? | |
| Mastery tab / mastery ranking | F/I | OPGG (Mastery tab), LOG (mastery ranking), championmastery.gg | Champion-Mastery-V4 |
| Challenges (titles, percentiles, rankings) | F/I | DEEP, LOG (Challenges rankings) | Challenges-V1 |
| Skill radar / skill profile | F | MOBA (GPI: 8 axes) | |
| Personal ratings block | F | LOG | |
| Mechanics stats (e.g. skillshots dodged/min) | F | DPM (Lens) | Match-V5 `challenges` fields |
| Profile badges / tags | F | DPM (premium badges), OPGG (per-game keywords), LOG?, PORO? | |
| Renew/update with cooldown | F | OPGG (`renewable_at`), UGG (UpdatePlayerProfile), DEEP (45 s), MOBA (refresh with progress) | Rate-limit protection |
| Profile customization / social links | F/K | UGG (header bg + Twitch/Twitter/YouTube), DPM, MOBA (MGP) | Premium on UGG and DPM |
| Personal stats dashboard (main account) | F | OPGG | Ad-free subscription only |
| Recommended runes/items from own history | F | MOBA | |
| Arena placements in champion stats | F/H | UGG (`firstPlace`, `totalPlacement`) | |
| Records | F/I | LOG (records rankings), LOG profile records? | |
| Tier list per role | G | UGG, OPGG, LOLA, LOG, DPM, MOBA, META, DEEP | Methodologies differ (§3.2) |
| Tier trend (rank change vs previous patch/days) | G | OPGG (`rank_prev`, `rank_prev_patch`), LOLA (last-days values), META (Trend)?, LOI (WR/PR increase for items) | |
| Champion rank "x of y" in role | G | UGG (e.g. 40/54), LOLA (rank/rankTotal) | |
| Pick-Ban Influence | G | LOLA | Formula published |
| WR computed by player tier vs game-average tier | G | LOLA (states method + delta) | Key methodology choice |
| One-trick tier list / OTP leaderboard | G/I | LOLA (1trick tier), DPM (OTP ≥10 games), onetricks.gg | |
| Build archetypes (On-Hit/Crit/AP…) | G | UGG (7 variants), DEEP (variants), MOBA (variants) | |
| Most-common vs highest-WR build toggle | G | LOLA | |
| Runes with WR + games | G | UGG, OPGG, LOLA, LOG, DPM, MOBA, DEEP (per variant) | |
| Full rune grid stats | G | LOLA, LOG | |
| Skill priority + level path | G | UGG, OPGG, LOLA, LOG, DPM, MOBA, DEEP | |
| Skill distribution at levels 6/10/15 | G | LOLA | |
| Skill evolutions | G | OPGG (`skill_evolves`) | Kai'Sa-style champions |
| Starting items / boots / core 3 | G | UGG, OPGG, LOLA, DEEP, META, LOG | |
| 4th/5th/6th item options | G | UGG, OPGG (`last_items`), LOLA, META | |
| Item stats per build slot | G | LOLA (`item1`..`item5`), LOI (by order) | |
| Item timing (time to complete) | G | MOBA (`timeToTarget`), LOLA? | Timeline ITEM_PURCHASED |
| Full chronological purchase order | G | DEEP (`item.detail`), LOG (Full Builds) | |
| Support-quest / role-quest item stats | G | LOLA (`supportItem`), UGG (Role Quest panel) | 2026 role quests |
| Role quest completion time + points | G | UGG (e.g. 12:46 avg), UGG profile (`roleQuestCompletion`) | New in 2026 |
| Damage profile (physical/magic/true) | G | LOLA, LOG | |
| WR by game length | G | LOLA (`timeWin`), OPGG (`game_lengths`), LOG | |
| WR by games played on champion (experience curve) | G | LOG (0–80 games) | Unique among sites checked |
| WR by K−D difference @10 / @20 | G | LOG | Unique |
| WR/PR/BR history over time | G | LOLA (daily, per elo), LOG (since release), MOBA (per patch), OPGG (per version) | |
| WR by rank bracket | G | LOLA (graph lines per elo), OPGG (tier filter) | |
| Per-minute averages (gold, CS, damage, wards) | G | LOG; UGG (avg dmg/gold/KDA/CS in rankings) | |
| Multi-kill rates | G | LOG | |
| Kill/death position heatmaps | G | LOG | Timeline CHAMPION_KILL positions |
| Jungle paths | G | LOG | Timeline positions + jungle CS |
| "Mained by" % | G | LOG | Needs per-player champion shares |
| Champion lifetime history + release date | G | LOG | |
| Best players on a champion | G/I | UGG, OPGG, LOLA, LOG, DPM | |
| Pro builds | G/I | UGG/PBS, DPM, LOG, OPGG (Master builds) | |
| Combos / guides / tips | G | MOBA (combos, guides, tips), DPM (matchup videos) | Editorial content |
| Champion abilities / lore / base stats | G | OPGG, MOBA | Data Dragon |
| Item pages (who builds it, WR by order) | G | LOI, UGG (/lol/items), LOG (Items) | |
| Rune pages / rune tier list | G | LOI | |
| Patch-change pages with stat impact | G/K | LOI (patch rundown), DPM (patch charts), LOLA?, UGG (News) | |
| Free-form data explorer | G | DPM (Data Studio) | |
| Low-sample handling visible to users | G | OPGG (0.5% RIP rule), UGG (matches everywhere; low-sample flag), LOLA (n everywhere), LOG (N matches banner), LOI (500+ filter) | See §3.3 |
| ARAM builds + tier list | H | UGG, OPGG, LOLA, LOG, DPM, MOBA, META, DEEP | |
| ARAM balance modifiers | H | OPGG | From game data, not match data |
| ARAM Mayhem tier list + augment tiers | H | UGG (NEW), OPGG, META, DPM (desktop) | Augments arrived with Mayhem |
| Arena builds, augments, prismatic items | H | UGG, OPGG, LOLA, LOG, MOBA, META?, DPM (tier list) | |
| Arena synergies + placement stats | H | UGG (top-4 / first / avg place), LOLA (place1..8), OPGG (`op_rank`), LOG (Trios) | |
| URF / ARURF / One for All / Nexus Blitz | H | UGG, OPGG, META? | |
| TFT section | H | OPGG, LOG, MOBA, UGG | Not needed for MVP |
| Regional ladder leaderboards | I | UGG, OPGG?, LOLA, DPM | League-V4 apex + exp entries |
| Champion leaderboards | I | UGG, OPGG, LOLA, LOG, DPM | |
| Mastery / challenges / records leaderboards | I | LOG | |
| Rank distribution | I | LOG, OPGG? | |
| Custom / friends leaderboards | I | DPM | Unique |
| Pro SoloQ tracker by team/league | I | DPM, DEEP, lolpros | |
| Esports schedule / results / standings | I | OPGG (esports.op.gg), DPM, MOBA? | GRID holds the official data license |
| Pick'Ems | I | DPM | |
| Duo / clan finder | I | OPGG (Find DUO) | Premium bump perks |
| Referral program | I | MOBA | |
| Game-wide meta stats (sides, surrenders, AFK, pings, Flash key) | I/G | LOG | Unique breadth |
| Infographics | I | LOG | |
| Replay library (pentas, high KDA, pros, Twitch) | J | LOG | |
| Spectate live games | J | OPGG | Riot Spectator + observer key |
| Clips / highlights | J | DPM (desktop, cloud links), MOBA (Smart Highlights) | Desktop-only |
| Video sections | J | UGG (Watch)?, MOBA (combo/counter videos), DPM (matchup videos) | |
| Ad-free subscription | K | OPGG (~$3–3.99), UGG PLUS ($3.99/mo, $29.88/yr), MOBA Plus ($7.99/mo, $69.99/yr), DPM (3.99€/mo; 35.99€/yr) | LOLA, LOG, META: ads only |
| Cosmetic flair / badges / hall of fame | K | UGG PLUS (golden flair, name highlight), DPM (badges, Hall of Fame), MOBA (MGP, Reward Pass) | Premium |
| Priority support | K | UGG PLUS | |
| UI languages | K | OPGG 24, LOG 20, DPM 18, MOBA 17, META ~18; UGG and LOLA English only | |
| Mobile app | K | OPGG (Android/iOS), LOG (Android) | UGG: none |
| Multi-game coverage | K | OPGG, UGG, MOBA, META, LOG (TFT) | |
| Anti-bot (Cloudflare) on data APIs | K | UGG, OPGG, DPM, MOBA, LOG | Plan our own pipeline, don't scrape |

---

## 3. Data requirements (building every view from Riot APIs)

### 3.1 Riot building blocks (2025–2026)

Field names are from Riot's public DTOs as of 2025–2026. Items marked `[?]` should be checked against current docs before building on them.

| API | Endpoints | Key fields | Feeds |
|---|---|---|---|
| **ACCOUNT-V1** | `accounts/by-riot-id/{gameName}/{tagLine}`, `accounts/by-puuid/{puuid}` | `puuid`, `gameName`, `tagLine` | Search, profile URLs (`name-tag` slugs everywhere) |
| **SUMMONER-V4** | `summoners/by-puuid/{puuid}` | `profileIconId`, `summonerLevel`, `revisionDate` | Profile header; "has played since" change detection |
| **LEAGUE-V4** | `entries/by-puuid/{puuid}`; `challengerleagues`, `grandmasterleagues`, `masterleagues/by-queue/{queue}`; `entries/{queue}/{tier}/{division}?page=` | `queueType`, `tier`, `rank`, `leaguePoints`, `wins`, `losses`, `hotStreak`, `veteran`, `freshBlood`, `inactive`, `miniSeries` | Rank cards, OP.GG flags, ladders, rank distribution, crawl seeds, **rank bracketing of players** |
| **LEAGUE-EXP-V4** | `entries/{queue}/{tier}/{division}` (includes apex tiers) | same as above | Full-ladder crawl → ladder rank and percentile, rank distribution |
| **MATCH-V5** | `matches/by-puuid/{puuid}/ids?startTime&endTime&queue&type&start&count(≤100)`; `matches/{id}`; `matches/{id}/timeline` | see below | Every aggregate stat, match history, match detail |
| **CHAMPION-MASTERY-V4** | `champion-masteries/by-puuid/{puuid}[/by-champion/{id}]`, `/top`, `/scores` | `championPoints`, `championLevel`, `lastPlayTime`, season milestones | Mastery tab, mastery rankings, live-game "mastery on champ" |
| **SPECTATOR-V5** | `active-games/by-summoner/{puuid}`; `featured-games` | `gameId`, `gameQueueConfigId`, `gameStartTime`/`gameLength`, `bannedChampions[{championId,teamId,pickTurn}]`, `participants[{puuid, riotId, championId, teamId, spell1Id, spell2Id, perks{perkIds, perkStyle, perkSubStyle}}]`, `observers.encryptionKey` | Live game / loading-screen scouting, spectate |
| **CHALLENGES-V1** | `player-data/{puuid}`; `challenges/config`; `challenges/{id}/leaderboards/by-level/{level}`; `percentiles` | `totalPoints{level,current,percentile}`, `challenges[{challengeId, percentile, level, value}]`, `preferences.title` | Deeplol-style titles/percentiles, LoG challenge rankings |
| **CHAMPION-V3** | `champion-rotations` | free rotation IDs | OP.GG `is_rotation` |
| **LOL-STATUS-V4** | `platform-data` | incidents/maintenances | Status banner |
| **Static data** | Data Dragon (`versions.json`, champion/item/runesReforged/summoner JSON per patch); CommunityDragon (augments, Arena, quest/role items, raw game data) | ids → names/icons/tooltips | Every page. ARAM balance modifiers (OP.GG table) come from game data or wiki, **not match data** |
| **Esports** | Not in the public Riot API; official data is licensed through **GRID** {S}[S45]; lolesports schedule feeds are unofficial | schedules, results, pro game stats | Esports pages, pick'ems, pro stats |

**Match-V5 fields sites rely on** (`info.participants[]`):
- Identity: `puuid`, `riotIdGameName`, `riotIdTagline`.
- Champion and position: `championId`, `champLevel`, **`teamPosition`** (role assignment), `individualPosition`.
- Outcome: `win`, `gameEndedInEarlySurrender` (remake filter), `gameEndedInSurrender`, `teamEarlySurrendered`, `timePlayed`.
- Combat: `kills`, `deaths`, `assists`, `doubleKills`…`pentaKills`, `largestKillingSpree`, `largestMultiKill`, `killingSprees`, `firstBloodKill`/`Assist`.
- Farm and gold: `totalMinionsKilled`, `neutralMinionsKilled`, `totalAllyJungleMinionsKilled`, `totalEnemyJungleMinionsKilled`, `goldEarned`, `goldSpent`.
- Damage: `totalDamageDealtToChampions` and its **physical/magic/true split** (damage profile), `totalDamageTaken`, `damageSelfMitigated`, `damageDealtToObjectives`/`Turrets`/`Buildings`, `totalHeal`, `totalHealsOnTeammates`, `totalDamageShieldedOnTeammates`, `timeCCingOthers`.
- Vision: `visionScore`, `wardsPlaced`, `wardsKilled`, `visionWardsBoughtInGame`, `detectorWardsPlaced`.
- Objectives: `turretKills`/`Takedowns`, `inhibitorKills`, `dragonKills`, `baronKills`, `objectivesStolen`.
- Build: `item0..6` (final inventory only), `summoner1Id`/`summoner2Id`, **`perks`** (`statPerks{offense,flex,defense}`, `styles[{style, selections[{perk}]}]`), spell cast counts.
- Survival: `longestTimeSpentLiving`, `totalTimeSpentDead`.
- **Pings**: `allInPings`, `assistMePings`, `basicPings`, `commandPings`, `dangerPings`, `enemyMissingPings`, `enemyVisionPings`, `getBackPings`, `holdPings`, `needVisionPings`, `onMyWayPings`, `pushPings`, `retreatPings`, `visionClearedPings`. These feed LoG's "Pings" page.
- **`challenges{}`** (about 120 derived metrics), e.g. `kda`, `killParticipation`, `teamDamagePercentage`, `damagePerMinute`, `goldPerMinute`, `visionScorePerMinute`, `laneMinionsFirst10Minutes`, `jungleCsBefore10Minutes`, `soloKills`, **`skillshotsDodged`**, `skillshotsHit`, `dodgeSkillShotsSmallWindow`, **`earlyLaningPhaseGoldExpAdvantage`**, **`laningPhaseGoldExpAdvantage`**, **`maxCsAdvantageOnLaneOpponent`**, `maxLevelLeadLaneOpponent`, `turretPlatesTaken`, `takedownsFirstXMinutes`, `survivedSingleDigitHpCount`, `survivedThreeImmobilizesInFight`, `controlWardsPlaced`, `effectiveHealAndShielding`, `enemyChampionImmobilizations`. These are cheap inputs for performance scores and DPM-Lens-style mechanics stats without timelines.
- **Arena**: `playerAugment1..6`, `playerSubteamId`, `subteamPlacement`/`placement`.
- **2026 role quests**: U.GG exposes `roleQuestCompletion` and `roleBoundItem` per match, so Riot data carries role-quest info. Exact Riot field names `[?]`.
- `info.teams[]`: `bans[{championId, pickTurn}]` (ban rate), `objectives{baron, champion, dragon, horde, inhibitor, riftHerald, tower, atakhan}{first, kills}`, `feats` (2025 Feats of Strength) `[?]`.
- `info`: `gameVersion` (→ patch), `queueId`, `mapId`, `gameMode`, `gameDuration`, `gameCreation`, `platformId`, `endOfGameResult`.

**Timeline-V5 fields** (one frame every 60 s):
- `participantFrames`: `totalGold`, `currentGold`, `xp`, `level`, `minionsKilled`, `jungleMinionsKilled`, **`position{x,y}`**, `damageStats`, `championStats`, `timeEnemySpentControlled`.
- Events:
  - items: `ITEM_PURCHASED`, `ITEM_SOLD`, `ITEM_UNDO`, `ITEM_DESTROYED`
  - skills and levels: `SKILL_LEVEL_UP`, `LEVEL_UP`
  - kills: `CHAMPION_KILL` (killer, victim, assisters, **position**, bounty, damage dealt/received), `CHAMPION_SPECIAL_KILL` (first blood, multikill, ace)
  - wards: `WARD_PLACED`, `WARD_KILL`
  - structures: `BUILDING_KILL`, `TURRET_PLATE_DESTROYED`
  - monsters: `ELITE_MONSTER_KILL` (dragon subtype, herald, baron, horde, Atakhan), `DRAGON_SOUL_GIVEN`
  - other: `OBJECTIVE_BOUNTY_*`, `CHAMPION_TRANSFORM`, `FEAT_UPDATE` `[?]`, `GAME_END`

**Critical pipeline facts**
1. **Match-V5 has no participant ranks.** Every "Emerald+" filter needs a rank per player, taken from League-V4 at or near crawl time and cached per PUUID. The alternative is a game-average rank. Lolalytics publicly argues that its **per-player-tier** bucketing is more accurate than the "game-averaged tier" others use, and shows the difference as a "win rate delta" {P}[S28]. OP.GG and Mobalytics show per-game/team average tier (`average_tier_info`, `avgTier`) {C}, which also requires rank lookups for all 10 players.
2. **Build order, starting items, skill order, item timings, @10/@15 diffs, kill/death maps and jungle paths all need Timeline-V5.** `item0-6` is only the final inventory. This roughly doubles API calls per match, so a typical strategy fetches timelines for high-value queues and brackets first `[?]`.
3. **LP history is not an API.** U.GG (`getSummonerRankSnapshots`), Mobalytics (`lpHistory`/LP gains) and OP.GG's LP graph all come from polling League-V4 around each game and diffing. **Season history and peak rank** likewise need the site's own snapshots at season or split end. The Riot API only returns the current rank.
4. **Role assignment** uses `teamPosition` (Riot's heuristic). Every site reports stats per role and hides roles with too little play (OP.GG hides positions under 0.5% pick rate {P}[S15]).

### 3.2 View-by-view requirements

**Tier list** (UGG, OPGG, LOLA, LOG, DPM, MOBA, META, DEEP)
- *Raw data*:
  - per match: `gameVersion`→patch, `queueId`, `platformId`→region;
  - per participant: `championId`, `teamPosition`, `win`;
  - per team: `bans`;
  - per player: rank bracket (League-V4).
- *Aggregates* per (patch or window × queue × region × bracket × role × champion): games, wins, picks, bans, and total games in the bracket (the denominator for pick rate). Also the previous patch or last N days for trend (OPGG `rank_prev`/`rank_prev_patch`; LOLA last-days values). The "best players" subset is needed for LOLA-style tiers (Diamond+, ≥50 champion games, 90 days).
- *Formulas seen*:
  - UGG: WR + PR + **weighted BR** per role; the data includes `effective_winrate`, `stdevs`, `distribution_mean`/`distribution_stdevs`, which implies z-score tiering {P}[S1]{C}[S8].
  - OPGG: Platinum+ data; PR, BR, WR plus gold, XP, CC, KDA, damage in a proprietary model {P}[S14].
  - LOLA: WR, **PBI = (wr − avgWrOfTier)·100·pick/(100 − ban)**, and best-player WR and elo {P}[S28].
  - MOBA: tiers per "skillLevel" (low/high elo) {C}.
  - META: "Score" `[?]`.
- *Ban rate note*: bans are team-level and role-less. Per-role ban rates must be apportioned, e.g. by the champion's role share. This is likely what U.GG's "weighted ban rate" means `[?]`.

**Champion build page** (runes, spells, items, skills, role quest)
- *Raw data*:
  - Match-V5: `perks` (styles, selections, stat shards), `summoner1Id`/`2Id`, `item0-6`, `win`, `championId`, `teamPosition`;
  - **Timeline**: `ITEM_PURCHASED`/`UNDO`/`SOLD`/`DESTROYED` with timestamps (starting set = purchases before ~1:30 [heuristic]; core = first 3 completed legendaries; 4th/5th/6th; boots slot; item completion time), `SKILL_LEVEL_UP` (level path; max order; distribution at levels 6/10/15 as in LOLA `skill6`/`skill10`/`skill15`);
  - role-quest completion time and role-bound item (2026) `[?]`.
- *Aggregates*: games and wins for every rune, rune page, shard set, spell pair, start set, core triple, n-th item, boots slot and skill order; "most common" and "highest WR" variants (LOLA). **Archetype builds** (UGG On-Hit/Crit/Lethality/AD/AP/Tank; DEEP variants that differ by ≥2 core items {C}[S46]) need clustering of item sets.
- *Per-champion header*: tier, WR, rank *x of y* in role, PR, BR, games, lane-share % (LOLA `nav.lanes`), **damage profile** (physical/magic/true share of `*DamageDealtToChampions`).

**Counters / matchups / lane phase**
- *Raw data*: the lane opponent pairing (same `teamPosition` on the enemy team), `win`; **Timeline frames at 10/14/15 min** (`totalGold`, `xp`, `minionsKilled`+`jungleMinionsKilled`) plus `CHAMPION_KILL` events before 15:00. Alternatively use Match-V5 `challenges` (`laningPhaseGoldExpAdvantage`, `maxCsAdvantageOnLaneOpponent`, …) as a cheaper proxy.
- *Metrics seen*:
  - UGG: `xp_adv_15`, `gold_adv_15`, `cs_adv_15`, `jungle_cs_adv_15`, `kill_adv_15`, bot-lane `duo_*` variants, `carry_percentage_15`, `team_gold_difference_15` {C}[S8];
  - LOLA: Delta 1 / Delta 2 normalization {P}[S29]; MOBA: `matchupDelta`;
  - DEEP: `match_rate` (how often the matchup occurs);
  - LOG: WR against K−D at 10/20 min;
  - DPM: "laning phase matchups".
- *Matchup-specific builds* (LOLA `/vs/`) need build aggregates keyed by (champion, opponent, lane), which multiplies storage by about 150 opponents. Most keys will be sparse, so show games and hide thin rows.

**Synergy / duo**
- Ally pairs on the same team (all pairs, or bot lane only): games and wins. Compare against the expected WR from both champions' base WRs (LOLA `d2` "normalized synergy delta (adjusted to 50%)" {C}[S33]).

**"More stats" champion panels** (mostly LOG, LOLA, OPGG)
- *WR by game length*: `gameDuration` buckets (LOLA `time`/`timeWin`; OPGG `game_lengths{game_length, rate, average, rank}`; LOG 5-min buckets).
- *WR by games played on the champion* (LOG 0–80 games): needs each player's ordered match history on that champion, i.e. a count of prior games at match time. Expensive: requires dense per-player history or approximating with mastery points at crawl time.
- *WR by K−D @10/@20* (LOG): Timeline `CHAMPION_KILL` before 10:00 and 20:00.
- *Curves vs duration* (gold, minions, kills+assists, deaths): end-of-game stats bucketed by `gameDuration`.
- *Per-minute averages and multi-kill rates* (LOG): Match-V5 end stats divided by duration.
- *Kill/death heatmaps* (LOG): Timeline `CHAMPION_KILL.position`.
- *Jungle paths* (LOG): Timeline `position` each minute plus `jungleMinionsKilled` deltas. Camp-level events don't exist, so paths are inferred.
- *Objective splits* (LOLA `objective`): `teams[].objectives.*.first`/`kills` crossed with `win`.
- *"Mained by"* (LOG): per player, the share of games on the champion, over players seen in the window.

**Trend graphs** (LOLA daily per elo; LOG since release; MOBA per patch; OPGG per version)
- Keep daily aggregates (`gameCreation` date × bracket), not just per-patch totals. LOLA also stores a smoothed series (`wrs`).

**Best players / OTP / champion leaderboards**
- Per (player × champion × queue): games, wins, KDA, LP/rank. Thresholds seen: LOLA Diamond+ with ≥50 games in 90 days; DPM ≥10 games, ordered by SoloQ rank {P}. Needs a dense crawl of high-elo histories (apex ladders plus Diamond/Emerald entries).

**Profile header & progression**
- Account-V1 → PUUID; Summoner-V4 icon and level; League-V4 current rank.
- Ladder position and percentile (UGG `overallRanking`/`totalPlayerCount`; DEEP `ranking_rate`): needs a complete regional ladder snapshot (apex leagues plus every tier/division page), refreshed on a schedule.
- LP graph, LP delta per game, season history and peak: **own snapshots** (see §3.1 fact 3).
- Streak flags come straight from League-V4 (`hotStreak`, `veteran`, `freshBlood`, `inactive`).
- Champion stats table (UGG fields: games, wins, K/D/A, CS, damage, damage taken, gold, multi-kills, max kills/deaths, **`lpAvg`**, Arena placements): needs the player's season history via Match-V5 ids (`startTime` = season start; page through 100 at a time). Cache per player and update incrementally on each refresh.
- Update button: rate-limit per player (OPGG `renewable_at`; Deeplol 45-second cooldown {C}).

**Match history list**
- Match-V5 per game. KP, CS/min, damage share and vision come from `challenges`.
- Badges: MVP/ACE-style highlight (best score in team or lobby), largest multi-kill.
- LP delta (own snapshots) and lobby average rank (rank lookups for 10 players).
- Performance score, e.g. OP Score 0–10; U.GG Hard Carry + Teamplay for all 10 players.

**Match detail**
- Timeline-V5 is required for:
  - team gold, XP and objective timelines (OPGG);
  - per-player build and skill order;
  - **first-5-minutes movement paths and per-minute position distribution** (OPGG, which is limited to 60-second samples);
  - kill and ward maps;
  - plate, tower and dragon timelines;
  - score-over-time (OPGG timeline OP Score every 5/3 min);
  - "laning phase" block (CS@10, gold/XP diff @10/@15 vs lane opponent).
- Benchmarks ("your CS@10 vs average for Yasuo mid Emerald+") need per champion × role × bracket reference distributions (mean and percentiles), computed in the aggregate pipeline.

**Performance scores** (OP Score, Hard Carry/Teamplay, DPM Score, AI Score, GPI)
- All proprietary. Inputs are observable: K/D/A, CS, gold, damage and damage share, vision, objectives, KP, challenges metrics (solo kills, skillshots dodged, survived-low-HP…), and timeline shape (OP Score keywords are "based on each graph's shape" {P}[S17]).
- A typical implementation normalizes each metric to the (champion, role, bracket, duration) distribution, then weights. Mobalytics' GPI adds multi-game axes (Consistency, Versatility) {P}[S42].
- A public approximation maps GPI axes to Match-V5 `challenges` (e.g. farming ← `laneMinionsFirst10Minutes`, CS/min, gold/min; survivability ← `survivedSingleDigitHpCount`, `longestTimeSpentLiving`, `totalTimeSpentDead`; aggression ← `soloKills`, `takedownsFirstXMinutes`) {C}[S53].

**Live game / loading screen**
- Spectator-V5 by PUUID gives 10 participants, bans, queue and start time.
- Then, per participant: League-V4 rank, champion stats this season (from stored history), mastery on the champion (Champion-Mastery-V4), recent form (last N games), and premade detection (co-occurrence in recent matches).
- Pro/streamer identity comes from a curated list (DEEP `pro_streamer_info`; DPM pro search).
- Budget per lookup: up to 10 × (league + mastery + match-ids + k match details), so aggressive caching and precomputation for already-known players are essential.
- U.GG's live payload shows per-player `championStats{kills,deaths,assists}` and `currentRole` {C}[S11].

**Multi-search**
- The same per-player summary as the live game, for N pasted Riot IDs (lobby chat).

**Leaderboards**
- Ladder: League-V4 apex leagues sorted by LP, plus League-EXP entries.
- Rank distribution (LOG): counts per tier/division from full entry pages.
- Mastery leaderboards (LOG, championmastery.gg): mastery for known players only; there is no global mastery API.
- Challenges leaderboards: Challenges-V1 `leaderboards/by-level`.
- Records (LOG): max-per-stat over stored matches.
- Custom/friend leaderboards (DPM): user-defined sets of PUUIDs.

**Pro builds / pro SoloQ / esports**
- Curated pro-account lists (lolpros.gg, trackingthepros; DPM/Deeplol maintain their own) plus Match-V5 for those accounts.
- Esports schedules and results come from licensed GRID data or unofficial lolesports feeds.
- Player split stats (DPM: champion games, WR, KDA, KP, vision cards).

**Arena / ARAM / Mayhem / rotating modes**
- Arena: `playerAugment1..6`, `playerSubteamId`, `placement`. Metrics are top-4 rate, first-place rate and average placement (UGG `top_four`, `first`, `sum_of_placements`; LOLA `place1..8`; OPGG `total_place`, `first_place`), plus augment and prismatic-item stats and teammate synergies (LoG "Trios" indicates 3-player Arena teams in 2026 `[?]`).
- ARAM: no roles; separate tiering and ARAM balance modifiers (static data).
- ARAM Mayhem: augment picks (per-champion augment tiers in OPGG and DPM).
- URF, One for All, Nexus Blitz: the same aggregates, keyed by `queueId`.

**Item / rune pages** (League of Items style)
- Aggregates keyed by item: WR and PR overall, by champion, and **by build order position**, compared against the previous patch.
- Pick rate can exceed 100% because it counts builds per game {P}[S47].

**Patch pages**
- Per-patch aggregate deltas (WR, PR, BR) plus a patch-change list (Riot patch notes or DDragon diffs).
- LOI "patch rundown" and DPM "patch changes" charts.

**Game-wide stats** (LOG Stats section)
- Blue vs red WR (`teamId`, `win`); drake stats (`ELITE_MONSTER_KILL` subtype plus win); win stats (first blood/tower/dragon → WR); surrender stats (`gameEndedInSurrender`/`EarlySurrender` by minute); AFK stats (`timePlayed` vs `gameDuration` `[?]`); game durations; warding; **Flash on D vs F** (`summoner1Id` vs `summoner2Id` slot); pings.

**Replays / spectate**
- Spectate needs Spectator-V5 plus the observer `encryptionKey`.
- A replay library (LOG) needs recording or `.rofl` handling (desktop client or Riot replay service) and falls outside the public API.

### 3.3 Sample size & confidence handling

**Observed on sites**

| Site | What they do |
|---|---|
| OP.GG | Positions shown only with pick rate ≥ 0.5%; below that everywhere = "RIP champion", greyscale, no analysis {P}[S15]. Tiers use Platinum+ only {P}[S14]. OP Score labelled beta {P}[S16]. |
| U.GG | Shows **Matches** next to every rune, spell, item and skill option and every matchup {P}[S5]. The overview JSON has a low-sample flag slot (a client dev observed it always false and uses <1000 matches as their own threshold) {C}[S7]. Tiers built on distribution statistics (`stdevs`, `effective_winrate`, `distribution_*`) {C}[S8]. Default bracket **Emerald+** gives larger samples than Diamond+ {P}. |
| Lolalytics | Games (`n`) shown everywhere. Delta 1/Delta 2 normalization so matchup numbers aren't just "the champion is strong" {P}[S29]. **Rolling windows** (`patch=30` → 30 days) for small samples {C}[S33]. Best-player subset: Diamond+, ≥50 games, 90 days {P}[S28]. Reported 100-game minimum for counters `[?]` {S}[S45]. Smoothed WR series (`wrs`) {C}. |
| League of Graphs | Explicit sample banner ("174,864 matches (Last 2 days)"); rank filters are "X+" cumulative brackets (default Platinum+) {P}[S36]. |
| League of Items | Plat+ only; "only 500+ matches" toggle; FAQ explains item-WR bias (late and snowball items inflated) and pick rate >100% {P}[S47]. |
| DPM | OTP leaderboard requires ≥10 games on the champion {P}[S39]. Methodology for "real-time" tiers not published `[?]`. |
| Mobalytics | Counters listed "with WR/sample" {S}[S43]. Tier list split into low-elo vs high-elo {C}. |
| Deeplol | Build variants with `games`/`pick_rate`; matchup `match_rate` {C}[S46]. |
| Community tools | DraftGap-style generators require ≥10 matches per matchup {C}[S13]. An open-source stats site (Transcendence) uses **empirical-Bayes shrinkage** for tiers, **95% CI whiskers**, a plain-English sample banner, and a 500-game floor before S/A grades {C}[S52]. |

**Recommended for our pipeline** (synthesis, not a site claim)
1. Store raw **games and wins** at every level. Compute WR on read with a **Beta-binomial / empirical-Bayes** posterior that shrinks toward the parent level:
   - build choice → champion-role WR;
   - matchup → the expected WR from both champions (a log-odds additive model, i.e. LOLA's Delta 2 idea);
   - prior strength fitted per level (roughly 50–500 pseudo-games).
2. Always show `n`, and a CI or confidence pips. Grey out or collapse rows under view-specific floors (e.g. runes/items <1% of champion games or <100 games; matchups <50–100 games; tiers need ~500+ games for S/A).
3. Offer **"Most common" vs "Highest WR (min n)"** like LOLA, so high-WR/low-n builds don't mislead. Label the recommendation axis.
4. Early in a patch, blend the previous patch with decay weights, or offer 7/14/30-day windows (LOLA).
5. Choose and document **rank bucketing** (per-player rank at match time vs game average). Lolalytics shows the choice changes WR.
6. Exclude remakes (`gameEndedInEarlySurrender`) and bots. Tag AFK games (`timePlayed` ≪ `gameDuration` `[?]`).
7. Caveat survivorship biases: item WR rises with purchase slot; "built when ahead" items; kill-lead-conditioned WRs (LOG K−D curves are descriptive, not causal).

### 3.4 Volume benchmarks & crawl notes
- **League of Graphs**: 3,175,163 matches in the last 2 days (all tracked ranks and regions); 174,864 for one popular champion {P}[S36].
- **U.GG**: Yasuo mid, Emerald+, patch 16.6 (mid-patch snapshot): **24,594 matches**; best rune page 2,092; core build 9,268 {P}[S5].
- **U.GG** ranking object (Emerald+ world, 15.9 snapshot): `total_matches` 502,203, `real_matches` 190,011, `bans` 31,160 for one champion-role {C}[S8].
- **Lolalytics** claims to process every ranked game {P}[S28]. Its payloads expose the analysed count (`analysed`) and per-bracket games per champion {C}[S30].
- **Crawl pattern** used across tools:
  1. seed PUUIDs from League-V4 apex leagues and `entries/{tier}/{division}` pages;
  2. `matches/by-puuid/ids` per player;
  3. dedupe match IDs globally;
  4. fetch the match, then the timeline for eligible queues;
  5. look up each participant's rank (cached per PUUID with TTL) for bracketing;
  6. snapshot League-V4 for tracked players after each game to get LP deltas.
- Keep **patch** (from `gameVersion` major.minor) and **display patch** (Riot's year-based name, e.g. 26.19) as separate fields.
- **Policy notes for a desktop companion** (context for other sections):
  - Riot banned Porofessor's "Enemy Ultimate Timer" feature (2025-03-13) {S}[S45];
  - an in-game ad ban (May 2025) hurt overlay monetization {S}[S33];
  - Riot policy restricts redistribution of aggregated data as a "data broker" {S}[S34].

---

## 4. Sources

IDs match the `[S#]` citations above. Pages on u.gg, op.gg, lolalytics, dpm.lol, mobalytics, x.com and similar domains were seen only through search-result excerpts, because direct fetches were blocked. GitHub items were read directly (raw files or saved pages).

**U.GG**
- [S1] U.GG FAQ — https://u.gg/faq
- [S2] U.GG PLUS announcement — https://u.gg/lol/news/introducing-u-gg-plus-level-up-your-experience
- [S3] Enthusiast Gaming, U.GG Plus launch — https://www.enthusiastgaming.com/enthusiast-gaming-launches-new-subscription-offering-provides-operational-and-corporate-updates/ ; https://www.stocktitan.net/news/EGLXF/enthusiast-gaming-launches-new-subscription-offering-provides-0rciiwt8vnzk.html
- [S4] U.GG PLUS Instagram post — https://www.instagram.com/p/DVoW7QjjuJ_/
- [S5] Saved U.GG Yasuo build page (patch 16.6, 2026) — https://github.com/github-gokcek/Egg_Content_Bot_V2/blob/HEAD/temp_ugg.html
- [S6] U.GG GraphQL investigation (2026-07-14) — https://github.com/aovoq/lol-overlay/blob/HEAD/docs/ugg-chrome-api-investigation.md
- [S7] uggo U.GG client (overview, matchups, arena_overview, mappings) — https://github.com/kade-robertson/uggo
- [S8] U.GG SSR payload sample (rankings, matchups, api-versions) — https://github.com/SlavvyCode/LeagueCooldownHelper/blob/HEAD/data_examples/ssr_%20smaller.json
- [S9] league-of-clash U.GG matchup index map — https://github.com/vigovlugt/league-of-clash/blob/HEAD/data/src/champion/matchups.rs
- [S10] ugg-match-api structs (match summaries, overall ranking) — https://github.com/AlsoSylv/ugg-match-api/blob/HEAD/src/structs.rs
- [S11] U.GG `GetLiveGame` query usage — https://github.com/shyamdhanvi/LOLPrediction/blob/HEAD/backend/api_calls.py
- [S12] U.GG `getPlayerStats` notes — https://github.com/SherlockRock/draft-simulator/blob/HEAD/scripts/ugg-scraper/PLAYER_API.md
- [S13] U.GG `champion_duos` usage — https://github.com/AirMile/draftgap/blob/HEAD/scripts/generate-matchup-data.ts
- [S56] Enthusiast Gaming acquires U.GG — https://www.enthusiastgaming.com/enthusiast-gaming-expands-into-league-of-legends-with-acquisition-of-u-gg/
- [S57] U.GG tier list guide (Sept 2026, secondary) — https://www.propelrc.com/u-gg-tier-list/

**OP.GG**
- [S14] OP.GG Help: champion tier calculation — https://help.op.gg/hc/en-us/articles/31089225669017-champion-tier-calculation-explained
- [S15] OP.GG Help: RIP champion — https://help.op.gg/hc/en-us/articles/31089402615705-What-is-an-RIP-champion
- [S16] OP.GG Help: OP Score explained — https://help.op.gg/hc/en-us/articles/31088715328665-OP-Score-explained
- [S17] OP.GG Help: timeline OP Score keywords — https://help.op.gg/hc/en-us/articles/38185639004569-What-do-the-timeline-OP-Score-keywords-mean
- [S18] OP.GG Help: detailed match data — https://help.op.gg/hc/en-us/articles/31091817743129-Viewing-detailed-match-data
- [S19] OP.GG Help: champion expert builds — https://help.op.gg/hc/en-us/articles/34852586389017-Viewing-champion-expert-builds
- [S20] OP.GG Help: Ad-free features — https://help.op.gg/hc/en-us/articles/31091483351065-What-features-does-OP-GG-Ad-free-offer ; Subscription section https://help.op.gg/hc/en-us/sections/48289819523993-Subscription
- [S21] OP.GG Help: esports rankings — https://help.op.gg/hc/en-us/articles/31091766096665-League-team-and-player-rankings-explained ; schedules — https://help.op.gg/hc/en-us/articles/31091788972057-How-to-check-match-schedules-and-results ; builds by role — https://help.op.gg/hc/en-us/articles/48936219784985-How-to-check-recommended-builds-by-role
- [S22] OP.GG official MCP server — https://github.com/opgginc/opgg-mcp
- [S23] LeagueAkari OP.GG types and HTTP helper — https://github.com/LeagueAkari/LeagueAkari/blob/HEAD/src/shared/types/opgg/index.ts ; https://github.com/LeagueAkari/LeagueAkari/blob/HEAD/src/shared/http-api-axios-helper/opgg/index.ts
- [S24] OPGG.py models and fixtures (game, summoner, season, champion, keywords) — https://github.com/ShoobyDoo/OPGG.py
- [S25] OP.GG desktop patch notes — https://op.gg/desktop/en/patch-notes ; Overwolf listing — https://www.overwolf.com/app/opgg-electron-app ; Android app — https://play.google.com/store/apps/details?id=gg.op.lol.android
- [S26] OP.GG tier list — https://op.gg/lol/champions ; champion stats — https://op.gg/lol/statistics/champions ; esports OP Score rankings — https://esports.op.gg/standings/op-score
- [S27] Wombo Combo, OP.GG features guide (secondary) — https://www.wombocombo.gg/blog/game-analytics/opgg-features-complete-guide
- [S55] Wombo Combo, OP.GG vs U.GG tier accuracy (secondary) — https://www.wombocombo.gg/blog/champion-tier-lists/opgg-vs-ugg-tier-accuracy

**Lolalytics**
- [S28] Tier list pages — https://lolalytics.com/lol/tierlist/ ; https://lolalytics.com/lol/tierlist/?tier=1trick ; https://lolalytics.com/lol/tierlist/?patch=30 ; https://lolalytics.com/lol/tierlist/arena/ ; home https://lolalytics.com/
- [S29] Champion pages (Delta 1/2, PBI, WR delta text) — https://lolalytics.com/lol/aatrox/build/ ; https://lolalytics.com/lol/sett/build/ ; https://lolalytics.com/lol/aatrox/arena/build/ ; https://lolalytics.com/lol/aatrox/aram/build/
- [S30] draftgap Lolalytics payload types (champion.ts, qwik.ts) — https://github.com/vigovlugt/draftgap/tree/HEAD/apps/dataset/src/lolalytics
- [S31] arenagap Lolalytics Arena types — https://github.com/vigovlugt/arenagap/blob/HEAD/src/lolalytics-data.ts
- [S32] LolSapiens Lolalytics tierlist fields — https://github.com/jspenaq/LolSapiens/blob/HEAD/backend/api/sapiens.py
- [S33] RabadonGG docs (api.md, competitive-analysis.md) — https://github.com/Kuderic/RabadonGG
- [S34] LoL-Companion data-sources doc — https://github.com/Desstroct/LoL-Companion/blob/HEAD/docs/lol-data-sources.md
- [S35] league-lean endpoints — https://github.com/Nicetyone/league-lean

**League of Graphs / Porofessor**
- [S36] Saved League of Graphs "Mel stats" page (patch 16.17, 2026) — https://github.com/GrumpyCat51/lol-skin-release-statistics/tree/HEAD/data/leagueofgraphs_html_pages ; site https://www.leagueofgraphs.com/
- [S37] League of Graphs profile scraper (Zephyr) — https://github.com/silasejohn/Zephyr/blob/HEAD/backend/modules/scrapers/league_of_graph_scraper.py

**DPM.lol**
- [S38] DPM.LOL X posts:
  - Score details — https://x.com/dpmlol/status/1894455202897392034
  - Lens — https://x.com/dpmlol/status/1917550182046027833
  - Live Game — https://x.com/dpmlol/status/1895545584397754699
  - Vote & Ratings — https://x.com/dpmlol/status/1885323849190736078
  - Laning Phase Matchups — https://x.com/dpmlol/status/1893610709092569553
  - Create your Leaderboard — https://x.com/dpmlol/status/1901347296488325345
  - Login with Riot — https://x.com/dpmlol/status/1884638402923856324
  - Premium live — https://x.com/dpmlol/status/1918740957199011849
  - Premium tiers — https://x.com/dpmlol/status/1947266937777524777
  - Data Studio — https://x.com/dpmlol/status/1887578087182750029
  - ARAM — https://x.com/dpmlol/status/1859881197155057770
  - Profile icons — https://x.com/dpmlol/status/1881865626567745769
  - Patch 16.10 changes — https://x.com/dpmlol/status/2051803856175014128
  - App 1.6.0 — https://x.com/dpmlol/status/2090736171248754721
  - Desktop app live — https://x.com/dpmlol/status/2103877421447381308
  - Roadmaps — https://x.com/dpmlol/status/1951241835696775301 ; https://x.com/dpmlol/status/1923687569205661882
- [S39] DPM pages:
  - https://dpm.lol/premium · https://dpm.lol/changelog · https://dpm.lol/app
  - https://dpm.lol/tierlist · https://dpm.lol/tierlist/aram · https://dpm.lol/tierlist/arena
  - https://dpm.lol/leaderboards/otps/Quinn
  - https://dpm.lol/esport/soloq · https://dpm.lol/esport/soloq/lck/leaderboard · https://dpm.lol/esport/soloq/lec/leaderboard
  - https://dpm.lol/studio/skillshots/champion · https://dpm.lol/Hide%20on%20bush-KR1/lens · https://dpm.lol/pro/APP
  - https://dpm.lol/champions/Brand/build · https://dpm.lol/champions/Sion/build/pro
- [S40] esports.gg DPM profile — https://esports.gg/news/league-of-legends/how-dpm-lol-is-transforming-lol-analytics/
- [S41] DPM and other URL routes in code — https://github.com/raycast/extensions/tree/HEAD/extensions/dpm-lol ; https://github.com/qurnt1/otp_lol/blob/HEAD/src/services/urls.py ; https://github.com/adamdao-tech/aplikace

**Mobalytics**
- [S42] Mobalytics GPI — https://mobalytics.gg/gpi/ ; support https://support.mobalytics.gg/hc/en-us/sections/115000496991-GPI ; profile blog https://mobalytics.gg/blog/how-to-use-the-mobalytics-summoner-profile-feature/ ; dev blog (MGP, Reward Pass) https://mobalytics.gg/gamebase/dev-blogs/10-years-mgp-reward-pass
- [S43] Mobalytics GraphQL research (May 2026) — https://github.com/mvanhorn/printing-press-library/tree/HEAD/library/media-and-entertainment/mobalytics-lol
- [S44] Mobalytics GraphQL clients — https://github.com/cauchy2384/leaguewatcherbot ; https://github.com/Tomlora/MarinSlash ; https://github.com/isak102/lol-lp

**Cross-site / secondary**
- [S45] French competitive analysis (2026; secondary, broad) — https://github.com/LINDECKER-Charles/LeagueOfDataBaseFinal/blob/HEAD/docs/produit/analyse-concurrentielle.md

**Deeplol**
- [S46] Deeplol API evidence (and OP.GG/U.GG provider notes, July 2026) — https://github.com/aovoq/lol-overlay/blob/HEAD/docs/player-provider-api.md ; https://github.com/noway4u-sir/mitspieler-command-next-gen/blob/HEAD/src/models/deeplol.ts ; https://github.com/jake3512/GGOBIS/blob/HEAD/src/lib/sources/deeplol.ts ; https://github.com/lookhel/lol-team-soloq-viewer/blob/HEAD/src/clients/deeplol.py

**League of Items, METAsrc, Tracker.gg**
- [S47] League of Items front end and FAQ — https://github.com/vigovlugt/LeagueOfItemsFrontend
- [S48] METAsrc — https://www.metasrc.com/lol/aram ; https://www.metasrc.com/lol/arena ; https://www.metasrc.com/lol/aram/tier-list ; Mayhem scraper https://github.com/LoLek-Smart-Assistant/lolek-api/blob/HEAD/src/scraper/scrapeMayhemChampion.ts
- [S49] Tracker.gg LoL — https://tracker.gg/lol/profile/riot/DPM/overview ; client code https://github.com/ariahrt/SMC/blob/HEAD/stats.py

**Other sites and tools**
- [S50] Profile/multi-search URL catalogs — https://github.com/isak102/lol-teleport/blob/HEAD/src/lib/sites.ts ; https://github.com/CarlVic02/Emperor-Eye_Lobby-Reveal/blob/HEAD/src/linkmaker.py ; https://github.com/random-rip/primebot_backend
- [S51] lol.ps adapter — https://github.com/jake3512/GGOBIS/blob/HEAD/src/lib/sources/lolps.ts
- [S52] Transcendence audit (open-source stats site; empirical Bayes/CI; competitor gaps) — https://github.com/luisgon-dev/Transcendence/blob/HEAD/roadmap.md
- [S53] GPI approximation mapped to Match-V5 challenges (jaxstats) — https://github.com/rsanandres/jaxstats/blob/HEAD/app/ml/gpi.py
- [S54] Other sites: https://www.onetricks.gg/ · https://championmastery.gg/ · https://masterychart.com/live-games · https://blitz.gg/lol/tierlist/aram · https://u.gg/lol/aram-tier-list · https://www.skill-capped.com/lol/guides/stats · https://lolprofile.net/
