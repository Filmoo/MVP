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
