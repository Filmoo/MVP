# Riot policy red lines

Summary for day-to-day decisions. Full notes, sources and dates: research/E-riot-platform-policies.md.
Last reviewed 2026-09-27 from secondary copies of Riot's texts; re-verify on developer.riotgames.com
before the production-key application.

**Never**
- Show player-level data about non-party allies in Ranked Solo/Duo champ select (names hidden
  since 12.22). Allowed there: our own data, our party's, and champion-level stats of visible
  picks/hovers/bans. Never de-obfuscate `obfuscatedPuuid` or use leaked names.
- Re-identify Streamer Mode players (hidden in apps too since 25.20).
- Track enemy cooldowns (ultimates, summoners, abilities), power-spike alerts, or prompts that
  dictate actions. Treat jungle/objective timers as avoid.
- MMR/Elo estimates, dodge advice/auto-dodge, shaming tags or negative labels.
- Arena augment/item win rates; Brawl data; historic Riot IDs; game-session info the player
  couldn't know.
- Scrape other stat sites, use the League client to bypass API rate limits, or redistribute Riot data.
- Ship the API key in the app; run a public app on a dev/personal key.
- Ads in-game, on loading screens or in the Riot client; betting/crypto/NFT.
- Riot trademarks or champion names in the product name, domain or handles; Riot logos.

**Always**
- Free tier for core features. "Isn't endorsed by Riot Games" boilerplate.
- Store Riot ID next to every PUUID (PUUIDs are encrypted per API key; LCU PUUIDs differ).
- Register the product early and declare every LCU endpoint used (reads and writes).
- User-triggered (or clearly opted-in) automation only.

**Gray (decide per feature, document the reasoning)**: auto-accept, auto-pick/ban, premade
detection, composite player scores, live win probability, sending data to third-party services.

### Gray-area decisions
- **Auto-accept (2026-09-27, shipped).** Allowed as a clearly opted-in convenience: it acts only in
  the player's own client and only answers a prompt the player would answer anyway.
  Guard rails: **off by default** (Settings → Automation); a **visible delay** (default 2 s,
  0–8 s) so the pop-up is always seen before MVP accepts; **one accept per ready check**;
  never when the player already accepted or **declined** (checked right before the POST);
  cancelled as soon as the phase leaves the ready check; a toast confirms every accept.
  LCU endpoints: `GET /lol-matchmaking/v1/ready-check`, `POST /lol-matchmaking/v1/ready-check/accept`
  (declare both at product registration).
