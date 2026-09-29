# Riot production key: the application

What we send Riot when registering MVP on developer.riotgames.com, kept next to the code so it
stays true as features change (Riot asks for every later change to be declared on the product
page). Requirements and sources: research/E-riot-platform-policies.md §1.13 and §5.4; red lines
and per-feature reasoning: policy.md.

## Before applying (checklist)

- [x] A fully working app, tried end to end on a real client (EUW, 2026-09-28/29: champion
  select, builds and imports, loading-screen scouting, profiles, ARAM and ARAM: Mayhem).
- [x] No Riot API key in the app: the key lives on our server (api.mvpgg.com), which the app asks.
- [x] Riot's legal line in the app (Settings → About) and on every page of the site.
- [x] Name and domain free of Riot trademarks and champion names: MVP, mvpgg.com.
- [ ] **The site live at https://mvpgg.com** with Terms of Service and a Privacy Policy (drafts in
  `site/`, to be reviewed by the owner), then Riot's `riot.txt` at its root to verify the domain.
- [ ] **A public installer**: a first release on GitHub (tagging a version is the owner's call).
- [ ] **A 2–3 minute video** of the user flow: install and first launch, champion select (picks
  with their reasons, the import bar), the loading screen (player cards), a profile and an opened
  game after the match.
- [ ] Re-read Riot's current policy pages (policy.md was written from secondary copies) and check
  which source Riot prefers for the ranked emblems and Mayhem's augment names and icons (both
  from `CommunityDragon` today; policy.md).
- [ ] The product registered under a group (team access), not a personal account.

Reviews took from 6 weeks to 7+ months in 2025–26 (research E §1.13): apply as soon as the site is
up rather than waiting for more features; follow up by support ticket (the portal's Messages tab
is inbound only).

## Product

- **Name:** MVP
- **Website:** https://mvpgg.com · **Source:** https://github.com/Filmoo/MVP (open source, AGPL-3.0)
- **Platform:** Windows desktop app (Tauri), English and French.
- **Price:** free; no ads, no accounts, no analytics.
- **One line:** a League of Legends companion that helps players get better at their own games:
  champion statistics and builds, a champion-select helper that ranks picks with their reasons,
  one-click imports of runes, item sets and summoner spells, loading-screen player cards, and
  profiles with match history.

## What it does, screen by screen

1. **Home:** the player's own profile: rank, recent games from their own client, a grade for
   each finished game with the facts behind it, and the games opened in detail.
2. **Champion select (Draft):** the player's champion and pool ranked by statistics, each option
   with its reasons (never a single "pick this"); team composition readings (damage mix,
   frontline); the build for the chosen champion with an import bar. No ban or dodge advice.
   Only champion-level data about the other nine players: their identities are never read.
3. **Imports:** the build's rune page, item set and summoner spells written into the player's own
   client, on their click, or once by itself at their first lock-in for the parts they switch to
   "Auto import" (after a trade or role swap MVP only warns, with a one-click import). Only MVP's
   own rune page and item set are ever replaced; nothing is deleted.
4. **Loading screen (Live):** once the game has started and the game itself shows every name,
   cards for the ten players (rank, main roles, recent form), looked up on our server by Riot ID.
   Streamer-mode players stay hidden and are never looked up. Nothing during the game: no timers,
   no cooldowns, no alerts.
5. **Champions and Tier list:** per-patch statistics (win, pick and ban rates, builds, matchups)
   computed by our server from Match-V5 games (Emerald and above).
6. **Player pages:** a Riot ID search showing that player's rank and recent games.
7. **ARAM and ARAM: Mayhem:** ARAM builds, the bench ranked in champion select; for Mayhem,
   augment tiers written by hand, popularity from players who opt in (pick rates only, never
   win rates) and each champion's augments ranked with their reasons, shown in champion select
   or as reference; nothing reacts to what the game offers.
8. **Settings:** every automation is off by default (auto-accept, auto imports, crash reports,
   sharing), with what it does and what it sends written next to it.

