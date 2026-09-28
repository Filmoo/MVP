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
  player": their PUUID and name are dropped in the core before any lookup. Visible players are
  looked up on our backend **by Riot ID** (what the loading screen shows); the client's PUUIDs
  never leave the app (they aren't our API key's anyway), and the backend stores the Riot ID
  next to its own PUUID. Tags are positive or neutral only (one-trick, win streak, veteran,
  main role); no "first time", no MMR, no grades of other players. LCU endpoints: `GET /lol-gameflow/v1/session`, `GET /lol-summoner/v1/current-summoner`,
  `GET /riotclient/region-locale` (declare at product registration).
- **Window follows the game (not gray, noted for completeness).** Bringing MVP to the front in
  champ select and switching views only moves our own window; both can be turned off, and a view
  the player opened themselves is never switched away from.
- **Crash reports (2026-09-28, shipped): data leaving the machine, opt-in only.** Off by default
  (Settings → App → "Send crash reports", with the wording of what is sent). A report holds the
  error (message, stack), the app and OS/webview versions and the random install id, which is not
  linked to the Riot account; never LCU payloads, game data or the Riot account. Scrubbed twice:
  in the app before it leaves and on the server before it's stored (`crates/scrub`: Riot IDs,
  PUUIDs, user names in paths, e-mails, credentials such as the LCU password, IPs). Kept 30 days,
  erasable per install id (shown in Settings once reports are on). Turning reports off deletes
  the ones not sent yet; nothing is written or sent while off.
- **Remote config and self-updates (2026-09-28, shipped).** The app asks our server for its
  config and for updates with its version and install id only (no Riot data). Kill switches can
  only turn features **off**: they stop our own automations (auto-accept today; imports later)
  when a client change makes them misbehave. Updates never download or install during a ready
  check, champ select or a game, and never restart the app without the player's click (else
  they install when MVP quits).