- **Loading-screen scouting (2026-09-27, shipped; name sources revised 2026-09-29).** Player
  cards appear only once the game has started (Loading/InGame), when the game itself shows every
  name; champion select is never read for identities. The League client's gameflow session no
  longer names anyone but the local player (seen 2026-09-28: no `gameName`/`tagLine`, no
  `nameVisibilityType`), so the names come from Riot's two supported sources for a running game,
  **both of which keep Streamer Mode players anonymous**, in this order:
  1. **Riot's live game** (Spectator-V5, asked by our backend: `GET /v1/live/…`). The app sends
     only the local player's own Riot ID (from `current-summoner`, as for their own card) and
     the game's id. Since 2025-10 Riot's live-game results "respect players' streamer mode
     settings": an anonymous player comes without a PUUID, and the backend drops whatever name
     comes with them (never answered, looked up, stored or logged). Riot answers 404
     "filtered" for Ranked Flex and Arena live games (2026-06): the app says so plainly and
     doesn't try Spectator-V5 another way.
  2. **The game itself** (Live Client Data API, `https://127.0.0.1:2999`), only when Riot has no
     answer (no server, not listed, filtered): the in-game player list, i.e. the names the game
     shows every player once the loading screen is over. Asked only while the game runs and
     until it answers (then never again for that game). Riot says streamer-mode players have
     "no reliable identifier" there: a missing or partial Riot ID, a champion's name in its
     place, or a name several players share is taken for a stand-in, never for a Riot ID — the
     player shows as "Hidden player" and is never looked up. **Open question for Riot (App
     Note):** Spectator-V5's Flex/Arena filter has no stated intent; if it is meant to keep
     those players from apps, this fallback must stop for those queues (one condition in
     `companion::live::find_names`).
  Seats are matched to these lists by side and champion, never by anything hidden; a seat the
  client marks hidden stays hidden whatever a list says. Bots are shown as bots, never looked
  up. Visible players are looked up on our backend **by Riot ID** (what the loading screen
  shows); the client's PUUIDs never leave the app (they aren't our API key's anyway), and the
  backend stores the Riot ID next to its own PUUID. Tags are positive or neutral only
  (one-trick, win streak, veteran, main role); no "first time", no MMR, no grades of other
  players. Endpoints to declare at product registration: LCU `GET /lol-gameflow/v1/session`,
  `GET /lol-summoner/v1/current-summoner`, `GET /riotclient/region-locale`; Game Client API
  `GET https://127.0.0.1:2999/liveclientdata/allgamedata` (only `allPlayers` is read); Riot
  API (server) `GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`,
  `GET /lol/spectator/v5/active-games/by-summoner/{encryptedPUUID}`, and for the cards
  `GET /lol/league/v4/entries/by-puuid/{puuid}`, `GET /lol/match/v5/matches/by-puuid/{puuid}/ids`,
  `GET /lol/match/v5/matches/{matchId}`.
- **Window follows the game (not gray, noted for completeness).** Bringing MVP to the front in
  champ select and switching views only moves our own window; both can be turned off, and a view
  the player opened themselves is never switched away from.
- **Draft helper (2026-09-28, shipped; not gray, noted for the endpoint list).** Statistics only:
  about the other nine players it uses champion-level numbers of what champ select shows (picks,
  allies' hovers, bans) and never their identities (the session's name/PUUID fields are not even
  deserialized); the player's pool comes from their own client (mastery, own match history,
  pickable champions). Picks are ranked options with their reasons, never made for the player;
  no ban suggestions, no dodge advice. Stats files come from our backend (no Riot key in the app).
  LCU endpoints (reads): `GET /lol-champ-select/v1/session` (and its events),
  `GET /lol-champion-mastery/v1/local-player/champion-mastery`,
  `GET /lol-champ-select/v1/pickable-champion-ids`,
  `GET /lol-match-history/v1/products/lol/current-summoner/matches` (declare at product
  registration).
- **Draft insights: team compositions, ARAM bench, stats rank (2026-09-28, built; not gray,
  noted for the reasoning).** Compositions add up champion-level averages (damage mix, frontline,
  crowd control, win rate by game length) of what champ select shows — picks and allies' hovers,
  enemies over their likely roles — never anything about the players. Readings are neutral
  descriptions ("mostly magic damage", "stronger in long games"), never advice or grades, and
  none of it enters the estimate. Win rate by game length is a champion statistic shown before
  the game, not a power-spike alert (nothing during the game, no timers). ARAM: MVP reads your
  champion, the bench and rerolls left from the player's own session and ranks them by the team's
  chances with their reasons; it never swaps, rerolls or picks for the player (no LCU write). The
  queue comes from `GET /lol-gameflow/v1/session` (already declared), read once per champ select.