## Riot API (from our server only)

| API | Endpoint | Used for |
|---|---|---|
| Account-V1 | `/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` | Player search and loading-screen cards (by the Riot ID the player typed or the game shows) |
| Account-V1 | `/riot/account/v1/accounts/by-puuid/{puuid}` | Current Riot ID of a stored player |
| Summoner-V4 | `/lol/summoner/v4/summoners/by-puuid/{puuid}` | Profile icon and level |
| League-V4 | `/lol/league/v4/entries/by-puuid/{puuid}` | Rank on profiles and cards |
| League-V4 | `/lol/league/v4/entries/{queue}/{tier}/{division}`, `/lol/league/v4/{tier}leagues/by-queue/{queue}` | Choosing players whose ranked games feed the aggregate statistics (Emerald+) |
| Match-V5 | `/lol/match/v5/matches/by-puuid/{puuid}/ids`, `/lol/match/v5/matches/{matchId}`, `/lol/match/v5/matches/{matchId}/timeline` | Match histories, opened games, and the aggregate statistics |
| Spectator-V5 | `/lol/spectator/v5/active-games/by-summoner/{puuid}` | Loading-screen cards: the game's players (being built, 2026-09-29) |

Everything is cached on the server (profiles, matches, per-patch statistics published as files);
the crawler for aggregates has its own rate budget and backs off on 429 with `Retry-After`.

## League Client (LCU) endpoints, on the player's own machine

Reads: `GET /lol-gameflow/v1/gameflow-phase`, `GET /lol-gameflow/v1/session`,
`GET /lol-summoner/v1/current-summoner`, `GET /riotclient/region-locale`,
`GET /lol-champ-select/v1/session`, `GET /lol-champ-select/v1/pickable-champion-ids`,
`GET /lol-champion-mastery/v1/local-player/champion-mastery`,
`GET /lol-match-history/v1/products/lol/current-summoner/matches`,
`GET /lol-match-history/v1/games/{gameId}`, `GET /lol-ranked/v1/current-ranked-stats`,
`GET /lol-perks/v1/pages`, `GET /lol-perks/v1/inventory`,
`GET /lol-item-sets/v1/item-sets/{summonerId}/sets`, `GET /lol-matchmaking/v1/ready-check`.
Events: `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`, `OnJsonApiEvent_lol-champ-select_v1_session`.

Writes, all on the player's click or an opt-in they turned on:
`POST /lol-perks/v1/pages` and `PUT /lol-perks/v1/pages/{id}` (MVP's own page only),
`PUT /lol-perks/v1/currentpage`, `PUT /lol-item-sets/v1/item-sets/{summonerId}/sets` (the
player's sets sent back untouched, MVP's set replaced), `PATCH /lol-champ-select/v1/session/my-selection`
(summoner spells), `POST /lol-matchmaking/v1/ready-check/accept` (auto-accept, off by default).

## App notes (the gray areas, declared up front)

- **Rune page, item set and summoner spell imports:** user-triggered by default; a per-part
  opt-in "Auto import" imports once, at the first lock-in of a champion select, and never again
  by itself (a later trade or role swap only shows a warning); only MVP's own page and set are
  replaced; spells never in a turn's last 5 seconds.
- **Auto-accept:** off by default, a visible delay before accepting, never after a decline.
- **Loading-screen scouting:** only once the game has started, never from champion select;
  streamer mode respected (never looked up); positive or neutral tags only, no MMR.
- **Per-game grades:** a transparent score of one finished game's scoreboard, never a player
  rating; never shown in champion select, on the loading screen or in game.
- **ARAM: Mayhem augments:** no win rates; tiers written by hand; popularity from players who
  opt in to share their own games' champions, augments and items, anonymously and without
  results; several options with their reasons before the game, never a single pick, nothing
  read from or triggered by the game's augment offers.
- **Crash reports:** off by default, scrubbed of Riot IDs, PUUIDs and paths before they leave.
