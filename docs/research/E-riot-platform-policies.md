# E — Riot platform: developer policies, Vanguard, LCU, Live Client Data, Riot Web API, static data

**Research date:** 2026-09-27. **Scope:** a Windows-first desktop LoL companion (Rust core) with Porofessor-style live lookups, U.GG/Lolalytics-style stats, a stats-only champ-select helper, rune/item auto-import, match history, and post-game analysis. There is no in-game overlay for now. The goal is to stay fully compliant so the app can get a **production** API key and be published.

**Method and caveats.** I could not fetch developer.riotgames.com, riotgames.com, x.com or reddit, and the web-search budget ran out part-way through. I therefore relied on:
- Riot's own text as copied into public GitHub repos: the LoL docs page, General Policies, API Terms, Legal Jibber Jabber, and full patch-note HTML.
- `RiotGames/developer-relations` GitHub issues.
- The daily-regenerated Riot API OpenAPI spec (`MingweiSamuel/riotapi-schema`, deployed 2026-09-24).
- The LCU swagger dump for patch 26.16 (`KebsCS/lcu-and-riotclient-api`, 2026-08-23).
- Real LCU payload captures.
- Earlier web-search summaries.

Anything single-source, inferred, or not verified against Riot's own text is marked **[?]**. Local copies of the key sources are in `research/E-sources/`.

**Patch numbering note (2026).** In-game patch **26.x** corresponds to Data Dragon **16.x.1**. For example, patch 26.17 is DDragon `16.17.1` and CommunityDragon `/16.17/`. A "16 vs 26" gap is not lag (Amberstone research_E; errorhonko/d README).

---

## 0. TL;DR — the red lines that constrain our feature list

1. **No player-level data for non-party allies in Ranked Solo/Duo champ select.**
   - Names have been hidden since **patch 12.22 (2022-11-16)**: "This information is no longer accessible through third party apps or sites while in Champion Select."
   - Current policy: "Products cannot identify or analyze players who are deliberately hidden by the game."
   - Allowed in Solo/Duo champ select: your own data, your party/duo's data, and **champion-level** stats about visible picks, hovers and bans.
   - Never de-obfuscate. The LCU still ships `obfuscatedPuuid`, which is a trivially reversible XOR mask, and some captures even include `gameName`/`tagLine` for HIDDEN players. Using any of it is a policy violation.
2. **Respect Streamer Mode (patch 25.20, 2025-10-07).** "Hide My Name" and "Hide My Everything/Identifying Info" hide a player "in champ select, in game, and in third party apps." Riot's APIs now return anonymised participants: Spectator-V5 `puuid` is null, and the Live Client Data API has no stable ID. Do not try to re-identify these players.
3. **No enemy cooldown tracking of any kind.**
   - Enemy ultimate timers, manual or automatic, have been banned since **2025-03-13**.
   - Enemy summoner-spell and ability cooldown tracking has been restricted since **patch 25.17 (2025-08-26)**.
   - Also banned: power-spike alerts and notifications that dictate actions ("go gank top").
   - Jungle and objective timers are native since 25.17, and Riot said it is "restricting certain features". Treat them as **avoid**.
4. **No MMR/Elo calculators or estimates.**
   - "Products cannot create alternatives for official skill ranking systems… Prohibited alternatives include MMR or ELO calculators."
   - No dodge advice or auto-dodge. This is inferred from the anonymity intent plus "Apps that dictate player decisions."
   - No shaming tags: "Shame players based on any metric including their recent performance… we don't allow assumptions that could lead to negative preconceptions of a player."
5. **No "game-session-specific information that would be previously unknown to the player."** Also no Arena augment or Arena item win rates, and no Brawl data (blocked since 2025-05-13).
6. **Data sources.**
   - Only Riot's supported services may be used for data ingestion. Scraping op.gg, u.gg or lolalytics risks "indefinite revocation" of API access.
   - Don't use the LCU to bypass Riot API rate limits (community-documented LCU rule).
   - No "data broker" role and no redistribution of Riot data.
   - No historic Riot IDs.
   - Custom-game history only with opt-in or through RSO.
7. **Security.**
   - The API key must never ship in the binary: "Your API key may not be included in your code, especially if you plan on distributing a binary."
   - One product per key. No public app on a personal or dev key, "regardless of how long the approval process for your production key takes."
8. **Monetisation.**
   - A free tier is mandatory (ads allowed).
   - Paid content must be "transformative".
   - Ads must never go into Riot properties: "in-game, loading screens, and the Riot Client". Riot reiterated this in May 2025.
   - No betting, gambling, crypto or NFT.
9. **Branding.**
   - No Riot logos.
   - No Riot trademarks, trade names or **character names** in domain names or social handles (Legal Jibber Jabber §5). The API Terms also forbid "words describing Riot's products or services as the registered URL".
   - Show the mandatory "isn't endorsed by Riot Games" boilerplate.
10. **Vanguard.** No memory reading, DLL injection, hooks or input automation in the game. Only the LCU, Live Client Data API, Replay API and Riot Web API are safe.

**Architecture implications (details in §8):**
- A backend is mandatory. It holds the key, rate-limits per routing value, caches, and runs the stats crawler.
- The production key's **500 req/10 s and 30,000 req/10 min per region** is shared by live lookups and crawling, because a second app to add quota is forbidden.
- PUUIDs are encrypted **per key**. Store the Riot ID next to every PUUID.
- LCU PUUIDs are raw UUIDs and are not API PUUIDs.
- Register the product early and declare every LCU endpoint you use, including writes.
- Plan for a production review of weeks to months. 2026 reports show 3–7+ months pending.

---

## 1. Riot developer policies (state as of 2025–2026)

### 1.1 Documents that bind us, with dates

