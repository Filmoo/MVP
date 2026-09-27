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
- **Window follows the game (not gray, noted for completeness).** Bringing MVP to the front in
  champ select and switching views only moves our own window; both can be turned off, and a view
  the player opened themselves is never switched away from.