- **Build imports: rune page, item set, summoner spells (2026-09-28, built; not yet tried on a
  real client).** Writes into the player's own client, allowed by precedent (Mobalytics, Blitz,
  Porofessor and U.GG write the same endpoints; research E §15–16) when user-triggered or opted
  in. The build is statistics only: the most played options of our Emerald+ aggregates.
  Guard rails:
  - **Buttons always; automatic only when opted in, and only once.** Every part has its button
    (Draft's import bar, champion pages): user-triggered. Settings → Imports has one "Auto import"
    switch per part, off by default; a part switched on is imported by itself once, at the first
    lock-in of a champion select (2026-09-29, the owner: "import once, and warn if different, not
    enforce").
  - **The player's things are never touched.** Rune pages: only MVP's own page (named "MVP…";
    the player can hand one over by renaming it "MVP") is replaced; a new one is created only
    when the account has room, else a clear error ("No free rune page: delete one, or rename one
    to 'MVP'…"); no page is ever modified or deleted (no DELETE call at all). Item sets: the
    document goes back with every set and field of the player exactly as read; only MVP's set
    for that champion (named "MVP…", tied to that champion only) is replaced.
  - **Summoner spells: Flash side safe, never last second.** Champion select only; never with
    5 s or less on the timer (`LAST_SECONDS`) nor once the game is starting, checked right
    before the write; Flash goes on the player's key (their setting, else the key it sat on in
    most recent games, else where it is now) and the player is told when that differs from the
    build, or had to be guessed.
  - **The server can pause each part for everyone** (feature flag or kill switch in the remote
    config): a paused part is skipped at once, also in the middle of a champion select.
  - **Auto import: once, then warn, never enforce.** Not on hovers or pick intents, and never
    again by itself in that champion select: if the player's champion or role changes after it (a
    trade, an ARAM reroll or bench swap, a role swap), Draft warns ("MVP's build is for Ahri Mid,
    you're now on Lux") with a one-click "Import for Lux" (a toast elsewhere in MVP), and the
    player chooses. MVP never watches the player's pages, sets or spells: what they change
    themselves never warns nor imports. Spells of a first lock in a turn's last seconds wait for
    time on the clock. A toast confirms every automatic import, and the Draft bar shows it.
  - **Nothing once the game is starting**: an import for the champion select (Draft's buttons,
    the automatic import) that comes as it ends tries nothing and says so.
  LCU endpoints (declare at product registration): reads `GET /lol-perks/v1/pages`,
  `GET /lol-perks/v1/inventory`, `GET /lol-summoner/v1/current-summoner`,
  `GET /lol-item-sets/v1/item-sets/{summonerId}/sets`, `GET /lol-champ-select/v1/session`,
  `GET /lol-gameflow/v1/session` (queue/map → ranked or ARAM builds),
  `GET /lol-match-history/v1/products/lol/current-summoner/matches` (the local player's Flash key);
  writes `POST /lol-perks/v1/pages` (MVP's page only), `PUT /lol-perks/v1/pages/{id}` (MVP's page
  only), `PUT /lol-perks/v1/currentpage`, `PUT /lol-item-sets/v1/item-sets/{summonerId}/sets`,
  `PATCH /lol-champ-select/v1/session/my-selection` (`spell1Id`, `spell2Id`).
- **Crash reports (2026-09-28, shipped): data leaving the machine, opt-in only.** Off by default
  (Settings → App → "Send crash reports", with the wording of what is sent). A report holds the
  error (message, stack), the app and OS/webview versions and the random install id, which is not
  linked to the Riot account; never LCU payloads, game data or the Riot account. Scrubbed twice:
  in the app before it leaves and on the server before it's stored (`crates/scrub`: Riot IDs,
  PUUIDs, user names in paths, e-mails, credentials such as the LCU password, IPs). Kept 30 days,
  erasable per install id (shown in Settings once reports are on). Turning reports off deletes
  the ones not sent yet; nothing is written or sent while off.
- **Riot's ranked emblems (2026-09-28, built; not gray, noted for the asset rules).** Game art
  shown as Riot made it, like Data Dragon icons: the app downloads the League client's emblem
  files (from `CommunityDragon`'s mirror of the client) at run time and caches them; they are
  never committed or redistributed by us, and the request carries nothing about the player.
  Riot also publishes these emblems for developers on developer.riotgames.com: before the
  production-key application, check which source Riot prefers and switch if needed
  (`static_data::emblems`, one constant).
- **Per-game grades (2026-09-28, built; gray: a composite score; the owner kept it the same day).** Every
  finished game in a match history (yours on Home, anyone's on a player page) gets a letter
  (S+ to C), a score out of 10 and a place among the ten; an opened game shows all ten players'.
  Why it stays on the right side: it rates **one finished game's scoreboard, not a player** (no
  average grade, no player rating, no MMR or rank estimate); it only uses the post-game numbers
  every player of that game already saw on the end screen; it is **transparent** (the two or
  three facts that moved it are shown with it, and the method is written next to the column);
  the words are neutral or positive (C is the lowest letter; MVP and ACE are the only badges, no
  tags); it **never shows where it could steer a live decision**: not in champion select (Draft),
  not on the loading screen or in game (Live cards), only in match histories after the game.
  Streamer-mode players stay hidden in opened games (the client's `nameVisibilityType: HIDDEN`,
  Match-V5 without a name): their line shows "Hidden player", and their name is never looked up.
  Same kind of number as op.gg's per-game OP Score (with its MVP/ACE). If the owner vetoes it, the
  grades come off the rows and the opened games (`MatchSummary.grade` and `MatchPlayer.grade`
  stay `null`), and the details stay. LCU endpoint (read, declare at product registration):
  `GET /lol-match-history/v1/games/{gameId}` (your listed games only, each read once), next to
  the match list already declared.
- **Opened games: end-of-game stats and links to players (2026-09-29, built; not gray, noted for
  the reasoning).** An opened game shows the raw end-of-game numbers of all ten players, those
  of the League client's own post-game Stats tab (damage by type, healing, wards, gold spent…):
  what every player of that finished game saw on its end screen, from the same reads as the
  scoreboard (your listed games from the client, anyone's from Match-V5 on our server); nothing
  during a game, no rating built on them beyond the grade above. Each **named** player's Riot ID
  opens their page, like typing it in the search (the game shows the name; the page is looked up
  on our server when it opens); streamer-mode players and bots are never links, never looked up.
  *Planned* (next version): the game over time (gold, XP, CS, damage, the teams' gold difference,
  a kill/death heatmap and positions) from Match-V5's timeline and, for your own games, the
  client's `GET /lol-match-history/v1/game-timelines/{gameId}` (declare it then): still a
  finished game only, hidden players drawn anonymously.
- **LP per game and the post-game summary (2026-09-29, built; not gray, noted for the reasoning
  and the endpoint list).** The League client never says what a game was worth: MVP reads the
  player's own standing before a ranked game and after the client has counted it, and shows the
  difference (100 LP per division, apex tiers plain LP). Two numbers the player saw and their
  difference, kept on their machine only: **no MMR, no hidden-rating estimate**, no prediction.
  The post-game summary uses the end-of-game numbers everyone in the game saw (the grade's rules
  above apply); the lane opponent's Riot ID links to their page, a hidden player stays hidden.
  LCU endpoints (reads, declare at product registration): `GET /lol-ranked/v1/current-ranked-stats`
  (and its event), `GET /lol-gameflow/v1/session` (the game's id and queue at its start),
  `GET /lol-match-history/v1/games/{gameId}`, `GET /lol-match-history/v1/products/lol/current-summoner/matches`
  with `begIndex`/`endIndex` (older games), `GET /lol-champion-mastery/v1/local-player/champion-mastery`.
- **Remote config and self-updates (2026-09-28, shipped).** The app asks our server for its
  config and for updates with its version and install id only (no Riot data). Kill switches can
  only turn features **off**: they stop our own automations (auto-accept, each build import
  part; feature flags also hide the draft helper's numbers) when a client change makes them
  misbehave. Updates never download or install during a ready
  check, champ select or a game, and never restart the app without the player's click (else
  they install when MVP quits).