| Document | Last-updated date seen | Where I read it |
|---|---|---|
| **General Policies** (developer.riotgames.com/policies/general; support-developer article 22698591841939) | **2025-05-29**. A 2026 applicant quotes newer "Please Do / Please Don't" wording read on 2026-08-31 [?] | Copy in `ryblake89/one_trick_book/.../RIOT_API_POLICIES.md`; quotes in `skilledDev96/League-team-comp/docs/riot-production-key-application.md` and `M0nst3rMash/PixeLink` |
| **LoL game policy / docs/lol**: key use-cases, unapproved uses, RSO, LCU, Game Client API | Copies at DDragon 15.12.1 (~Jun 2025), 15.15.1 (~Aug 2025) and 16.10.1 (~May 2026, policy text moved out of the page) | `HermannPR/BlindSpotLOL/docs/LEAGUE_API_DOCUMENTATION_BACKUP.MD`, `Roeschstudio/Lol_RMX_LATAM/RIOTDOCSAPI.md`, `JoshPaulie/nexar/meta/riot_official_docs/lol.md` |
| **Riot Games API Terms** | "LAST UPDATED: DECEMBER 9, 2013" (still cited as current in 2026) | `Kevin-Chant/LoL-ChampionSelectGUI/Riot API Terms and Conditions.txt` |
| **Legal Jibber Jabber** (fan-content / IP policy) | "Last Updated: August 2018" | `craftersmine/Ui.League/LEGAL-JIBBER-JABBER.md` |
| **Riot Support "Third Party Applications"** (player-facing) | Updated 2025-05-29 [?] | Web-search summaries; KotyV research JSON |
| **Vanguard FAQ for Third Party Applications** (riotgames.com/en/DevRel/vanguard-faq) | 2024-04-01 | Quotes in `Remus3/Amberstone` cv_1_capture.md and `KotyV/KRTradToFRLoL` |
| **LCU policy** ("New League Client API Policy" 2018; "Changes to the LCU API Policy" 2019-01-24) | 2019 | Web-search summary; KotyV research |
| **Overwolf "Riot Games compliance" guide** (not Riot, but mirrors Riot's rules for its store) | n/d [?] | Quotes in `luansilvadb/educador_de_fundamentos_lol` 05-RESEARCH.md and `niftymonkey/champ-sage` |

Riot's portal says developers "must adhere to policy changes as they arise." Failure "may result in either suspension or cancellation of your API access or legal recourse."

### 1.2 General policies

Verbatim unless noted. Source: General Policies (2025-05-29) and the "Developer API Policy" block of docs/lol (2025).

- **Core**
  - "Products cannot violate any laws."
  - "Do not create or develop games utilizing Riot's Intellectual Property (IP)."
  - "No cryptocurrencies or no blockchain."
  - **"No apps serving as a 'data broker' between our API and another third-party company."**
  - "Products cannot closely resemble Riot's games or products in style or function."
- **IP assets.** "Only the following Riot IP assets may be used… Press kit (… logos and trademarks … limited to cases where such use is unavoidable in order to serve the core value of the product); Game-Specific static data."
- **Boilerplate.** It must be placed "in a location that is readily visible to players": "[Your Product Name] is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc."
- **Registration.** "If your product serves players, you must register it with us **regardless of whether or not your product uses official documented APIs**. You must make sure its description and metadata are kept up to date." The 2025-05 General Policies add: "Any new features or changes to a product must be audited through the product's page in the Developer Portal" and "Products should use supported services from Riot Games for data ingestion."
- **Security**
  - "Do not use a Production API key to run multiple projects. You may only have one product per key."
  - "Use SSL/HTTPS…"
  - **"Your API key may not be included in your code, especially if you plan on distributing a binary."**
  - Share keys only with teammates, through a portal **group**.
- **Game integrity**
  - "Products must not use or incorporate information not present in the game client that would give players a competitive edge (e.g., automatically or manually allowing tracking enemy ultimate cooldowns)…"
  - "Products cannot alter the goal of the game."
  - "Products cannot create an unfair advantage…"
  - "Products should increase, and not decrease the diversity of game decisions."
  - **"Products should not remove game decisions, but may highlight decisions that are important and give multiple choices."**
  - **"Products cannot create alternatives for official skill ranking systems such as the ranked ladder. Prohibited alternatives include MMR or ELO calculators."**
  - **"Products cannot identify or analyze players who are deliberately hidden by the game."** The May 2025 copy words it as "cannot de-anonymize players who cannot reasonably be identified from visible information."
- **Newer "Please Don't" items** (quoted by 2026 applicants; I could not see the full list [?]):
  - **"Shame players based on any metric including their recent performance. You may honor or glorify players, but we don't allow assumptions that could lead to negative preconceptions of a player."**
  - Data from "any other sources outside of the provided Riot API Endpoints" is forbidden, with the penalty "indefinite revocation of your access to the Riot Games API."
  - "Provide exclusive access, in whole or in part, to specific users."
  - "Publish a project that doesn't properly secure your API key."
  - Products "may not expose a player's historic Riot IDs" (search summary of General Policies).
  - "You may not run your application for public consumption using a personal key, regardless of how long the approval process for your production key takes."
  - "Each project must submit an application and be reviewed separately."
  - Gray areas: "If you have an idea that you think might fall within a gray area feel free ask us… post your question as an App Note within the application."

### 1.3 LoL-specific use-case lists

Source: docs/lol "Game Policy", 2025 copies. The 2026-08-31 applicant quotes the same lists.

- **Examples of approved use cases for production keys**
  - "Showing (self) player stats."
  - "Running tournaments."
  - **"Training tools that allow players to view their own match histories and aggregate stats."**
  - "Looking For Game (LFG) tools."
  - **"Game overlays that provide static data that is available prior to the game."**
  - **"Aggregate player stats (no specific players)."**
  - "Official Ladder Leaderboards."
  - Personal keys: "Personal sites. School projects. Creating a proof of concept for a Production Key request."
- **Unapproved use cases**
  - "Products cannot display win rates for Augments or Arena Mode items. This applies to all websites, applications and overlays."
  - **"Products may not provide any game-session-specific information that would be previously unknown to the player."**
  - **"Apps that dictate player decisions."**
  - "Apps that violate the general game policies."
  - "Products may not publicly display a player's match history from the custom match queue unless the player opts in… Otherwise, a player's custom match data may only be made available to them using RSO."
- **Examples, not an exhaustive list.** Lookups of *other specific players*, such as profile pages and loading-screen scouting, are not on the approved list. They are nonetheless standard in approved products (op.gg, u.gg, Porofessor, Blitz, Mobalytics). Expect scrutiny and frame them around self-improvement [?].

### 1.4 Champion-select anonymisation: timeline and rules

| When | What | Source |
|---|---|---|
| **Patch 12.22, released 2022-11-16 (US)** | "Summoner names are now hidden while in Champion Select in Ranked Solo/Duo Queue. All summoner names that aren't yours or your duo partner's will be replaced by Ally 1 through Ally 5. **This information is no longer accessible through third party apps or sites while in Champion Select.**" | 12.22 patch page (LoL wiki copy in `apg2275/LolWikiRAG`) |
| Region scope | The patch note has **no regional carve-out**, and community sources treat it as global. **KR and Tencent CN specifics are unverified [?].** CN is outside the Riot API anyway. | same; issue #1151 |
| 25.06 (2025-03-18) | Bug fix: "players' anonymized names do not appear in Ranked Champ Select Chat when first joining". Chat is anonymised too. | 25.06 notes |
| 25.S1.3 (≈Feb 2025) → **25.20 (2025-10-07)** | Streamer Mode, then three modes (§1.5) that also hide opted-in players in champ select for *any* queue | 25.20 notes; /dev: Account Linking and Streamer Mode |
| 26.1 (2026-01-07) | Dodge penalties raised (Master+ loses more LP; autofill persists through dodges). This signals Riot is actively fighting dodging. | 26.1 notes |

**What apps may show in champ select now (2026):**

- **Ranked Solo/Duo (queue 420)**
  - Allowed: yourself; your party/duo (they are "de-anonymized to each other", per Overwolf's Riot guide via search summary); **champion-level** analysis of every visible pick, hover and ban (counters, synergies, builds, team-comp stats) with *multiple* options.
  - **Not allowed:** names, ranks, histories, mastery or win rates of non-party allies. Overwolf's guide says: "Apps that reveal player names or stats in Champion Select will be asked to remove this feature immediately" (search summary).
  - Enemies are not known during champ select anyway (only their picks and bans).
- **Ranked Flex, Normal Draft, Clash, custom games**
  - Names are visible (`nameVisibilityType: "VISIBLE"` in samples), so player lookups are allowed in principle.
  - Two exceptions: players in Streamer Mode, and the no-shaming rule [?, no explicit Riot text on Flex].
- **Loading screen and in game**
  - Everyone's Riot ID is visible (Live Client Data `playerlist`), so Porofessor-style scouting is established practice.
  - Streamer-mode players are excluded because they are hidden.
  - This fits "static data that is available prior to the game." Premade detection is a grey area, because it may be "game-session-specific information previously unknown" [?].

**Technical reality of the anonymisation data, which we must not exploit:**
- `/lol-champ-select/v1/session` player objects carry `nameVisibilityType` (`VISIBLE`/`HIDDEN`/`UNHIDDEN`), `puuid`, `summonerId`, `gameName`, `tagLine`, `obfuscatedPuuid` and `obfuscatedSummonerId`.
- In a captured BR1 Solo/Duo session from 2025-07-26, HIDDEN allies had `puuid: ""` and `summonerId: 0`, but **`gameName`/`tagLine` were populated** and an `obfuscatedPuuid` was present (single capture `GustavoRFS/ekko` [?]).
- Open-source tools reverse `obfuscatedPuuid` with a fixed 16-byte XOR mask (`sluucke/drake-lol`, LeagueAkari "deobfuscation").
- "Lobby reveal" tools read the Riot Client `GET /chat/v5/participants` champ-select room. A 2026 tool (`boayusuf/LobbyRevealLoL`) says: "The champ-select session no longer exposes teammates' puuid/summonerId, so we recover identities from the champ-select chat room instead."
- I could not confirm whether Riot has since restricted `/chat/v5/participants` or LCU `/lol-chat/v1/conversations/{cid}/participants`. It is still in the 26.16 Riot Client schema, and a Feb 2025 issue reported reveal "failed to detect teammates" [?].
- **Rule for our code:** when `queueId == 420` and a player's `nameVisibilityType == "HIDDEN"`, drop every identifying field. Never call chat-participant endpoints. Never implement de-obfuscation.

### 1.5 Streamer Mode and "anonymity additions" (2025)

- **25.20 (2025-10-07)** — three modes:
  - "Hide Other Names" is local only.
  - **"Hide My Name: This will hide your RiotID and Game Name to all other players in champ select, in game, and in third party apps"** (progression stays visible).
  - **"Hide My Everything"** also hides progression. 25.23 calls it "Hide My Identifying Info".
- **2025-10-17** — @RiotGamesDevRel announced that it would be "deactivating the Spectator-V5 API for League of Legends to prevent third party applications from deanonymizing players". Post-match APIs such as Match-V5 were stated as not impacted (search summary). A third-party post says Spectator was back on **2025-10-21** [?].
- **2025-10-21** — @LeagueOfLegends said:
  - "Live spectate options on 3rd party sites will be disabled and replaced with enhanced access to replays files via a new endpoint… in Riot API's match endpoint."
  - "Featured games capabilities will also be disabled."
  - "Live games capabilities on 3rd party sites will continue to function but returned results will respect players' streamer mode settings."
  - Sources: quoted in developer-relations issue #1110 and the search summary.
- **25.23 (2025-11-18)**
  - Streamer settings are respected in spectator streams.
  - "shift public spectator experiences towards replays."
  - Leaderboard spectate is replaced by match history/replays.
  - "**Added capability to access replays directly through Riot API**."
- **Current API behaviour (2026)**
  - Spectator-V5 `CurrentGameParticipant.puuid`: "null when the player is anonym." (OpenAPI 2026-09-24.)
  - Live Client Data API: "When multiple players have streamer mode enabled, the Live Game Data API may not provide any reliable identifier for them" (issue #1161, 2026-06-26).
  - Spectator-V5 returns 404 `"filtered"` for Ranked Flex (440) and Arena live games while Solo/Duo works (issue #1162, 2026-06-30; intent unknown [?]).

### 1.6 In-game information rules: timers, cooldowns, notifications

| Item | Status | Date / source |
|---|---|---|
| Enemy **ultimate** timers, manual or automatic | **Forbidden** | Effective **2025-03-13 00:00 PDT** (@RiotGamesDevRel, 2025-03-11). The General Policies example reads "automatically or manually allowing tracking enemy ultimate cooldowns". |
| Enemy **summoner-spell** cooldown tracking or timers | **Forbidden** | Patch **25.17 (2025-08-26)**: "we're going to be updating our Third Party App Policy and restricting certain features… **restrict cooldown-tracking tools from being provided**." Overwolf: "Tracking of enemy summoner spells cooldowns, or facilitating players tracking these with timers". One aggregator removed its "spell/skill tracker overlay… in accordance with Riot's policies". |
| Enemy **ability** cooldown tracking | **Forbidden** | Overwolf compliance list |
| **Power-spike** notifications ("X hit level 6") | **Forbidden** | Overwolf compliance list |
| Notifications that **dictate actions** ("go gank top") | **Forbidden** | Overwolf; LoL policy "Apps that dictate player decisions" |
| **Jungle camp / objective timers** | **Avoid (grey leaning forbidden) [?]** | 25.17 added **native minimap jungle timers** because "Minimap timers are one of the most commonly used 3rd party features" in the same section that announced restricting third-party features. 25.18 (2025-09-09) limited info to 10 s (camps) / 60 s (buffs) before respawn. |
| "Drawing conclusions for you during gameplay", "altering your field of intelligence (zoom hacks, global ult alerts)" | **Forbidden** | Riot Support "Third Party Applications" (search summary; KotyV) |
| In-game **ads** (overlay, loading screen, Riot Client) | **Forbidden** | General Policies: "You may not place advertisements in Riot properties, which include in-game, loading screens, and the Riot Client." Re-announced 2025-05-29 [?]. |

### 1.7 MMR, dodging, automation, imports

- **Hidden MMR / "MMR estimate" / Elo calculator / LP-gain predictor:** forbidden (§1.2). The Riot API exposes no MMR.
- **Dodge recommendations / auto-dodge:** there is no explicit Riot text naming "dodge advice" [?]. It conflicts with the stated purpose of anonymity (reduce bad-faith dodging), with "dictate player decisions", and, when based on teammates, with the anonymity rules. The LCU has `POST /lol-gameflow/v1/session/dodge`. Lobby-reveal authors themselves warn that "automation (auto pick, ban, dodge) can break Riot's Terms of Service". **Treat as forbidden.**
- **Auto-accept (ready check):** no Riot rule found either way [?]. It is shipped by Overwolf-store apps (e.g. "Mimic… Accept matches and manage champ select") and gives no in-game advantage. **Grey:** make it opt-in, off by default, and declare `/lol-matchmaking/v1/ready-check/accept` in the registration.
- **Auto-pick / auto-ban without a user click:** **Grey leaning avoid.** It "removes game decisions" and "takes actions on your behalf" (Riot Support lists "botting or scripting" as a measurable advantage [?]). A user-clicked "hover/lock this" button is safer.
- **Rune / item / summoner-spell import:** allowed by precedent. Mobalytics, Blitz, Porofessor and U.GG write `/lol-perks/v1/pages`, item sets and `my-selection`. No Riot text forbids it, and Riot itself documented item-set files. A 2026 app registration (TrueMain #1680) still lists "is writing a rune page… acceptable?" as unconfirmed by Riot [?]. **Do it on explicit user action or opt-in, and declare the endpoints.**

### 1.8 Overlay rules (for later; no overlay now)

- **Technically allowed** under Vanguard if it does not inject into or hook the game: "Overlays and internal tools using the API, game client, and in-game APIs should continue to function."
- **Content rules** are everything in §1.6, plus "Products cannot closely resemble Riot's games or products in style or function." No ads inside an overlay.
- Overwolf's store adds its own approval gate; Overwolf and Riot approval are both needed there [?].

### 1.9 Scouting and de-anonymisation

**Allowed:**
- Identifying players from **visible** information: Riot IDs shown in loading screen or game, published Clash rosters, tournament fixtures.

**Forbidden:**
- Identifying or analysing hidden players, including champ-select allies (Solo/Duo) and streamer-mode players.
- Exposing historic Riot IDs.
- Correlating post-game data to unmask streamer-mode players mid-game (inferred).
- Using the API to message players: "Sending messages to or communicating with… other users of the Game through Game Information obtained from the Riot Games API" is prohibited (API Terms).

### 1.10 Data retention, privacy, redistribution

- **API Terms (2013)**
  - Publish a privacy policy.
  - "You will only collect the data or information of a user which is necessary for the function of Your application… You will not collect or attempt to collect any personally identifiable information of a Game user through the use of the Riot Games API."
  - Never collect Riot credentials.
  - "You must clearly and conspicuously identify the source of all Game Information as received from Riot. You shall not modify or obscure any aspect of the Game Information."
  - "Upon termination… delete all of the Game Information in Your possession."
  - No redistribution or sublicensing, no reverse engineering, and no "data-mining, scraping, crawling… of the Game and/or Riot Site".
- **No explicit cache TTL or retention period** in the API Terms or policies (per a 2026 read-through [?]).
- **GDPR "Right to be forgotten" DevRel page** exists (riotgames.com/en/DevRel/gdpr-right-to-be-forgotten-compliance). Its content is unverified [?].
  - Practical rule: purge data for PUUIDs that start returning 404.
  - Honour deletion requests.
  - As an EU (NL) developer we are a GDPR controller.
- **Riot-side retention:** Match-V5 match data is kept 2 years ("from three years to two years on a rolling cadence", effective 2019-08-07). Timelines are kept **1 year** (DevRel "match history retention change", quoted in Amberstone research [?]).
  - Consequence: skill-order and timeline-derived stats must be harvested continuously.
  - Match-ID pagination can stop around 500 games (issue #1175, 2026).

### 1.11 Monetisation: must core features be free?

- "You must have a **free tier** of access for players, which may include advertising." "Your content must be **transformative** if you are charging players for it." "Your monetization cannot gouge players or be unfair, as decided by Riot."
- Acceptable ways to charge: "Subscriptions, donations, or crowdfunding"; tournament entry fees; "Currencies that cannot be exchanged back into fiat."
- To monetise, the product must be registered with status **Approved or Acknowledged**. The API Terms add that charging for access to Game Information needs "Riot's prior written approval". Advertising needs no permission.
- **"Core must be free" is not literally in the Riot text I could verify [?].** A search-engine summary paraphrased it as "the core experience cannot be paywalled". Reference apps paywall draft assistants and overlays while keeping match history and builds free (TrueMain #1680).
  - Recommended: keep lookups, own history and basic champ-select stats free; charge only for clearly transformative extras.
  - The "Please Don't: provide exclusive access, in whole or in part, to specific users" line [?] adds uncertainty. Ask in an App Note.
- **No betting or gambling functionality.**

### 1.12 Branding and naming

- **Legal Jibber Jabber §5:** "you may not use any of our logos or trademarks anywhere in your Project… You may not register domain names, social media accounts, or similar stuff that uses Riot Games or any of our trademarks, trade names, character names, etc. You may not use our trademarks or names related to our IP as keywords or internet search tags."
- **API Terms:** do not "use the Riot Marks or words describing Riot's products or services as the registered URL for Your website(s), save as expressly approved in writing by Riot." Do not make an app "similar to Riot's own websites".
- **→ Do not put "League", "LoL", "Riot", champion names, "Summoner's Rift", "Poro" etc. in the product name or domain.** Existing sites with such names may pre-date the rules or hold licences [?].
- Use Data Dragon / CommunityDragon art. "Feel free to use any of our art assets from the game (but NOT any official Logos)" is the paraphrase of LJJ §5 quoted by a 2026 applicant.
- Show both disclaimers somewhere visible: the Developer-policy boilerplate (above) and, optionally, the LJJ line "[Title] was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."

### 1.13 Registration and review (requirements and 2026 reality)

- **Accounts:** one developer account per person ("You may create only one (1) developer account"). Register the product in the Developer Portal, owned by a **group** for team access.
- **Key types**
  - **Development:** auto-issued and "deactivate every 24 hours". For tinkering and prototypes "before the project is made public".
  - **Personal:** needs approval (2026 reports: 3+ weeks pending, issue #1150). Never raised: "won't be approved for rate limit increases". Only for a personal project or "a small private community".
  - **Production:** for public products.
- **Production requirements**
  - Quotes from the portal FAQ (via the Amberstone research doc, 2026-07-28): "Production keys are reserved for fully functioning applications"; "We cannot grant production keys to applications without a verified website"; "We are unable to accept Github repositories and source code in lieu of a functioning application/site"; the site must show **Terms of Service and a Privacy Policy**.
  - Domain verification uses `riot.txt` at the site root.
  - Riot wants to "see the user flow". Provide a "working site, mockup, prototype, or rendering", plus in practice a test account and a walkthrough video.
  - "You may NOT have multiple applications to bypass rate limits."
- **Review time**
  - Official: reviewed weekly, "sometimes… up to three weeks" [?].
  - Reality in 2025–26, from developer-relations issues: 6+ weeks (#1099, 2025-09), 7+ months (#1128, 2026-01), 4+ months (#1168, 2026-07), ~3 months (#1183, 2026-08), and **7+ months since 2026-02-14 with 3 unanswered tickets (#1192, 2026-09-17)**.
  - The portal "Messages" tab is inbound only. The outbound channel is a support ticket.
- **LCU-only products must still register** and describe "which endpoints you're using and how you're using them".
- **Korea:** "For the time being we will no longer allow players in Korea to use applications leveraging the League Client API" (DevRel, 2019-01-24; no repeal found as of mid-2026). The 2018/2019 LCU policy also said "only endpoints on our approved list are allowed". That list is not public anymore [?].
- **China (Tencent servers)** is not covered by the Riot API at all (issue #1151, 2026-04).

---

## 2. Vanguard (2024+) and third-party tools

- **Rollout:** live on LoL since **patch 14.9 (2024-05-01)**, after a pilot. It uses a kernel driver loaded at boot (`vgk.sys`) (KotyV research; LoL wiki [?]).
- **DevRel FAQ, 2024-04-01, verbatim quotes:**
  - "External tools reading memory will no longer work, and you'll need to change methods."
  - "**Overlays and internal tools using the API, game client, and in-game APIs should continue to function.**"
  - "There is absolutely **no allow list** for Vanguard."
  - Paraphrase: "If a tool continues to function after Vanguard is live, it means they have restructured their tool to meet the new guidelines" (quoted in ultronPrototype research [?]).
- **Still works in 2026:**
  - LCU REST and WebSocket.
  - Live Client Data API (`127.0.0.1:2999`).
  - Replay API (documented; `EnableReplayApi=1` in `game.cfg`).
  - Riot Web API.
  - LCU replay download/watch.
  - External screen capture via Windows.Graphics.Capture or DXGI (inference; not named in the FAQ [?]).
  - Separate always-on-top windows.
- **Blocked or risky:**
  - Reading or writing game memory.
  - DLL injection or hooks into `League of Legends.exe`. OBS "Game Capture" hook failures are tracked in obs-studio #11879; use Window or Display capture instead.
  - Vulnerable drivers.
  - Synthesised input or scripting.
  - Riot's Aug 2024 retrospective says incompatible tools are *blocked* (VAN errors) rather than banned, and fail when they "open read handles or set hooks" (KotyV [?]).
- **Implication:** our Rust core must use only loopback HTTPS/WSS to the LCU and port 2999, the Riot Web API through our backend, and files the client writes (replays). No process handles on the game and no input injection.

---

## 3. League Client (LCU) API

**Status per Riot:** "not officially supported for use with third party applications… no guarantees of full documentation, service uptime, or change communication."

### 3.1 Discovery, auth, TLS

- **Lockfile**
  - Path: `<LoL install>\lockfile`, default `C:\Riot Games\League of Legends\lockfile`.
  - Find the install dir from `C:\ProgramData\Riot Games\Metadata\league_of_legends.live\league_of_legends.live.product_settings.yaml` (`product_install_full_path`) or `C:\ProgramData\Riot Games\RiotClientInstalls.json`. See the 2026 Rust example `shepherdjerred/monorepo …/scout-client-core/src/lcu.rs`.
  - Format: `Process:PID:Port:Password:Protocol`, e.g. `LeagueClient:12345:54321:password:https`.
- **Alternative:** read the `LeagueClientUx.exe` command line for `--app-port=` and `--remoting-auth-token=`. HexDocs uses `wmic`, which is deprecated on newer Windows; use WMI/CIM or `NtQueryInformationProcess` [?].
- **Auth:** HTTP Basic with user `riot` and the lockfile password (`Authorization: Basic base64("riot:<pw>")`). Loopback only.
- **TLS:** the certificate chains to Riot's root, `riotgames.pem`.
  - Subject: `CN=LoL Game Engineering Certificate Authority, O=Riot Games`.
  - Valid 2013-12-04 → 2043-11-27.
  - SHA-256 `CA:8C:9D:32:5B:4C:DC:46:4C:6C:94:A5:85:C8:5E:91:EC:23:D4:0B:A5:BF:3A:E2:82:2B:95:1A:4A:50:4E:A3`. Copy in `RiotGames/leaguedirector/resources/riotgames.pem`.
  - Rust clients (Irelia with rustls, Shaco with reqwest) pin it as the only root and connect to `https://127.0.0.1:<port>`. Prefer this over `danger_accept_invalid_certs`.
  - The same root serves the game client on port 2999.
- **Endpoint discovery:** the LCU swagger was removed from the client config in Feb 2022 (issue #608, "closed: unsupported"). Use `/help` and community dumps:
  - **KebsCS/lcu-and-riotclient-api** (lcu.kebs.dev; **26.16 swagger, 2026-08-23**).
  - MingweiSamuel lcu-schema.
  - Needlework.
  - Rift Explorer.

### 3.2 WebSocket event subscription (WAMP 1.0)

- Connect to `wss://127.0.0.1:<port>/` with the same Basic auth header.
- Messages are JSON arrays with opcode first: `5` = subscribe, `6` = unsubscribe, `8` = event.
  - `[5,"OnJsonApiEvent"]` subscribes to everything.
  - Narrower names are `OnJsonApiEvent_` plus the path with `/` replaced by `_`, e.g. `OnJsonApiEvent_lol-champ-select_v1_session` and `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`.
- Events look like `[8,"OnJsonApiEvent",{"data":…,"eventType":"Create|Update|Delete","uri":"/lol-…"}]`.
- You cannot subscribe to all events and then unsubscribe from sub-events. Subscribing to both a sub-event and `OnJsonApiEvent` duplicates events (HexDocs).

### 3.3 Gameflow phases

`GET /lol-gameflow/v1/gameflow-phase` returns one of: `None, Lobby, Matchmaking, CheckedIntoTournament, ReadyCheck, ChampSelect, GameStart, FailedToLaunch, InProgress, Reconnect, WaitingForStats, PreEndOfGame, EndOfGame, TerminatedInError` (26.16 schema). `GET /lol-gameflow/v1/session` gives the full session (`gameData`, `map`, `phase`, `gameDodge`).

### 3.4 Key endpoints (26.16 schema)

| Need | Endpoint(s) | Notes |
|---|---|---|
| Current summoner | `GET /lol-summoner/v1/current-summoner` | `puuid` (**raw UUID**), `gameName`, `tagLine`, `summonerId`, `accountId`, `privacy` (PUBLIC/PRIVATE) |
| Riot ID → puuid | `GET /lol-summoner/v1/alias/lookup?gameName=&tagLine=` | Returns `{alias, puuid}` (raw) |
| Summoner by puuid | `GET /lol-summoner/v2/summoners/puuid/{puuid}`, `/lol-summoner/v1/summoners-by-puuid-cached/{puuid}` | |
| Champ select | `GET /lol-champ-select/v1/session`, `…/session/timer`, `GET/PATCH …/session/my-selection` (`spell1Id`, `spell2Id`, `selectedSkinId`), `PATCH …/session/actions/{id}` + `POST …/{id}/complete` (pick/ban) | See §3.5. Don't automate actions. |
| Rune pages | `GET/POST/DELETE /lol-perks/v1/pages`, `GET/PUT/DELETE /lol-perks/v1/pages/{id}`, `GET/PUT /lol-perks/v1/currentpage`, `/lol-perks/v1/inventory` (page slots), `/perks`, `/styles`, Riot's own recommender (`/recommended-pages/champion/{id}/position/{pos}/map/{map}`) | Page body: `name`, `primaryStyleId`, `subStyleId`, `selectedPerkIds[9]`, `current` |
| Item sets | `GET/POST/PUT /lol-item-sets/v1/item-sets/{summonerId}/sets`, `POST …/validate` | Legacy alternative: JSON files in `Config\Champions\<key>\Recommended\` (HexDocs "Item Sets") |
| Summoner spells | `PATCH /lol-champ-select/v1/session/my-selection` | |
| Match history (any raw puuid) | `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=&endIndex=`, `…/current-summoner/matches`, `GET /lol-match-history/v1/games/{gameId}`, `…/game-timelines/{gameId}` | **Policy:** don't use to bypass Riot API limits or for bulk ingestion (§3.6). May be affected by profile privacy [?]. |
| Ranked stats (any raw puuid) | `GET /lol-ranked/v1/ranked-stats/{puuid}`, `/lol-ranked/v1/current-ranked-stats`, `/league-ladders/{puuid}` | Same caveat |
| Lobby / queue / ready check | `/lol-lobby/v2/lobby`, `POST|DELETE /lol-lobby/v2/lobby/matchmaking/search`, `GET /lol-matchmaking/v1/ready-check`, `POST …/ready-check/accept`, `…/decline` | |
| End of game | `GET /lol-end-of-game/v1/eog-stats-block`, `/lol-end-of-game/v1/gameclient-eog-stats-block` | Players include `puuid`, `riotIdGameName`, `items`, `stats`, and also `leaver`, `wasAfk`, `severeTransgressor`. **Do not surface behaviour flags** (no-shaming rule). |
| Replays | `/lol-replays/v1/configuration`, `/metadata/{gameId}`, `POST /rofls/{gameId}/download`, `POST /rofls/{gameId}/watch`, `/rofls/path` | Own games; `.rofl` payload is obfuscated, so deep parsing is reverse-engineering and should be avoided |
| Spectate | `POST /lol-spectator/v1/spectate/launch` (`puuid`, `spectatorKey`…), `/lol-spectator/v3/buddy/spectate`, `/v3/buddy/can-spectate/{puuid}/{spectatorKey}` | Friends/buddy flow. Third-party live spectating was disabled in Oct 2025. |
| Dodge | `POST /lol-gameflow/v1/session/dodge` | **Do not use** |

### 3.5 Champ-select session fields (what's hidden in Ranked)

- **Session:** `myTeam[]`, `theirTeam[]`, `actions[][]`, `bans{myTeamBans, theirTeamBans, numBans}`, `timer{phase: PLANNING|BAN_PICK|FINALIZATION…, adjustedTimeLeftInPhase…}`, `localPlayerCellId`, `queueId`, `isCustomGame`, `benchChampions` (ARAM), `chatDetails` (MUC JWT), plus trade/swap contracts.
- **Player selection:** `cellId`, `assignedPosition`, `championId`, `championPickIntent` (hover), `spell1Id/2Id`, `selectedSkinId`, `team`, `isAutofilled`, `gameName`, `tagLine`, `puuid`, `summonerId`, `nameVisibilityType`, `obfuscatedPuuid`, `obfuscatedSummonerId`, `playerAlias`, `isHumanoid`.
- **Ranked Solo/Duo observed:**
  - Non-party allies have `nameVisibilityType=HIDDEN`, empty `puuid`, `summonerId=0`, and a non-empty `obfuscatedPuuid`.
  - Self and party show `UNHIDDEN` with a real `puuid`.
  - `theirTeam` is fully blank until the game.
- **Flex/normal samples** show `VISIBLE` with puuids and names.
- There are also `/lol-lobby-team-builder/champ-select/v1/session/obfuscated-puuids` and `…/obfuscated-summoner-ids`. **Don't use them.**

### 3.6 Restricted, removed or sensitive LCU surfaces

- LCU swagger was removed (Feb 2022).
- Summoner-name lookups were replaced by the Riot ID alias lookup after the 2023 Riot ID migration.
- `/lol-career-stats/v1/summoner-games/{puuid}` returns 404 (2021, #495).
- Champ-select names were removed from `puuid`/`summonerId` for hidden players. The chat room remains a known de-anonymisation vector (§1.4); **its status is unverified [?]**.
- Leaderboard spectating was replaced by replays (25.23).
- Profile privacy exists: `GET/PUT /lol-summoner/v1/current-summoner/profile-privacy` (`PRIVATE`/`PUBLIC`) and `/profile-privacy-enabled`. Exact effects [?]. Respect it.
- **LCU policy constraints (community-documented, HexDocs):** "You're not allowed to use the LCU APIs to bypass the rate limiting that's enforced on the Riot Games API. **If an API exists both in the Riot API and the LCU API, you must use the Riot API.**" and "You must register your LCU app on the developer portal even if you don't plan on using the Riot Games API."
- **Korea:** LCU apps disallowed (§1.13).

---

## 4. Live Client Data API (`https://127.0.0.1:2999`)

- **Riot:** "The Game Client APIs are served over HTTPS by League of Legends game client and are only available locally for native applications." Uses the same self-signed root (`riotgames.pem`). No auth. Swagger at `/swagger/v2/swagger.json` and `/swagger/v3/openapi.json`.
- **Endpoints** (docs/lol 2025–2026):

  | Endpoint | Returns |
  |---|---|
  | `/liveclientdata/allgamedata` | Superset of everything below |
  | `/activeplayer`, `/activeplayername`, `/activeplayerabilities`, `/activeplayerrunes` | Local player: full `championStats`, gold, level, `fullRunes`, `riotId` |
  | `/playerlist` (`?teamID=ORDER\|CHAOS`) | All 10 players: `championName`, `items[]`, `level`, `position`, `respawnTimer`, `isDead`, `runes` (keystone and trees), `scores` (K/D/A, CS, ward score), `summonerSpells`, `skinID`, `team`, `riotId` / `riotIdGameName` / `riotIdTagLine` |
  | `/playerscores?riotId=`, `/playersummonerspells?riotId=`, `/playermainrunes?riotId=`, `/playeritems?riotId=` | Per player |
  | `/eventdata` (`?eventID=N` for incremental) | GameStart, MinionsSpawning, FirstBrick, TurretKilled, InhibKilled, DragonKill, HeraldKill, BaronKill, ChampionKill (`KillerName`, `VictimName`, `Assisters`), Multikill, Ace… |
  | `/gamestats` | `gameMode`, `gameTime`, `mapName`, `mapNumber`, `mapTerrain` |

  RPC-style aliases also exist, e.g. `/GetLiveclientdataAllgamedata?eventID=` (used by Shaco).
- **Not available:**
  - Enemy cooldowns, enemy gold, enemy ability levels, positions or fog-of-war data.
  - Chat.
  - Augment offers.
  - Stable IDs for streamer-mode players (#1161).
  - `activeplayer` errors in spectator mode.
- **Availability:** the port answers during the loading screen (`HEAD /Help` works), but data endpoints generally error until the local game has loaded.
  - `gameTime` sits around 0.02 until the game starts; community code uses `gameTime > 0.1` as the start signal (Shaco/Irelia).
  - Some tools report `playerlist` from the loading screen onward [?].
- **Update frequency:** undocumented. It is a pull API with no push or websocket. Community clients poll every **500 ms–1 s** (Shaco default 500 ms) and fetch events incrementally with `eventID` [?].
- **Restrictions:** Riot policy restricts what we may *derive* from it, not the API itself. No cooldown timers, no power-spike alerts, no dictated actions, no in-game conclusions (§1.6). A deliberately conservative 2026 design (J-Pantaroto/Sparta) reads only own-player data and treats `playerlist` as "needs Riot review". That is stricter than Riot's text [?].
- The Game Client API section of the docs carries **no** "unsupported" disclaimer. That disclaimer applies to the LCU section.

---

## 5. Riot Web API (developer.riotgames.com)

### 5.1 Routing

- **Platform hosts** (current spec, 2026-09-24): `br1, eun1, euw1, jp1, kr, la1, la2, me1, na1, oc1, ru, sg2, tr1, tw2, vn2` (+ `pbe1`).
  - `ph2` and `th2` were **merged into `sg2` on 2025-01-08** (Riven `route.rs`).
  - `me1` (Middle East) is new.
- **Regional hosts:** `americas, asia, europe, sea`.
  - Match-V5 mapping: `NA1/BR1/LA1/LA2 → americas`; `KR/JP1 → asia`; `EUW1/EUN1/TR1/RU/ME1 → europe`; `OC1/SG2/TW2/VN2 → sea`.
  - **Account-V1 serves only `americas/asia/europe`**, and any of them returns the same data.
  - `GET /riot/account/v1/region/by-game/{lol|tft}/by-puuid/{puuid}` discovers a player's platform.

### 5.2 What each API gives (paths from the 2026-09-24 spec)

| API | Routing | Endpoints / content |
|---|---|---|
| **Account-V1** | regional | `by-riot-id/{gameName}/{tagLine}` → `{puuid, gameName, tagLine}`; `by-puuid/{puuid}`; `accounts/me` (RSO); `active-shards/by-game/{game}/by-puuid`; `region/by-game/{game}/by-puuid` |
| **Summoner-V4** | platform | Only **`by-puuid/{puuid}`** and **`/me` (RSO)** remain. By-name, by-summonerId and by-account are gone. DTO: `puuid`, `profileIconId`, `revisionDate`, `summonerLevel`; `id` is "deprecated and will be removed" and is no longer returned since ~mid-2025 (#1092, #1085). |
| **League-V4** | platform | `entries/by-puuid/{puuid}` (by-summoner removed); `entries/{queue}/{tier}/{division}`; challenger/grandmaster/master leagues by queue. Entry: tier, rank, LP, W/L, hotStreak, veteran, freshBlood, inactive, `puuid`. |
| **League-Exp-V4** | platform | `entries/{queue}/{tier}/{division}?page=` (all tiers incl. apex; ladder crawling). `summonerId` still documented but no longer returned (#1085). |
| **Match-V5** | regional | `by-puuid/{puuid}/ids` (start, count ≤ 100, queue, type ranked/normal/tourney/tutorial, startTime/endTime; timestamps since 2021-06-16); `matches/{matchId}` (≈159 participant fields incl. `riotIdGameName`, `riotIdTagline`, `teamPosition`, `challenges`, `missions`, `roleBoundItem`, `PlayerBehavior`); `…/timeline`; **new `by-puuid/{puuid}/replays` → `{total, matchFileURLs[]}`** (added ~25.23, 2025-11; URL lifetime and game coverage [?]). **Brawl** matches are 403 (announced 2025-05-13; #1075). ARAM: Mayhem returned 403 in Oct 2025 and was later "closed: is working" (#1109). |
| **lol-rso-match-v1** | regional, **RSO token** | `matches/ids`, `matches/{id}`, `timeline`. "Includes custom matches." For the signed-in player only. |
| **Spectator-V5** | platform | `active-games/by-summoner/{encryptedPUUID}` → `gameId`, `gameQueueConfigId`, `bannedChampions`, `participants[]` (`championId`, `perks`, spells, `teamId`, `riotId`, `puuid` **null if anonymous**), `observers.encryptionKey`. **Featured games are gone.** Live 3rd-party spectating was disabled Oct 2025. Some queues return 404 "filtered" (Flex, Arena; 2026-06, #1162). Still used by production apps in 2026 (#1169). |
| **Champion-Mastery-V4** | platform | By-puuid: all, by-champion, top, score. DTO has level, points, `lastPlayTime`, `markRequiredForNextLevel`, `championSeasonMilestone`, `milestoneGrades`… |
| **Challenges-V1** | platform | Config, percentiles, per-challenge config, leaderboards by level, `player-data/{puuid}` |
| **Clash-V1** | platform | `players/by-puuid/{puuid}`, `teams/{teamId}`, `tournaments`, by-team, by-id |
| Others | | Champion-V3 rotations, LoL-Status-V4, Tournament(-stub)-V5 (Tournament API needs separate access and the tournament policy: ≥ 20 participants, ≥ 70% of fees to prizes) |

### 5.3 Rate limits (per key, **per routing value**)

| Key | App limit | Notes |
|---|---|---|
| Development | **20 req / 1 s and 100 req / 2 min** | Expires every **24 h**. The API Terms (2013) still say "A Development Key shall not be permitted to make more than ten (10) network calls every ten (10) seconds". The portal and headers show 20/1 + 100/120. |
| Personal | **20 / 1 s and 100 / 2 min** (header `20:1,100:120`, confirmed 2026-09-13) | No expiry. Never raised. Not for public products. |
| Production | **500 / 10 s and 30,000 / 10 min** (header `500:10,30000:600`) | Plus **method limits** that often bind first: `account-v1` `1000:60` (≈16.7 req/s); `spectator-v5` `3000:10,180000:600`; match-v5 `2000:10` reported [?]. Method limits are undocumented, so read `X-Method-Rate-Limit` live. |

- **Mechanics:** app, method and service limits apply together. 429 responses carry `Retry-After` and `X-Rate-Limit-Type`. A 429 **without** the type comes from the underlying service: back off (e.g. 1 s) and treat it as covering the whole routing value.
- Service limits are **shared by all apps**, and a new `X-Rate-Limit-Type: server` was observed in 2026 (#1169).
- Repeated violations or calls to non-existent resources lead to blacklisting (all calls return 403), escalating to permanent.
- **Budget reality:** a Porofessor-style 10-player scout costs about 90 calls cold (League Live Scout estimate). At 50 req/s per region that is roughly 0.5 cold scouts/s per region before caching. This budget is shared with any stats crawler under the same product.

### 5.4 Production key application (process)

1. Register the product: description, APIs used, LCU endpoints used, and how.
2. Build a hosted site on our own domain with ToS, Privacy Policy and the Riot boilerplate. Verify it with `riot.txt`.
3. Provide a working, testable product or prototype, a test account, and a short user-flow video showing onboarding, the champ-select helper, lookups and post-game. Declare grey areas as App Notes.
4. Wait. Follow up by support ticket. The Messages tab is inbound only.
5. Every later feature change must be re-audited through the product page.

### 5.5 RSO (Riot Sign-On)

- "This access is only available to developers with Production Level API Keys." After production approval Riot starts RSO onboarding. In 2026 this runs through an **invite link to an "App Request Form (RSO)" on beta.developer.riotgames.com**; the form returned HTTP 500 in Aug 2026 (#1181).
- OAuth2 authorization-code flow at `https://auth.riotgames.com/authorize?…&scope=openid+offline_access`. Client authentication is client-secret-basic or private-key-JWT, so the **backend must hold the secret**. Then `/riot/account/v1/accounts/me` and `/lol/summoner/v4/summoners/me`.
- **Indie apps can get it**, but only after the production review and a second approval. RSO unlocks custom-game history (rso-match-v1) and verified "this is me" account linking.

### 5.6 PUUID encryption and identity mapping

- "**All encrypted values are unique per API Key holder**… the values for account ID, PUUID and id would be different for each key holder, for a given player" (Riot quote reproduced in `shepherdjerred/monorepo`, 2026).
- API PUUIDs are "Exact length of 78 characters". They are stable across regions for one key, but **change when you move dev → personal → production**; one 2026 project had to run a full re-mapping migration.
- **LCU PUUIDs are raw 36-char UUIDs** and are *not* accepted as API PUUIDs [?, consistent with every source]. The Live Client Data API exposes only Riot IDs.
- Mapping path: LCU or Live Client **Riot ID → Account-V1 `by-riot-id` → API PUUID** (key-scoped). **Always store `gameName#tagLine` next to each PUUID** so re-resolution is possible.

### 5.7 Riot ID vs summoner names

- Riot ID (`gameName#tagLine`) became authoritative with the migration starting **2023-11-20**. Front ends must search by Riot ID.
- Summoner names became random UUIDs for new accounts, and the `by-name` endpoints have since been **removed** (absent from the 2026 spec).
- `summonerId` and `accountId` are deprecated and removed from responses (2025). **Key everything on PUUID and Riot ID.**

### 5.8 Change log relevant to us (2025–2026)

| Date | Change |
|---|---|
| 2025-01-08 | PH2 and TH2 merged into SG2 |
| 2025-03-13 | Enemy ult timers banned |
| 2025-05-13 | Brawl data not available to third parties |
| 2025-05-29 | General Policies updated; ads-in-Riot-properties rule restated [?] |
| ~2025-06 to 08 | `summonerId` removed from League/Summoner responses |
| 2025-08-26 (25.17) | Native jungle timers; summoner-spell cooldown tracking restricted; third-party app policy update announced |
| 2025-10-07 (25.20) | Streamer mode hides players from third-party apps |
| 2025-10-17 → 21 | Spectator-V5 deactivated then restored with anonymity; featured games and 3rd-party live spectate removed |
| 2025-11-18 (25.23) | Replays via Riot API (`match-v5 getReplay`) |
| 2026-01-07 (26.1) | Harsher dodge penalties |
| 2026-06 | Flex/Arena spectator "filtered" |
| 2026-09-24 | OpenAPI spec snapshot used here |

---

## 6. Static data: Data Dragon vs CommunityDragon

| | **Data Dragon (Riot, official)** | **CommunityDragon (community)** |
|---|---|---|
| What | Per-patch JSON: `champion.json`, `champion/{Id}.json` (spells, `effect`/`vars` placeholders, skins), `item.json` (base `stats`, `from`/`into`, gold), `runesReforged.json` (trees and runes, prose only, **no stat shards**), `summoner.json`, `profileicon.json`, `languages.json`; images for champion square/passive/ability, splash and loading (unversioned path), items, spells, profile icons, maps, sprites; a full `dragontail-<ver>.tgz` per patch; queue/map/mode constants JSON | Everything extracted from the LCU and game files: `raw.communitydragon.org/{latest\|pbe\|16.17}/plugins/rcp-be-lol-game-data/global/default/v1/…` (champion-summary, champions/{id}, items, perks (incl. **stat shards**), perkstyles (tree topology), summoner-spells, queues, maps, profile-icons, challenges, `cherry-augments.json` for Arena and Mayhem), `game/…` bin-derived JSON and HUD icons; JSON directory listing via the `/json/` prefix; `/pbe/` gives pre-patch warning |
| Versioning | `https://ddragon.leagueoflegends.com/api/versions.json` (newest first); per-region live version in `realms/{na\|euw…}.json`. "Updating Data Dragon after each League of Legends patch is a manual process, so it is not always updated immediately" (can lag ~1–2 days). Multiple builds per patch are possible, so "always use the most recent Data Dragon version for a given patch". 2026 versions look like `16.17.1` (patch 26.17). | Folders per patch (`/16.17/`) and `latest`. Refreshed within hours (status.live.txt showed a same-day rebuild on 2026-07-28). No SLA. Older CDN (`cdn.communitydragon.org`) "will be deprecated". |
| Quality notes | Tooltips use `{{ e1 }}` / `{{ a1 }}` placeholders; ability numbers are unreliable; item passives are only in HTML descriptions | No numeric rune values anywhere (prose only); `items.json` has no `stats` object (use DDragon for item stats). Riot's static `queues.json` and `gameModes.json` are stale (queue 1750 missing, #1159), so CDragon queues/maps are more current. |
| Terms | Explicitly allowed ("Game-Specific static data"); covered by the Developer Policies and LJJ; no logos | "CommunityDragon was created under Riot Games' 'Legal Jibber Jabber' policy… Riot Games does not endorse or sponsor this project… **acknowledged by Riot through the Riot Developer Portal. The usage of CommunityDragon does not pose a risk to your API key.**" |

**Best practices:**
- Resolve the version from `versions.json` and `realms` at startup and periodically.
- Cache data and images per version in our backend or CDN, and ship a local cache in the app. Don't hotlink at scale; Meraki's README asks users to "cache it on your own servers".
- Map numeric champion IDs from the LCU and API to DDragon `key`.
- Use CDragon for stat shards, Arena data and current queues. Use DDragon for item stats.
- Show the attribution notice.
- Don't redistribute bulk data dumps as a product.

---

## 7. Candidate features: ALLOWED / GRAY / FORBIDDEN

Legend:
- **ALLOWED**: explicit Riot text or long-standing approved precedent.
- **GRAY**: not addressed, or wording ambiguous. Ask in an App Note, keep opt-in, or skip.
- **FORBIDDEN**: explicit rule, or direct conflict with one.

| # | Feature | Verdict | Basis / conditions |
|---|---|---|---|
| 1 | Own profile, match history, rank, mastery (Riot API) | **ALLOWED** | "Showing (self) player stats"; "Training tools… own match histories" |
| 2 | Post-game analysis of own games (match + timeline, EoG block) | **ALLOWED** | Same. Don't surface others' `leaver`/`severeTransgressor` flags. |
| 3 | Aggregate champion stats (win/pick/ban by patch, rank, role; builds; matchups; tier list) computed from our own Match-V5 crawl | **ALLOWED** | "Aggregate player stats (no specific players)". Needs a production key and backend crawler. |
| 4 | Stats bought or scraped from u.gg, op.gg, lolalytics | **FORBIDDEN** | "sources outside of the provided Riot API Endpoints" → revocation; API Terms no scraping |
| 5 | Arena augment or Arena item **win rates** | **FORBIDDEN** | Explicit. Popularity or pick rate is an unverified grey [?]. |
| 6 | Brawl stats | **FORBIDDEN** (data 403) | DevRel 2025-05-13 |
| 7 | Profile lookup of any player by Riot ID (op.gg-style) | **ALLOWED (precedent)** | No historic Riot IDs; no public custom-game history without opt-in; no shaming; respect streamer mode during games |
| 8 | Solo/Duo champ select: champion-level suggestions (counters, synergies, bans, comp analysis) with **several** options and evidence | **ALLOWED** | "highlight decisions… give multiple choices" |
| 9 | Champ select: single "you must pick X" instruction | **GRAY → avoid** | "Apps that dictate player decisions" |
| 10 | Solo/Duo champ select: own and **party** player stats | **ALLOWED** | Party is de-anonymised to each other |
| 11 | Solo/Duo champ select: non-party ally names, ranks, histories, win rates | **FORBIDDEN** | 12.22 note; "cannot identify or analyze players who are deliberately hidden" |
| 12 | Using `obfuscatedPuuid`, hidden `gameName`, chat-participant reveal | **FORBIDDEN** | De-anonymisation |
| 13 | Flex / Normal Draft champ select: teammate lookups (names visible) | **ALLOWED (precedent) [?]** | Skip streamer-mode players; no shaming |
| 14 | Dodge advice / "dodge score" / auto-dodge | **FORBIDDEN** (inferred + automation) | Anonymity intent; dictates decisions; dodge endpoint automation |
| 15 | Auto-import runes (`/lol-perks`) | **ALLOWED (precedent)** | User click or opt-in; declare endpoints; respect page slots |
| 16 | Import item sets / summoner spells | **ALLOWED (precedent)** | Same |
| 17 | Auto-accept ready check | **GRAY** | Not addressed; shipped by Overwolf-store apps; opt-in, off by default |
| 18 | Auto-hover / auto-lock pick, auto-ban without a click | **GRAY → avoid** | "should not remove game decisions"; "actions on your behalf" |
| 19 | Loading-screen / in-game scouting of all 10 players (rank, champ WR, mastery, recent form) | **ALLOWED (precedent)** | "static data… available prior to the game"; must skip anonymised players |
| 20 | Premade / duo detection among opponents | **GRAY** | Possibly "game-session-specific information previously unknown" [?] |
| 21 | Positive tags (OTP, hot streak, veteran, mastery) | **ALLOWED** | "You may honor or glorify players" |
| 22 | Negative tags (tilted, inting, troll, loss-streak, "bad at X") | **FORBIDDEN** | "Shame players… negative preconceptions" |
| 23 | "Smurf" / "boosted" labels | **GRAY → avoid** | Assumption about a player |
| 24 | MMR / Elo estimate, "hidden MMR", LP-gain predictor | **FORBIDDEN** | Explicit |
| 25 | Average of *visible* lobby ranks | **GRAY** | Fine if not presented as MMR [?] |
| 26 | Enemy ult timers (manual or auto) | **FORBIDDEN** | Since 2025-03-13 |
| 27 | Enemy summoner-spell or ability timers | **FORBIDDEN** | 25.17; Overwolf |
| 28 | Jungle camp / objective timers | **GRAY → avoid** | Native since 25.17; Riot "restricting certain features" |
| 29 | Power-spike alerts; "go do X now" prompts; jungler path or fog inference | **FORBIDDEN** | Overwolf list; LoL unapproved uses |
| 30 | In-game companion-window build suggestions (static or popularity based) | **ALLOWED / GRAY** | Static pre-game builds are fine. Adaptive in-game "conclusions" are grey (Riot Support "drawing conclusions for you during gameplay"). |
| 31 | Team gold difference derived from visible items | **GRAY** | Derived info [?] |
| 32 | In-game overlay (future) | **GRAY** | Technically allowed without injection; all content rules apply; no ads |
| 33 | Ads in our own app window (free tier) | **ALLOWED** | "free tier… may include advertising" |
| 34 | Ads in overlay, loading screen or client | **FORBIDDEN** | General Policies |
| 35 | Premium subscription for transformative extras plus a free tier | **ALLOWED** | Status Approved/Acknowledged; Riot approval to charge |
| 36 | No free tier / paywalling raw Riot data | **FORBIDDEN / GRAY** | Free tier mandatory; "transformative" requirement |
| 37 | Betting, gambling, crypto, NFT | **FORBIDDEN** | Explicit |
| 38 | Export or sell data feeds / public API of our crawl | **FORBIDDEN** | "data broker"; API Terms no redistribution |
| 39 | LCU bulk fetch of others' history or ranks to spare API quota | **FORBIDDEN** | LCU rule "must use the Riot API"; "supported services for data ingestion" |
| 40 | API key embedded in the desktop app | **FORBIDDEN** | Explicit |
| 41 | "Bring your own dev key" for public users | **FORBIDDEN (not viable)** | Dev keys expire in 24 h; no public use on personal/dev keys |
| 42 | Historic Riot IDs / name history | **FORBIDDEN** | General Policies |
| 43 | Public custom-game history | **FORBIDDEN** unless player opt-in; own via RSO **ALLOWED** | LoL policy |
| 44 | "Watch live" links for arbitrary players (spectator keys) | **GRAY → avoid** | 3rd-party live spectate disabled (2025-10) |
| 45 | Replays: LCU download/watch own games; Match-V5 replay URLs | **ALLOWED [?]** | Official endpoints |
| 45a | Replays: deep `.rofl` packet decoding | **GRAY → avoid** | API Terms anti-reverse-engineering |
| 46 | Memory reading, DLL injection, client UI injection (Pengu-style), input automation in game | **FORBIDDEN** | Vanguard FAQ; API Terms "modify the Game"; KR |
| 47 | LLM coaching that sends Riot data to a third-party AI provider | **GRAY [?]** | No Riot text found. Consider "data broker" and "transmit… not authorized" clauses. Disclose in the application; send the minimum, anonymised. |
| 48 | Messaging players found via the API | **FORBIDDEN** | API Terms |
| 49 | Product name or domain with "League", "LoL", "Riot", champion names | **FORBIDDEN** without written approval | LJJ §5; API Terms |
| 50 | KR server support for LCU features | **FORBIDDEN / GRAY [?]** | 2019 KR LCU ban; gate by region until Riot confirms |

---

## 8. Architecture implications

1. **Mandatory backend ("API gateway")**
   - It holds the production key and, later, the RSO client secret.
   - It exposes only product-specific endpoints to the desktop app, never a generic proxy (a generic proxy would be a "data broker" risk).
   - It authenticates app installs, with abuse throttling per install and IP.
2. **Rate limiting per routing value, learned from headers**
   - Keep one budget per platform or region. Adopt `X-App-Rate-Limit` and `X-Method-Rate-Limit` live.
   - Honour `Retry-After`. Treat a type-less 429 as a service limit.
   - Use priority queues: interactive lookups first, crawler last.
   - Remember the production key is one budget shared by live scouting and stats crawling. A second "product" for extra quota is prohibited.
3. **Caching**
   - Per-PUUID TTLs (rank ~minutes; match IDs ~minutes during a session). Match details are immutable, so cache them forever within the retention policy.
   - Share cache across users (e.g. lookups of the same players).
4. **Identity model**
   - Key everything on API PUUID plus stored `gameName#tagLine`. Plan a PUUID migration for each key change (dev → personal → production).
   - The client sends Riot IDs, never LCU raw PUUIDs, to the backend.
   - Region discovery uses `account-v1 region/by-game`.
5. **Local Rust core (no key)**
   - LCU client: lockfile or process discovery, Basic auth, `riotgames.pem` pinning, WAMP subscriptions to gameflow, champ-select, EoG and ready-check.
   - Live Client Data poller at 0.5–1 s with an incremental `eventID`.
   - A **policy filter module**: queue 420 + HIDDEN strips identities; streamer-mode players are never scouted; no enemy-cooldown features; the list of LCU endpoints is compiled in and matches the registration.
6. **Stats pipeline**
   - Ladder crawl (League-Exp-V4) → match IDs → matches and timelines → aggregate counters per patch, rank, role and matchup.
   - Store aggregates only and drop raw data per a retention policy.
   - Timelines expire after 1 year at Riot, so ingest continuously.
7. **Static data service**
   - Mirror DDragon and CDragon per version to our CDN. The app gets a version manifest from the backend.
8. **Compliance artefacts**
   - Hosted site with ToS, Privacy Policy (GDPR: purpose, retention, deletion on request, purge of 404 PUUIDs), Riot boilerplate, `riot.txt`.
   - Product registration listing every Riot API and LCU endpoint, including writes (`/lol-perks/v1/pages`, `/lol-item-sets/…`, `my-selection`, `ready-check/accept`).
   - App Notes for the grey areas.
   - Region gating (KR LCU; CN unsupported).
9. **Timeline risk**
   - Build on a personal key for a private beta ("small private community"). Apply for production **early**, because 2026 waits run 3–7+ months.
   - Nothing public goes live on a personal key.

---

## 9. Questions to put to Riot as App Notes

1. Auto-accept (opt-in), and one-click rune, item and spell writes via the LCU: confirm allowed.
2. Which features may be premium, given the free-tier and "transformative" rules and "exclusive access"?
3. Flex / Normal Draft teammate lookups in champ select, and premade detection in loading screen: allowed?
4. Average visible lobby rank: acceptable, or treated as an MMR alternative?
5. Jungle and objective timers in a companion window (not an overlay): allowed after 25.17?
6. Sending anonymised match data to an LLM provider for post-game coaching.
7. Is the 2019 Korea LCU restriction still in force?
8. Is the "approved LCU endpoint list" still maintained, and which endpoints are on it?

---

## 10. Sources

Access date is 2026-09-27 unless stated. [S] marks a web-search summary only; I could not fetch the page.

**Riot primary text (via GitHub copies, patch notes, or issues)**
- General Policies (last updated 2025-05-29), copy: https://github.com/ryblake89/one_trick_book/blob/HEAD/migration_plans/pre_launch_security_audit/RIOT_API_POLICIES.md ; official: https://developer.riotgames.com/policies/general , https://support-developer.riotgames.com/hc/en-us/articles/22698591841939-General-Policies [S]
- LoL developer docs and game policy copies: https://github.com/HermannPR/BlindSpotLOL/blob/HEAD/docs/LEAGUE_API_DOCUMENTATION_BACKUP.MD (DDragon 15.12.1), https://github.com/Roeschstudio/Lol_RMX_LATAM/blob/HEAD/RIOTDOCSAPI.md (15.15.1), https://github.com/JoshPaulie/nexar/tree/HEAD/meta (16.10.1, portal rate-limit copy); official https://developer.riotgames.com/docs/lol , https://support-developer.riotgames.com/hc/en-us/articles/22698698001939-League-of-Legends
- 2026 quotes of LoL policy and General Policies ("Please Don't", personal-key rule, scraping penalty): https://github.com/skilledDev96/League-team-comp/blob/HEAD/docs/riot-production-key-application.md , …/docs/riot-submission.md , …/docs/global-plan.md ; https://github.com/M0nst3rMash/PixeLink ("Product Registration Write-up")
- API Terms (2013-12-09) copy: https://github.com/Kevin-Chant/LoL-ChampionSelectGUI/blob/HEAD/Riot%20API%20Terms%20and%20Conditions.txt
- Legal Jibber Jabber (Aug 2018) copy: https://github.com/craftersmine/Ui.League/blob/HEAD/LEGAL-JIBBER-JABBER.md ; official https://www.riotgames.com/en/legal
- Patch 12.22 notes (2022-11-16), LoL wiki text: https://github.com/apg2275/LolWikiRAG/blob/HEAD/TrainVal/Val/V12.22.txt
- Patch notes 25.06, 25.17, 25.18, 25.20, 25.21, 25.23, 25.24, 26.1, 26.2 (Riot HTML): https://github.com/danieladeremi/metaforecasting/tree/HEAD/data/raw/patch_notes/html
- /dev: Account Linking and Streamer Mode: https://www.leagueoflegends.com/en-us/news/dev/dev-account-linking-and-streamer-mode/ [S]
- @RiotGamesDevRel, ult timers (2025-03-11): https://x.com/RiotGamesDevRel/status/1899532362637250955 [S]; Spectator-V5 deactivation (2025-10-17): https://x.com/RiotGamesDevRel/status/1979263978787246391 [S]; @LeagueOfLegends clarification (2025-10-21): https://x.com/LeagueOfLegends/status/1980434309736771638 [S, quoted in #1110]; Brawl (2025-05-13), referenced in #1109
- RiotGames/developer-relations issues: #1110, #1116, #1161, #1162, #1169, #1175, #1181, #1150, #1192, #1183, #1168, #1128, #1099, #1146, #1151, #1159, #1109, #1075, #1092, #1085, #1067, #608, #495. Base URL: https://github.com/RiotGames/developer-relations/issues/
- Riot API OpenAPI spec (deployed 2026-09-24): https://github.com/MingweiSamuel/riotapi-schema (gh-pages `openapi-3.0.0.json`)
- Riven routing constants (PH2/TH2 → SG2, ME1): https://github.com/MingweiSamuel/Riven/blob/HEAD/riven/src/consts/route.rs
- Vanguard FAQ for Third Party Applications (2024-04-01): https://www.riotgames.com/en/DevRel/vanguard-faq [S]; quotes: https://github.com/Remus3/Amberstone/blob/HEAD/docs/_archive/2026-07-28-cv-stack/cv_1_capture.md , https://github.com/KotyV/KRTradToFRLoL/blob/HEAD/docs/recherche-rapport-2026-06-10.json
- Changes to the LCU API Policy (2019-01-24): https://www.riotgames.com/en/DevRel/changes-to-the-lcu-api-policy [S; quoted in KotyV]
- Riot Support "Third Party Applications": https://support-leagueoflegends.riotgames.com/hc/en-us/articles/225266848-Third-Party-Applications [S]
- riotgames.pem: https://github.com/RiotGames/leaguedirector/blob/HEAD/resources/riotgames.pem

**Community and technical**
- HexDocs (hextechdocs.dev source; LCU, websocket, FAQ, rate limiting, item sets; archived): https://github.com/CommunityDragon/HexDocs
- LCU and Riot Client swagger 26.16 (2026-08-23): https://github.com/KebsCS/lcu-and-riotclient-api
- Rust LCU and game-client libraries: https://github.com/AlsoSylv/Irelia , https://github.com/Leastrio/Shaco ; 2026 Rust lockfile discovery: https://github.com/shepherdjerred/monorepo/blob/HEAD/packages/scout-for-lol/packages/desktop/crates/scout-client-core/src/lcu.rs
- PUUID per-key quote and 2026 rate-limit headers: https://github.com/shepherdjerred/monorepo/blob/HEAD/packages/scout-for-lol/scripts/migrate-puuid-key.ts , …/scripts/puuid-migration/support.ts ; spectator method limit: https://github.com/set4jeta/JetaDirectaBot
- Champ-select captures: https://github.com/GustavoRFS/ekko (2025-07-26 Solo/Duo), https://github.com/tanvoid0/wingbot , https://github.com/kalvinkalvink/lol-helper
- De-anonymisation tools, for awareness only: https://github.com/LeagueAkari/LeagueAkari (champ-select-members.ts), https://github.com/sluucke/drake-lol (champSelectPuuid.js), https://github.com/boayusuf/LobbyRevealLoL , https://github.com/steele123/reveal/issues/9
- Overwolf Riot compliance list (quoted): https://github.com/luansilvadb/educador_de_fundamentos_lol/blob/HEAD/.planning/phases/05-overlay-window-compliance/05-RESEARCH.md , https://github.com/niftymonkey/champ-sage/blob/HEAD/docs/research/augment-detection-research.md ; official https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games/ [S]
- 2026 research notes (portal FAQ quotes, retention, DDragon/CDragon measurements, overlay competitor notes): https://github.com/Remus3/Amberstone (docs/_archive/2026-07-28-research-consolidation/research_E_build_data_sources.md, RC2_RESEARCH_in_match_overlay.md)
- Registration open questions (2026): https://github.com/ilyanfraimbault/TrueMain/issues/1680 ; rate-limit decision log: https://github.com/ilyanfraimbault/TrueMain/blob/HEAD/.claude/docs/decisions/pipeline-riot-budget.md
- Live Client Data conservative matrix (2026-08-29): https://github.com/J-Pantaroto/Sparta/blob/HEAD/docs/live-client-capability-matrix.md ; Porofessor-style reference app: https://github.com/Ryan526/league-live-scout
- CommunityDragon docs (2025-09-23): https://github.com/CommunityDragon/Docs (README.md, assets.md)
- Secondary articles [S]: https://buildzcrank.com/en/blog/riot-api-and-third-party-apps-what-is-allowed/ , https://gameriv.com/third-party-apps-after-champion-select-anonymity/ , https://blog.loltheory.gg/lol-streamer-mode/ , https://www.zleague.gg/theportal/league-of-legends-riot-bans-third-party-enemy-ultimate-timer-apps-players-react/
