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
- **Loading-screen scouting (2026-09-27, shipped).** Player cards appear only once the game has
  started (Loading/InGame), when the game itself shows every name; champion select is never read
  for identities. Streamer-mode players (`nameVisibilityType: HIDDEN`) are shown as "Hidden
  player": their PUUID and name are dropped in the core before any lookup. Tags are positive or
  neutral only (one-trick, win streak, veteran, main role); no "first time", no MMR, no grades of
  other players. LCU endpoints: `GET /lol-gameflow/v1/session`, `GET /lol-summoner/v1/current-summoner`,
  `GET /riotclient/region-locale` (declare at product registration).
- **Window follows the game (not gray, noted for completeness).** Bringing MVP to the front in
  champ select and switching views only moves our own window; both can be turned off, and a view
  the player opened themselves is never switched away from.
- **Build imports: rune page, item set, summoner spells (2026-09-28, built; not yet tried on a
  real client).** Writes into the player's own client, allowed by precedent (Mobalytics, Blitz,
  Porofessor and U.GG write the same endpoints; research E §15–16) when user-triggered or opted
  in. The build is statistics only: the most played options of our Emerald+ aggregates.
  Guard rails:
  - **One click by default, never automatic by default.** Per part (Settings → Imports): off (no
    button, no automation) / one click (Draft's import bar) / on lock-in (opt-in). Parts turned
    off are refused by the core whoever asks.
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
  - **On lock-in means once per lock-in**: not on hovers or pick intents, not again on later
    session events (a trade or an ARAM swap is a new lock). Spells of a lock in a turn's last
    seconds wait for time on the clock. A toast confirms every automatic import, and the Draft
    bar shows it.
  LCU endpoints (declare at product registration): reads `GET /lol-perks/v1/pages`,
  `GET /lol-perks/v1/inventory`, `GET /lol-summoner/v1/current-summoner`,
  `GET /lol-item-sets/v1/item-sets/{summonerId}/sets`, `GET /lol-champ-select/v1/session`,
  `GET /lol-gameflow/v1/session` (queue/map → ranked or ARAM builds),
  `GET /lol-match-history/v1/products/lol/current-summoner/matches` (the local player's Flash key);
  writes `POST /lol-perks/v1/pages` (MVP's page only), `PUT /lol-perks/v1/pages/{id}` (MVP's page
  only), `PUT /lol-perks/v1/currentpage`, `PUT /lol-item-sets/v1/item-sets/{summonerId}/sets`,
  `PATCH /lol-champ-select/v1/session/my-selection` (`spell1Id`, `spell2Id`).
