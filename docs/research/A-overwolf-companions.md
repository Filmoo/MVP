# A. Overwolf-based and "companion" desktop apps for League of Legends

Feature catalogue for triage. Researcher A. Compiled 2026-09-27.

Scope: **Porofessor** (Overwolf app, 2025 standalone app, porofessor.gg live site), **Mobalytics Desktop**, **U.GG Desktop**, **Facecheck**, **DeepLoL**, **League of Graphs**, plus other notable Overwolf LoL apps (Team Advisor, ProComps.gg, STATUP.GG, Enemy Stats, Hexgate, LOBLY) and short entries for iTero, OP.GG Desktop and Outplayed (recording).

---

## How to read this report

**Feature flags**

| Flag | Meaning |
|---|---|
| `[FREE]` | Available on the free tier |
| `[PREMIUM]` | Paid tier only (Porofessor Premium, Mobalytics Plus, U.GG PLUS…) |
| `[?]` | Not verified this session. The reason is given inline. Most `[?]` items come from the researcher's background knowledge of these apps up to 2025 (marked **(K)**), or from SEO or marketing articles I don't trust |
| `[OVERLAY]` | Drawn on top of the game during a match. Out of scope for v1, but catalogued. Many of these could live on a second screen instead |
| `[POLICY]` | Restricted or banned by Riot's or Overwolf's LoL rules (2025-2026). See §0 |
| `[OUTDATED]` | Removed, broken by a Riot change, or likely stale. Details are given inline |

**Evidence.** References like `(S12)` point to §10 Sources.

**Method and limits.** porofessor.gg, mobalytics.gg, u.gg, overwolf.com, reddit, x.com and youtube were blocked by the egress proxy. The shared web-search budget ran out after about 55 queries, because all parallel researchers share one cap of 200. The rest of the evidence therefore comes from GitHub-hosted material:

1. Open-source scrapers that saved **real Porofessor live-game output**, including tags, tooltips and colors.
2. **Facecheck-format data files** exported into an open-source clone.
3. Several 2025-2026 **competitive-analysis documents written by other LoL tool builders**. These quote primary sources such as u.gg/faq, porofessor.gg/faq, support.mobalytics.gg, Riot's developer policies and Overwolf's compliance page.

Numbers taken from those documents are secondary.

---

## 0. What changed in 2025-2026 (read first: it reshapes the whole catalogue)

| Date | Change | Consequence for features |
|---|---|---|
| Early 2025, then **13 Mar 2025** | Porofessor added a click-to-start **enemy ultimate timer**. Backlash followed ("parasitic software", Dexerto). Riot then banned "Enemy Ultimate Timer" features in all third-party apps, with API-key deactivation as the penalty (S8, S21a). | Riot policy text: *"Products must not use or incorporate information not present in the game client that would give players a competitive edge (e.g., automatically or manually allowing tracking enemy ultimate cooldowns)"* (S26). |
| 2025-2026 (Overwolf compliance page, as copied in a 2026 doc) | "Strictly prohibited" (S25): power-spike notifications ("X champion has hit level 6"); notifications that dictate action ("go gank top"); **tracking enemy ability cooldowns or facilitating timers**; **tracking enemy summoner-spell cooldowns or facilitating timers**; ultimate timers. | Porofessor's historic enemy **summoner-spell timers**, and every "spell tracker" app, are now non-compliant. Jungle and objective timers are **not** on this list. |
| **May 2025** | Riot banned ads in **in-game overlays, the loading screen and the Riot client**. Ads remain allowed on desktop-app screens outside the match and on websites (S21b). One source also reports a ban on overlays that "simulate decision-making" (S21a, secondary). | Monetization moved to subscriptions: Porofessor Premium was fast-tracked, and Blitz and Mobalytics pushed their paid tiers. |
| Standing Riot LoL policy (S26) | • *"Products cannot display win rates for Augments or Arena Mode items"* (pick and popularity rates are OK). <br>• *"Products cannot create alternatives for official skill ranking systems… MMR or ELO calculators"*. <br>• *"Products cannot identify or analyze players who are deliberately hidden by the game"*. <br>• Custom-game history needs an opt-in. <br>• A free tier is mandatory. Paid content must be "transformative". <br>• Explicitly approved use cases include **LFG tools** and **"Game overlays that provide static data that is available prior to the game"**. <br>• One 2026 doc (S21e) also reports that all **Brawl** mode data is off-limits. | These rules affect features like Arena augment tier lists (pick rate only), "estimated MMR" widgets, and name-reveal in ranked champ select, which is forbidden. |
| Ranked Solo/Duo **champ-select anonymity** | Allies show as Gromp, Murk Wolf, Raptor, Krug and Scuttle Crab until the loading screen. Enemy names are hidden in every queue until the game starts (S11). | "Scout my lobby" now effectively happens at the **loading screen** (Porofessor's key moment). "Reveal lobby names" tools are off-limits. |
| **Oct 2025, patch 25.20**: Streamer Mode API protection | Third-party apps (Porofessor, U.GG, OP.GG, Blitz…) get **no identity, rank or history** for streamer-mode players during the match ("missing from in-game info"). If **any** player uses streamer mode, **premade detection fails for the whole lobby**. **Live spectating on third-party sites was disabled**, and replaced by replay-file access through the match endpoint (S10). | This degrades Porofessor's core scouting. Post-game data is unaffected. |
| **5 Dec 2025** | **Porofessor Standalone**, "a new electron-based version", launched next to the Overwolf version. Overwolf remains the ad and tech partner (S6). | The market leader now ships without Overwolf, but on Electron, so it is not "lightweight". |
| Ownership churn | • Porofessor and League of Graphs: Wargraphs was sold to M.O.B.A. Network AB (2023, about $54-55M). M.O.B.A. announced a trading suspension from 1 Jan 2026 and repositioned in May 2026 around LoL and TFT subscriptions (S9, S7, S21a). <br>• Mobalytics: bought by ESL FACEIT Group (Mar 2025). <br>• U.GG: Outplayed Inc. was bought by Enthusiast Gaming (Nov 2021); the parent is a distressed penny stock in 2026 (S21a). | Every incumbent is under monetization pressure: more ads and more paywalls, and users complain about both. |

---

## 1. Porofessor (Overwolf app, Standalone app, porofessor.gg)

### 1.1 Identity card

- **What it is:** the reference "who's in my game?" scouting companion. It started in 2017 as part of League of Graphs; the creator of both is Jean-Nicolas Mastin (Wargraphs, a one-person company). The porofessor.gg FAQ says: *"I'm the creator of League of Graphs :)"* (S21a). It is now owned by M.O.B.A. Network AB, Sweden.
- **Platforms:**
  - Overwolf app `trebonius-porofessor.gg`, Windows only (S1).
  - **Standalone** Electron app since Dec 2025, with no Overwolf account needed (S6).
  - **porofessor.gg** website: live-game lookup in **21 locales** (S21a).
  - Android app `gg.porofessor.app`, a thin wrapper around the website with about 220K downloads (S12e).
  - No macOS app. The FAQ says *"The Porofessor app is not available on smartphones!"*, which refers to the desktop app (S21a).
- **Scale:**
  - Installs: 15.5M (Jun 2025), then 16.6M (Q1 2026 report), then "17.4M downloads" on the Overwolf page (Jul 2026) (S5, S7, S21d).
  - Rating: about 4.1★ (S21c).
  - Website traffic estimates vary from 3.2M to 10.5M visits a month (S21a, S21b).
- **Pricing:**
  - Free with ads.
  - **Premium**: ad removal, plus "personalization and cosmetic features" targeted for Q3 2025. A higher "AI-powered tier" and "player performance tracking" were announced as in development in 2025-2026 (S5, S7).
  - Price not found `[?]`.
- **Tech and data:**
  - Overwolf native app (CEF), plus Electron standalone.
  - Riot API, with League of Graphs as the backend.
  - Stats window is the **last 30 days** by default, with a **"season"** option. Queue filter: all, `soloqueue`, `flex` or `ranked-only`. These are URL segments of `porofessor.gg/partial/{lang}/live-partial/{region}/{gameName}-{tagLine}/{queue}/{period}` (S20a).

### 1.2 Porofessor player tags (the signature feature)

**Mechanics** (verified from scraped HTML: S20a, S20b, S20c, S20d):

- **Where tags live:** every player card has a `tags-box`. Each tag has:
  - a short **title**;
  - a **tooltip**, made of `itemname.tagTitle` plus `span.tagDescription`, which states the exact number and what it is compared against;
  - a **niceness** attribute, `data-tag-niceness`.
- **Colors (from the player's own point of view):**
  - **green** = good;
  - **red** = bad;
  - **yellow** = neutral or informational;
  - **blue** = special, for example `Pro: Faker` (S20b).
  - One scraper also handles `orange` and `purple` CSS classes; I don't know what those are used for `[?]`.
- **Champion-contextual:** most tags describe the player *on the champion they are playing now*. They use either a percentile against other players of that champion ("top 13.8%", "worst 11.3%") or per-10-minute averages.
- **Window:** tags are computed over the **last 30 days** by default.
- **Team-level tags** also exist, in the team recap box (`#teamRecaps .box > .tag`, green or red) (S20a). No real examples were captured. Open-source clones describe them as "Porofessor-style draft tags (Good peel, Low AP, No frontline, Heavy engage…)" (S21k) `[?]`, so the exact labels are unverified.
- **Premade marker:** each card can carry a `premadeHistoryTagContainer` holding a group number. Players with the same number are probably queued together (S20b). Since patch 25.20 this breaks when anyone in the lobby uses streamer mode (S10).
- **Streamer-mode players:** rendered as hidden, with the champion only and no tags (S20b).
- **Riot's own flags are not surfaced:** in the captured game, Riot's API marked 6 of 10 players `veteran: true`, but Porofessor showed **no "Veteran" tag**. So Porofessor did not surface Riot's `veteran` flag as a tag, at least in that 2023-24 data (S20a).

**Verified tag catalogue.** Captured from real `porofessor.gg/partial/fr/live-partial` output: one EUW Ranked Solo game, Master tier, season 13.2, stored by an open-source project in late 2023 or 2024 (S20a). The labels are French because the UI was in French. The English labels are **my translations** `[?]`; Porofessor's actual English wording may differ. The numbers are real examples. **Possibly outdated:** these are 2023-24 captures, although the tag system has been stable since 2017.

| # | Tag as displayed (FR) | Probable EN label `[?]` | Color | Tooltip, verbatim FR → EN | Observed trigger / threshold (inferred from data) |
|---|---|---|---|---|---|
| 1 | `1ère partie` | "First game" | yellow | "Première partie aujourd'hui" → "First game today" | The player's first game of the day. It fired for 5 of 10 players. It works as a "cold, not warmed up" hint. |
| 2 | `{Champion} casu` (e.g. `Blitzcrank casu`) | "Casual {Champion}" | red | "Ce joueur a seulement joué 1 parties avec Blitzcrank durant les 30 derniers jours" → "only played 1 game with Blitzcrank in the last 30 days" | 1 game in 30 days **and** low mastery (9.2k points, level 3). Two other players also had only 1 recent game on their champion, but with 22.7k and 52.4k mastery, and did **not** get the tag. So mastery is probably part of the rule. |
| 3 | `Débutant avec {Champion}` | "Newbie with {Champion}" (≈ "first time") | red | "Ce joueur n'a quasiment jamais joué Soraka" → "has almost never played Soraka" | About 0 mastery points on the champion. |
| 4 | `<3 {Champion}` | "<3 {Champion}" (champion lover) | green | "a joué 23 parties avec Yasuo durant les 30 derniers jours" → "played 23 games with Yasuo in the last 30 days" | High recent volume on the champion (23 games in 30 days; 680k mastery). |
| 5 | `OTP {Champion}` | "OTP {Champion}" | yellow | "Ce joueur ne joue quasiment que Qiyana (73 % des parties des 30 derniers jours)" → "almost only plays Qiyana (73% of games in the last 30 days)" | One champion makes up about 70% or more of recent games. It fires even when the player is on **another** champion: here the Qiyana OTP was playing Soraka support, with `Fill?` and `Débutant avec Soraka` alongside. |
| 6 | `Super {Champion}` | "Super {Champion}" | green | "Rang # 401 avec Lee Sin % win (Classées): 59.4%" → "Rank #401 with Lee Sin, ranked win%: 59.4%" | The player is on the League of Graphs **champion leaderboard** (ranks #311 to #836 observed, with 9 to 138 games). |
| 7 | `Fill?` | "Fill?" | yellow | "Ce joueur ne joue pas un de ses rôles habituels" → "is not playing one of their usual roles" | Current role is not among the main roles (support while main mid; ADC while main mid). |
| 8 | `Pro: {Name}` | "Pro: {Name}" | blue (some parsers read it as neutral) | "Czajek (Vitality.Bee)" → pro name and team | Matched against a known list of pro accounts. Whether streamers are also tagged is unknown `[?]`. |
| 9 | `Laner aggressif` | "Aggressive laner" | green | "Ce joueur a 2.91 kills+assists en moyenne à 10 minutes quand il joue Yasuo" → "averages 2.91 kills+assists at 10 min on Yasuo" | Kills+assists at 10 min on the champion. Observed values were 2.50, 2.53 and 2.91, so the threshold is probably around ≥2.5. |
| 10 | `Jungler aggressif` | "Aggressive jungler" | green | "…3.62 kills+assists en moyenne à 10 minutes quand il joue Lee Sin" | Kills+assists at 10 min (2.88 and 3.62 observed). |
| 11 | `Laner intuable` | "Unkillable laner" | green | "Ce joueur a en moyenne seulement 0.44 morts à 10 minutes quand il joue Syndra" → "only 0.44 deaths at 10 min on average" | Low deaths at 10 min. |
| 12 | `Bon CSer` | "Good CSer" | green | "Ce joueur est dans les 13.8% meilleurs CSer avec Yasuo" → "top 13.8% CSers on Yasuo" | CS percentile against players of the same champion. Observed values ranged from 0.9% to 13.8%, so the cut-off is probably around the top 15%. |
| 13 | `Gros dégâts` | "High damage" | green | "…inflige de gros dégâts par minute avec Syndra (24.2% meilleurs joueurs)" → "high damage per minute (top 24.2%)" | Damage-per-minute percentile, cut-off around the top 25%. |
| 14 | `Destructeur(s) de tours` | "Tower destroyer" | green | "…inflige beaucoup de dégâts aux tours (10.4% meilleurs dégâts aux tours avec Syndra)" | Turret-damage percentile, around the top 10-11%. |
| 15 | `Bonne vision` | "Good vision" | green | "…a un haut score de vision par minute quand il joue Lee Sin (top 19.5%)" | Vision score per minute percentile, around the top 20%. |
| 16 | `Mauvaise vision` | "Bad vision" | red | "…a un mauvais score de vision par minute quand il joue Séraphine (pire 11.3%)" → "worst 11.3%" | Vision score per minute in the bottom percentile. |
| 17 | `Voleur` | "Stealer" (objective thief) | green | "…vole souvent l'hérald, le dragon ou le baron (0.12 par match) lorsqu'il joue Lee Sin" | Epic-monster steals per game (0.12-0.13). |
| 18 | `Invader` | "Invader" | yellow | "…invade souvent en début de partie (35 % des parties)" → "often invades early (35% of games)" | Early invade in about 35% or more of games. |
| 19 | `Split Pusher` | "Split pusher" | yellow | "…split push très souvent quand il joue Yasuo" | No number shown. |
| 20 | `Roam beaucoup` | "Roams a lot" | yellow | "…roams souvent quand il joue Syndra" | No number shown. |

Observed density: 1 to 8 tags per player, with a median of about 4.

**Tags reported by other sources** (exact label or threshold not verified):

- **`Laner passif` ("Passive laner")**: *"doesn't tend to be aggressive against their opponent"*. Cited by several French reviews from 2020 to 2025 (S12a-c). It is very likely the red or yellow counterpart of tag 9.
- **Tags about dying a lot and warding a lot.** Porofessor's 2017 launch post says tags show "whether he plays aggressively, roams a lot, wards a lot, dies a lot" (S14). By symmetry there are probably "bad CSer", "dies a lot at 10 min" and "low damage" variants too `[?]`.
- **"Aggressive early", "Vision master"**: quoted by one blog (S15). This is probably a paraphrase of tags 9 and 15.
- **Loss streaks, "tilted", smurfs, one-tricks, autofill.** Porofessor promo short: "This is how you find out if a teammate is tilted" (S19b). 2026 comparison blogs say Porofessor surfaces *"ranks, win rates, playstyle tags, loss streaks, one-tricks… autofilled… smurfing"* (S17) and helps "discover potential smurfs, losing streaks" (S13). **The exact labels for streak and smurf tags were not captured** `[?]`.
- **Hot streak and Veteran**: these are the owner's examples. Riot's `league-v4` API exposes `hotStreak`, `veteran`, `freshBlood` and `inactive` flags. Porofessor's use of them is not confirmed, and `veteran` was not surfaced in the captured data `[?]`.
- **Promotion-series tags** `[OUTDATED]`: promos no longer exist.

**Cheap building blocks for the owner** (all verified API fields):

- `league-v4`: `hotStreak`, `veteran`, `freshBlood`, `inactive`, wins/losses.
- `match-v5` `challenges`, for example: `laneMinionsFirst10Minutes`, `epicMonsterSteals`, `visionScorePerMinute`, `soloKills`, `turretPlatesTaken`, `killParticipation`, `damagePerMinute`, `takedownsFirstXMinutes`, `enemyJungleMonsterKills`, `initialCrabCount`. A 2023 open-source DB schema lists more than 120 of these (S20c).
- `champion-mastery-v4`: points and level.

**What makes it "feel like Porofessor"** (these are observations, not features):

- 1-3 word labels with the champion name built in.
- Colored by good or bad *for that player*.
- The tooltip states the number and the comparison base.
- Everything is champion-contextual.
- Both "hype" tags (Super X, <3 X) and "warning" tags (casu, Fill?, 1st game).
- Tags cover **behavior** (invader, roamer, split pusher), not only skill.
- The whole lobby appears automatically at the loading screen, with nothing to type.

### 1.3 Feature catalogue (Porofessor)

**A. Client integration & automation**

- Detects the League client and game phases automatically; its windows pop up for champion select, loading screen and post-game `[FREE]`. The support page "Porofessor does not appear in champion select" confirms the champ-select window (S4).
- **"Push builds, runes and skills directly into your League of Legends client"**: rune page, item set and skill order `[FREE]` (S1).
- Summoner-spell import `[?]`. A 2026 policy study groups "Blitz, Porofessor, and Mimic.lol" as setting spells through the LCU (S21e), but that wasn't confirmed for Porofessor specifically.
- Auto-accept ready check: **not found** `[?]`. It is not listed anywhere for Porofessor.
- Standalone installer (Electron) that skips the Overwolf account; the installer is smaller (S6, S16) `[FREE]`.

**B. Champion select / draft**

- **Meta Overview** for your champion: current meta standing, **counter picks**, **ban suggestions**, recommended runes you can import `[FREE]` (S1, S21a).
- Pre-game lobby info on teammates and opponents: win rates, preferred roles, champion mastery (S13) `[FREE]`, `[POLICY]`. In ranked Solo/Duo, allies are anonymous in champ select, so this only works in queues without anonymity.
- "Discover potential smurfs, losing streaks, counter-picker tips" (S13) `[?]` (SEO article).
- **Web pre-game multi-search**: `porofessor.gg/pregame/{region}/{name1,name2,…}` and `/partial/pregame-partial/{region}/{names}/ranked-only`, which returns a card per player with tags. It was used by third-party LCU plugins to show lobby stats in champ select (S20d, S20e) `[FREE]`. Note that `[POLICY]` forbids using it to de-anonymize ranked lobbies.

**C. Pre-game & loading screen (player lookup)**

- **Automatic live-game window at the loading screen**, with **10 player cards** (S20a, S20b) `[FREE]`. Each card shows:
  - Riot ID and summoner level;
  - current rank: tier, division and LP;
  - ranked win rate and games played this season;
  - **previous-season rank**;
  - champion played, with win rate, number of games and **average K/D/A on that champion** (30 days or season);
  - **role in this game plus main roles**;
  - **tags** (§1.2);
  - **premade group marker**;
  - summoner spells and keystone.
- Team recap box with **team tags** `[FREE]` (S20a).
- Pro identification (blue `Pro: X` tag) `[FREE]`.
- Streamer-mode players shown as hidden `[FREE]`. Since Oct 2025 these players show no data at all `[POLICY]`.
- Filters: queue (all, Solo, Flex, ranked-only) and window (30 days or season) `[FREE]` (S20a).
- **Lane matchup tips** shown during the loading screen `[FREE]` (S14, S13).
- Champion mastery on the card `[?]`: mentioned by an article (S13), but not in the scraped markup.
- Win or lose "prediction" `[?]`: an Alucare headline says "the site that predicts your victory (or defeat)" (S30). I did not see this in the markup.

**D. In-game (overlay or second screen)**

- `[OVERLAY]` **Jungle camp timers and inhibitor timers** `[FREE]` (S1, S21a).
- `[OVERLAY]` Objective timers (dragon, baron, herald) `[?]`: listed by an SEO article (S13) and in a 2026 comparison table (S21d, "Jungle/Objective timers: Yes").
- `[OVERLAY]` `[POLICY]` **Enemy summoner-spell timers**, started by clicking a spell in the overlay. They ignore ability haste. Historically present: a YouTube comparison "Porofessor vs League Tracker" (S19c) and the Dexerto piece (S8). Now forbidden by the Overwolf/Riot compliance list; whether Porofessor still ships them in 2026 is unknown `[?]`.
- `[OVERLAY]` `[OUTDATED]` `[POLICY]` **Enemy ultimate timers**, started by clicking the enemy's ultimate. Added in early 2025 and **banned by Riot on 13 Mar 2025** (S8, S21a).
- `[OVERLAY]` **CS insights at 10 and 20 minutes, with graphs** (S21d).
- `[OVERLAY]` **Team gold difference, with graphs** (S21d).
- `[OVERLAY]` **"Vision Mastery"**: wards placed by 10 and 20 minutes (search snippet from the Overwolf listing).
- `[OVERLAY]` **Patch-note summaries inside the game** `[FREE]` (S21a).
- `[OVERLAY]` Overlay toggle hotkey; **rebindable shortcuts**; settings for **transparency, color scheme and widget position** `[FREE]` (S18). The source is a troubleshooting article, so this is medium confidence.
- `[OVERLAY]` Player cards and tags reopened during the game by hotkey `[?]` **(K)**.
- `[OVERLAY]` Item build and skill-order reminders `[?]` **(K)**. Implied by "push builds, runes and skills" but not confirmed as an overlay.
- Marketing claims "no FPS reduction" (S21d).

**E. Post-game & match analysis**

- **"Post Match breakdown analytics"**: evaluate your gameplay, identify strategies, "personalized advice to enhance future performances" `[FREE]` (S1).
- **Matchup Review**: your game compared with your lane opponent `[FREE]` (S21a).
- CS and gold graphs `[?]` **(K)**.
- Claims of "skill-shot accuracy / positioning VOD review" appear only in SEO articles (S13, S31). They are dubious `[?]`.

**F. Profile, match history & progression**

- Relies on League of Graphs for profiles, match history, champion rankings and rank history `[FREE]` (S21a).
- "Player performance tracking" was announced as in development for 2026 (S7) `[?]` `[PREMIUM?]`.

**G. Champion data: builds, runes, matchups, tier lists**

- Builds, runes and skill orders per champion and role, importable `[FREE]` (S1).
- Counter picks and ban suggestions `[FREE]` (S1).
- Champion leaderboards (feed the `Super X` tag) `[FREE]` (S20a).

**H. Game modes**

- **TFT**: Team Builder (S21a). **Expanded TFT support launched in April 2026** (S7) `[FREE]` / `[?]`.
- Legends of Runeterra deck tracker (S21a) `[OUTDATED]` `[?]`. LoR support is winding down across the ecosystem; Mobalytics has "sunset" it.
- ARAM, Arena, URF and Mayhem support in the live-game view `[?]`. Not verified.

**I. Social, multi-search, leaderboards, pro/esports**

- **LFG / duo finder**: "Find other friendly players to join you in duo-ranked matches" `[FREE]` (S1, S21a). LFG tools are an explicitly approved Riot use case (S26).
- Web **pre-game multi-search** (see B) `[FREE]`.
- **Current Games** browser: live games filterable by champion or elo, and "pros currently in game" (S3, porofessor.gg/current-games). This is probably `[OUTDATED]` or degraded since Oct 2025, when the spectator change landed (S10) `[?]`.
- Pro-player identification in lobbies `[FREE]`.

**J. Media: replays, recording, clips, spectate**

- **Pro Replays / "reference replays"**: watch high-level games (S21a, S21j) `[FREE?]`.
- A **replay system** that opens the game client. The FAQ says Vanguard can block it until you exit Vanguard (search snippet of the FAQ) `[?]`. Its status after the Oct 2025 replay-endpoint change is unknown.
- Spectate live games from the website `[OUTDATED]`: Riot disabled live spectating on third-party sites in Oct 2025 (S10).

**K. Settings, UX, platform, performance, monetization**

- Overwolf (CEF) and Standalone (Electron). Windows only. 21 languages (S21a).
- **Ads** in the app windows. A support article covers "the ad is too big and overrides the content / the content is too big for the window" (S4). In-game and loading-screen ads have been banned since May 2025 `[POLICY]`.
- **Premium**: ad-free, cosmetics and personalization (planned for Q3 2025); an AI tier is in development `[PREMIUM]` (S5).
- A community ad-removal patcher exists: `CallumMcLoughlin/AdfreePorofessor` (S32).
- Support topics show recurring issues (S4): champ-select window doesn't appear; blank window or endless loading spinner; "weird lines / blurry content / mouse cursor disappears"; the ad covers content. The FAQ also mentions Vanguard interfering with replays.

### 1.4 What users love and what they complain about

- **Loved:**
  - Best-in-class, zero-effort lobby scouting ("who is in this lobby?"). Ranks, loss streaks, one-tricks, autofill and smurfs surfaced automatically (S17, S21b).
  - Glanceable colored tags.
  - Free.
  - Trusted brand; "the most popular companion app… used by over one million pros and aspiring summoners" (S2).
- **Complaints (2025-2026):**
  - Mandatory Overwolf, which is why the standalone was the most requested feature (S6).
  - Intermittent loading errors at peak hours (S16).
  - "Recent bugs, degraded performance, aging interface", with reviews polarized between 1★ and 5★ (S21c). "Increasingly dated, rising error reports" (S21f).
  - Hurt by streamer mode (S21c, S10).
  - Ads.
  - The fair-play backlash over the ultimate timer (S8).

---

## 2. Mobalytics Desktop (Overwolf)

### 2.1 Identity card

- **Company:** Gamers Net, Inc. (2016, Los Angeles area). About $13.8M raised. Bought by **ESL FACEIT Group in March 2025** and runs "as a standalone business" (S21a, S21g).
- **Multi-game:** LoL, TFT, Valorant, Deadlock, Marvel Rivals and more. **Legends of Runeterra was sunset** (S21a).
- **Desktop:** Overwolf-based. It moved onto Overwolf from its own client at some point; one 2026 doc says "recently migrated" (S21c). Windows only.
- **Installs and ratings:** 3M+ installs and 3.9★ (S21c). Another doc says "down to ~3.6 stars; 2026 reviews dominated by 1-star complaints about freezing, bugs and increasing ads" (S21f).
- **Pricing:** free with ads. **Mobalytics Plus** is $7.99/month or $69.99/year (about $5.83/month), the most expensive in the category. A Collector's Edition sold for $199.99 and is sold out (S21a, S21b).
- **Languages:** 17, translated by community volunteers (S21a).
- **Stack:** React, TypeScript, GraphQL (Apollo). The ToS forbids scraping (S21a). A public GraphQL endpoint, `mobalytics.gg/api/lol/graphql/v1/query`, exposes per-player `badges{slug,name,description,kind,type}`, `queuesStats`, `roleStats`, `gpi` and `performanceMetrics`. Third-party scrapers use it (S20c).

### 2.2 Feature catalogue (Mobalytics)

**A. Client integration & automation**

- **Auto-import of runes, items and summoner spells** into the client. The user can choose the **"Default Flash Position"** (D or F). Live since 2021 and still current in 2026 (Mobalytics support article 4404450110349, cited in S21e) `[FREE]`.
- Detects champ select and match automatically, with the pre, in and post-game loop (S21g) `[FREE]`.

**B. Champion select / draft: "Live Companion"**

The layout below is as recreated from a design screenshot by an open-source clone (S21h). The individual sections are confirmed by S21g, S21i and S21b.

- Your team and enemy team strips with portraits and role badges `[FREE]`.
- **Team damage profile**: AP/AD percentage for both teams `[FREE]` / `[?]`.
- **Team power-spike curves** (Early, Mid, Late) for both teams `[FREE]` / `[?]`.
- Your build with its **tier** and **matchup win rates**; runes, spells and items with **item timings** `[FREE]` / `[?]`.
- **"Game Plan"** tab (early, mid and late plan) and **champion power spikes** `[?]`.
- **"Playing Against"** matchup tips `[?]`.
- Builds that take the matchup into account (S21d).
- "Draft tools" in the overlay (S21b) `[?]`.
- Lobby scouting "(champ select focus)" (S21d) `[POLICY]`: allies are anonymous in ranked Solo/Duo.

**C. Pre-game & loading screen**

- Pre-game lobby scouting plus build import (S21g) `[FREE]`.
- Player cards with rank, win rate, main champions and GPI or badges `[?]` **(K)**.

**D. In-game**

- `[OVERLAY]` "In-client overlay with **matchup tips, power spikes, and live stats**" (S21i) `[FREE]`.
  - `[POLICY]` note: *notifications* that alert on power spikes are prohibited. Static power-spike info is fine.
- `[OVERLAY]` **Live CS counters** and **live gold lead** (S21d) `[FREE]`.
- `[OVERLAY]` **Jungle and objective timers** (S21d) `[FREE]`.
- `[OVERLAY]` **"In-game goals"**, which are generic challenges (S21d) `[FREE]` / `[?]`.
- `[OVERLAY]` **AI voice coaching mid-game** `[PREMIUM]` (S21b).
- `[OVERLAY]` Build, skill-order and level-up reminders `[?]` **(K)**.

**E. Post-game & match analysis**

- **Per-game GPI delta**: the post-game shows how your Gamer Performance Index moved (S21g) `[FREE]`.
- "Deepest post-game analysis in the ecosystem", which tries to explain *why* you lost (S17) `[FREE]` plus `[PREMIUM]` depth.
- **Per-champion coaching feedback with combo sequences** (S21b); **combo guides** are Plus-only `[PREMIUM]`.
- **Daily "what to improve today" cards**: the advice is framed as "focus on 1-2 weakest GPI areas" (S21g) `[FREE]`.
- **Smart Highlights**: automatically detected highlight clips (S21a) `[?]` (details and tier unknown).
- **Challenges**: improvement missions (S21a, S21c) `[FREE]`.

**F. Profile, match history & progression**

- **GPI, the Gamer Performance Index** (S21g, S21a):
  - **8 skills**: Fighting, Farming, Vision, Aggression, Toughness/Survivability, Teamplay, Consistency, Versatility.
  - Each skill is scored 0-100 and anchored to rank: *"0 = Bronze-like at this skill, 100 = best Challenger players"*.
  - Each skill is built from 4-7 named sub-metrics.
  - It is shown as a radar with **two polygons (former self vs current self)**. You can drill from radar to skill to sub-metric.
- **Behavioral labels**, for example **"Aggressive Laner"** or **"Vision Controller"** (S21i). Profile **badges** carry a name, description, kind and type in the API (S20c).
- Queue stats (rank, LP, W/L, win rate, games); **role stats** (W/L, KDA, CS/min, kill participation, LP); performance metrics by position (S20c) `[FREE]`.
- Match history; LP and rank progress `[?]` **(K)**.

**G. Champion data**

- Tier list *"curated by our team of challenger experts"*, separate from a purely statistical "Stats" tab (S21a) `[FREE]`.
- Builds, runes, skill orders, counters and guides `[FREE]`. Combos `[PREMIUM]` (S21b).
- The data can lag: a fetch showed the tier list on patch 26.10 while U.GG was already on 26.14 (S21a).

**H. Game modes**

- **TFT**: full coverage (S21a).
- ARAM, Arena and URF builds `[?]` **(K)**.
- **ARAM Mayhem: "gone months without adding Mayhem-specific support"** (S21e). This is a complaint.
- LoR `[OUTDATED]`: sunset.

**I. Social / pro / esports**

- **Twitch extension**: Live Companion for viewers (S21a) `[FREE]`.
- Leaderboards `[?]`.

**J. Media**

- Smart Highlights `[?]`. See E.

**K. Settings, UX, platform, performance, monetization**

- **Plus** unlocks: ad-free; **AI voice coaching**; **combo guides**; other premium analytics `[PREMIUM]` (S21b).
- **Complaints:**
  - RAM spikes and Overwolf overhead ("performance complaints in 2026", S21b).
  - Freezing, bugs and increasing ads (S21f).
  - **"UI bloat is a known complaint"** and it is complex for beginners (S21i, S21c).
  - Cancellation dark pattern of about 35 minutes (S21a).
  - Suspiciously uniform Trustpilot reviews (S21a).
  - Mandatory arbitration in the US ToS (S21a).
  - Slow support for new modes (S21e).
- **Loved:** the GPI radar ("best-in-class player profiling"), the integrated pre-in-post loop, and matchup-aware builds.

---

## 3. U.GG Desktop (Overwolf)

### 3.1 Identity card

- **Company:** Outplayed, Inc. (Austin, 2017, founded by Shinggo Lu and Alan Liang). **Enthusiast Gaming** bought it in Nov 2021 for $44-57M including earn-out. The parent's stock traded at CAD 0.045 in July 2026, a distress signal (S21a).
  - Don't confuse it with **Outplayed**, Overwolf's recording app (§7).
- **Desktop:** Overwolf-based, Windows only, with a "Riot Games Compliant" badge (S21a, S21c). 5M+ installs, 4.0★ (S21c).
- **Pricing:** free with ads (Playwire). **U.GG PLUS** costs $3.99/month, or $2.49/month paid annually ($29.88/year), with a 7-day trial. It unlocks **ad removal and personal match statistics**, plus the **Personal tier list** (S21a, S21b).
- **Languages:** English only. No language selector was found on 11 pages (S21a).
- **Data:** *"All of our data comes from Riot's API"*. Filters for game type, role, rank, region and patch (u.gg/faq via S21a).
- **Stack** (from 2020-21 job ads): Elixir/Phoenix, Express, Elasticsearch, PostgreSQL, DynamoDB on AWS; React/Redux with GraphQL (S21a).
- **No mobile app**, by design: *"anyone playing League of Legends is playing on a non-mobile device"* (S21a).

### 3.2 Feature catalogue (U.GG)

**A. Client integration**

- **Auto-import of builds and runes** `[FREE]` (S21d).
- Item sets, summoner spells, and a Flash D/F preference `[?]` **(K)**.

**B. Champion select**

- Your champion's build, counters and matchups in the app `[?]` **(K)**. This mirrors the website's per-champion counter pages (S21b).

**C. Pre-game & loading screen**

- **Live game**: see the players in your current game. This is a desktop-app feature, Windows only (S21a). Pre-game scouting "Yes" (S21d) `[FREE]`.

**D. In-game**

- `[OVERLAY]` Overlays described as "thin" (S21f). **No jungle timers; CS tracking is post-game only** (S21d).
- `[OVERLAY]` Build and skill-order overlay `[?]` **(K)**.

**E. Post-game**

- Post-game analytics "Yes" (S21d) `[FREE]`.
- Personal match statistics `[PREMIUM]` (S21b).

**F. Profile & progression**

- Profile and match history `[FREE]`.
- **"Role Quest"** is a listed feature, but its exact scope is unverified (S21a) `[?]`.
- **Personal tier list** `[PREMIUM]` (S21a).

**G. Champion data**

- Tier lists: general, per role, **ARAM Mayhem**, **Duo**, and Personal (Plus) `[FREE]` / `[PREMIUM]`.
- Builds filterable by lane, elo, patch and region.
- **Pro builds**; synergy and duo guides; per-champion **counter pages** (S21a, S21b).
- Reputation: "the most statistically clean" (S21a) and "trusted static build data" (S21f).

**H. Game modes**

- **ARAM Mayhem** tier list (S21a).
- **TFT**: full coverage (S21a).
- Arena and URF `[?]` **(K)**.

**I. Social / leaderboards**

- Leaderboards and multi-search `[?]` **(K)**.

**K. Platform / performance**

- Complaints: **high RAM usage** (S21c); limited differentiation; English only.
- Loved: the precision of its data and a clean UI.

---

## 4. Facecheck (Overwolf)

### 4.1 Identity card

- Facecheck exists and is current: 2026 documents written by other builders list it with Porofessor and Mobalytics as a lobby-scouting companion. They describe it as answering *"who am I playing with and against"* and as built on **Overwolf Native** like Porofessor and Mobalytics (S21l). It also appears in "every existing companion app (Porofessor, Mobalytics, U.GG, OP.GG, Blitz, Facecheck)" (S21e).
- I found no official page, pricing or install counts `[?]`.
- **Best evidence of its features:** an open-source "lighter LoL tool, without Overwolf" (HextechCore) whose data files state they use **"JSON format inherited from / inspired by Facecheck"** (S20f).
- The files are named `myPlayStyles`, `postGame`, `matchHistory`, `stats`, `spellsPositions` and `patchNotesLite`. `postGame.json` holds the author's own 2025-26 EUW games, including ARAM Mayhem (queue 2400 "KIWI"), URF, Draft, and Ranked Solo and Flex. The structure is strongly suggestive, but the attribution to Facecheck is **`[?]`**.

### 4.2 Feature catalogue (Facecheck, inferred from its data formats)

**A. Client integration**

- Build and rune injection and auto-accept appear in the clone's own module list ("auto-accept, rune-injector"). They are **not** confirmed as Facecheck features `[?]`.
- `spellsPositions`: a Flash (and other spells) D/F slot preference `[?]`.

**B. Champion select**

- **"My Playstyles": user-created build presets for each champion** `[?]`. Each preset stores:
  - a title and description;
  - the map and roles;
  - summoner spells;
  - a **starting build with quantities** (for example 2 potions);
  - a **recommended core order**;
  - **situational items**;
  - primary and secondary runes;
  - **stat shards**;
  - a **full level 1-18 skill sequence** plus the max order ("Q,W,E");
  - a **patch tag** and the **author**.

  Several playstyles per champion are allowed ("Support dps", "Support", "Ranked"…). In other words it is a local build library that can be imported.

**C. Pre-game**

- Lobby scouting ("who am I playing with and against") `[FREE?]` (S21l).

**E. Post-game** (from `postGame.json`) `[?]`

- **Team summary:** win, kills, deaths, assists, gold, damage to champions, KDA, towers, dragons (with a **dragon-kill timeline**), barons, elders, heralds, **"horde" (voidgrubs)**, bans.
- **Per player:** champion level, K/D/A, KDA, kill participation, **CC score**, vision score, CS and CS/min, damage per minute, damage to objectives, gold and gold/min, total heal, spells, runes, final build, item timeline, **MVP flag**.
- **Insight tags** grouped into **Fighting, Income and Map Control**, each with a sentiment (good, bad or neutral) and a coaching sentence. There are also **"gold tags"** (MVP, CS God, Pentakill). The full list is in §4.3.
- Works across **ARAM Mayhem, URF, Draft and Ranked**.

**G. Champion data**

- **"Patch notes lite"**: for each patch, icon lists of **Buffed, Nerfed and Adjusted** champions and items, plus **mid-patch updates**. Patch 26.1.1 was captured `[?]`.

**F. Profile**

- Match history and aggregated stats files exist, but were empty in the export `[?]`.

### 4.3 Post-game insight tags in Facecheck-format data (78 + 3 observed)

The format is `Tag (sentiment): criterion`. The texts are verbatim from the export (S20f). These are ready-made copy for a "Porofessor-like but post-game" feature. Many use role-relative @14-minute comparisons.

**Fighting (31)**

- Ambulance (good): healed 15,000+ HP on teammates.
- Anti-KDA (bad): KDA < 2; "don't go for over-aggressive kills… play & fight with your team".
- Bully beatdown (good): took a lot of damage early but turned the game around and won.
- CCCCRITICAL (good): highest crit > 2,000.
- Carnivore (good): ≥10 kills/assists from ganks by 14:00.
- Deaths do matter (bad): died 10+ times.
- Didn't even feel it (good): highest damage taken from champions in the game.
- Didn't notice you (bad): kill participation lower than your opponent's.
- Died to minions (bad): a death largely caused by fighting inside a minion wave.
- Died to tower (bad): killed by tower damage while trading or diving.
- Fine I'll do it myself (good): 5+ solo kills.
- Fistfighter (neutral): ≥9 takedowns or deaths around you in the first 14 minutes.
- Food (bad): died 10+ times.
- Grim Reaper (good): 23+ kills.
- Hold Em' Down (good): most CC of anyone in the game.
- Jungler Food (bad): died to jungle ganks more than twice.
- Kill creator (good): main damage source for 5+ of your kills/assists.
- Lots of fans (good): 75%+ kill participation.
- No Lane No Pain (good): good roaming during laning phase.
- On Fire (good): KDA of 9.5 or more.
- On an Island (neutral): 0 KDA at 14:00 while your team has 6+ kills.
- Perfect Game (good): 0 deaths.
- Pick maker (good): good at making picks.
- Raid boss (good): extremely hard to kill by the end of the game.
- Shielding (good): shields mitigated 5,000+ damage.
- Solo Bolo (good): solo-killed your opponent at or before level 6.
- Solo killed (bad): solo-killed 2+ times.
- Survivalist (good): ≤2 deaths.
- Teamfight Destroyer (good): >5,000 damage in one fight.
- They Felt You (good): highest champion damage in the game.
- Wreak Havoc (good): 20+ kills.

**Income (28)**

- A Team Effort (good): won with a 3,500+ gold lead.
- Botlane kingdom (good): bot lane ahead in CS, gold, XP and kills at 14:00.
- Bounty Hunter (good): collected shutdowns.
- Brewer (bad): bought 3+ potions after a reset.
- Chovying (good): 25+ CS lead and no deaths at 14:00.
- Church Mouse (bad): gold diff at 14:00 worse than −500.
- Clearing at the speed of light (good): full clear and level 4 by 3:15.
- Early Gold Loss (bad): gold diff at 5:00 worse than −50.
- Early Kingdom (good): +1,000 gold on your opponent at 14:00.
- Falling behind (bad): team behind in gold.
- Farm Fanatic (good): >7.5 CS/min.
- Fell off (bad): CS/min dropped after laning.
- Goblin (bad): at some point held >2,500 unspent gold.
- Head to Head (neutral): even with your lane opponent.
- Head to Tail (bad): went from a 3,000+ gold lead to losing within 60 seconds.
- Herbivore (good): jungle CS and level lead over the enemy jungler by 14:00.
- Lane CSing (bad): below-average CS/min in the first 10 minutes ("15 CS ≈ 1 kill").
- Lasthit Legend (good): ≥125 CS at 14:00.
- Level 2 Powerspike (good): hit level 2 first and got a kill.
- Lottery winner (good): collected a 1,000-gold shutdown.
- Mid-Late CS (good): kept CSing through the mid game.
- Million dollar giveaway (bad): gave away a 1,000-gold shutdown.
- Minion Mastermind (good): >9 CS/min.
- Never give up (good): behind in gold and XP at 14:00 but ahead at the end.
- Second to 6 (bad): reached level 6 after your opponent.
- Shutdown collector (bad): took shutdowns that should have gone to carries.
- Ward Waster (bad): bought 8+ control wards.
- Wave Warrior (good): high CS/min after laning.

**Map Control (19)**

- Baron Lost (bad): your team took Baron but lost gold during the buff.
- Baron Power Play (good): gained 1,500+ gold during the Baron buff.
- Baron burst (good): Baron killed before 21:00.
- Dragons Soul (good): team secured the dragon soul.
- Herald left behind (bad): team never took Rift Herald.
- Inthibitor (bad): destroyed an inhibitor before 17:00 (gives the enemy "free gold and XP to scale").
- Like a wrecking ball (good): most turret damage in the game.
- No Control (neutral): placed 0 control wards.
- No Dragons (bad): team took 0 dragons.
- Objective gifter (bad): traded objectives while ahead.
- Objective trader (good): traded objectives while behind.
- Odd one out (bad): absent from major fights.
- Speedrun (good): game ended before 15:00.
- Stone Wall (good): your tower took <1,000 damage by 14:00 (no plates given).
- Tower Threat (good): first tower before the plates fell.
- Two in one swing (good): 2 neutral objectives within 10 seconds of each other.
- Visionary (good): extreme vision score.
- Ward Fortress (good): high early vision score and no gank deaths by 14:00.
- Ward Nightmare (good): cleared 7+ wards.

**Gold tags (3)**

- Mvp: "performed the best in the game".
- CS God: 100+ CS more than your lane opponent.
- Pentakill.

---

## 5. DeepLoL (deeplol.gg)

### 5.1 Identity card

- **Company:** GameEye Corp (South Korea). It has a B2B product, `pro.deeplol.gg`, with paid contracts confirmed with 5 esports teams (AR, BR, JP, KR, US) (S21a).
- **Status in 2026:** heavy display ads, with billboard and desktop-takeover units per uBlock filter lists (S20g). Its official X account was suspended as of 17 Jul 2026; the cause is unknown (S21a).
- **Desktop / Overwolf app:** **not confirmed** by any source this session `[?]`. From memory **(K)**, a Windows "DEEPLOL" client once offered auto-runes and AI-Score. Treat DeepLoL as a **web product** unless the owner confirms otherwise.

### 5.2 Feature catalogue (DeepLoL, mostly web)

- **E/F. AI-Score per match**: an estimate of contribution beyond KDA, shown in the same spot where OP.GG shows OP Score (S21g) `[FREE]`.
- **F. AI tier prediction**: a forecast of "where you'll land" in rank (S21g, S21a) `[FREE]`. `[POLICY?]` The owner should check this against Riot's "no alternatives to official ranking / MMR calculators" rule.
- **G. Matchup and synergy analytics**; champion pages with **matchup-specific ability tips**, i.e. micro-coaching inside the data tables (S21g) `[FREE]`.
- **I. Pro-player pages** (the LCK is treated as first-class), including browsing pros' live solo-queue games next to your own history (S21g) `[FREE]`. `[OUTDATED?]` Live pro-game browsing may have been affected by the Oct 2025 spectator change.
- **G. Per-champion patch history** route (`/champions/{x}/history`). It exists, but the content could not be verified (S21a) `[?]`.
- Builds, tier lists, multi-search and live game `[?]` **(K)**.

---

## 6. League of Graphs (leagueofgraphs.com)

### 6.1 Identity card

- Same founder and owner as Porofessor (M.O.B.A. Network). Copyright "2013-2026".
- **Website only**: live game is handed off to Porofessor, which is effectively LoG's desktop companion. No dedicated desktop or Overwolf app was found `[?]`.
- **20 locales**. Monetization is display ads plus a Bitcoin/PayPal `/donate` page (S21a).
- It shares a CDN with Porofessor (`lolg-cdn.porofessor.gg`) and the M.O.B.A. ad-tech stack: 337 IAB partners were listed in its cookie banner (S21a).

### 6.2 Feature catalogue (web)

- **G.** Tier list; builds, runes and skill orders; champion stats by elo and region `[FREE]` (S21a).
- **I.** **Leaderboards**, including **per-champion player leaderboards**. These power Porofessor's `Super {Champion}` tag ("Rank #401 with Lee Sin") (S20a) `[FREE]`.
- **J.** Community feed of **recent replays** (S21a) `[FREE]` `[?]`. Its status after the Oct 2025 replay change is unknown.
- **F.** Summoner profiles. One source describes a **"Power Circle"** tab with three axes: **Combat, Income, Map Control** (search snippet) `[?]`. These happen to be the same three category names as the Facecheck-format post-game tags in §4.3.
- **G.** An "Infographics" archive of static meta summaries, possibly from 2015-16 (S21a) `[FREE]`.

---

## 7. Other notable Overwolf and companion LoL apps

| App | Platform | What it does (LoL) | Pricing / reception | Sources |
|---|---|---|---|---|
| **Team Advisor** | Overwolf | Dedicated **drafting** tool. It **had an auto-accept queue feature that has since been removed**. | About 100K installs, 3.7★. Criticized for depending on Overwolf. | S21c |
| **ProComps.gg** | Overwolf, 300k+ downloads | **Composition-aware drafting**: AP/AD balance, frontline, engage, poke. Real-time draft alerts. Personalized **champion pools**. Aimed at organized teams. | Freemium plus ads. **Premium is needed for live-draft champion-pool features.** Its blog has been inactive since Nov 2024. | S21b, S21a |
| **STATUP.GG** | Overwolf (Gamer Republic, Seattle) | **Real-time AI voice coaching** for Summoner's Rift ranked. Claims "wave-state coaching". Cloud-based. | Paid. **2.3/5** on Overwolf ("nothing works"). | S27, S21d, S21e |
| **iTero** | Standalone, with an Overwolf presence | AI draft that reads both teams, your match history and your champion pool; situation-specific builds; pre, in and post-game coverage. "Fully Riot compliant". Partnered with GIANTX. | Free plus premium (price undisclosed). 394K installs, 4.5★ (S21c); "500,000+ downloads" (S21b). Another researcher covers it in depth. | S21b, S21c, S21m, S29 |
| **OP.GG Desktop** | Hosted on Overwolf per S21a; Windows and macOS | Overlay that **adjusts runes automatically**; **OP.GG AI Voice**; spectate pros; a "2025 Awards" wrapped recap (S21g). Covered by another researcher. | $3/month ad-free (or $3.99 in-app). Criticized for intrusive auto-runes, high CPU, and a dark-pattern ad close button. | S21a, S21g |
| **Enemy Stats** | Overwolf | Only the store listing was seen. Features unknown `[?]`. | – | Search result: overwolf.com/apps/enemy-stats |
| **Hexgate** | Unknown `[?]` | AI overlay that **re-scores every viable item against the specific enemy team in real time**, plus AI post-game breakdowns. | Free. | S17 |
| **League Tracker** | Unknown `[?]` | Summoner-spell timer app compared with Porofessor on YouTube. `[POLICY]` Enemy spell timers are now prohibited. | – | S19c |
| **LOBLY** | Overwolf (spec from July 2026; in development) | LFG and lobby listings: duo, flex, clash, ARAM and custom. Joining automates the client invite through the LCU. Includes a light scouting view, build import and a post-game summary. Its overlay is off by default ("second screen window"). | – | S21l |
| **Outplayed** (Overwolf's recording app; unrelated to "Outplayed Inc.", U.GG's owner) | Overwolf | Automatic capture of **highlights** (kills, deaths, assists, multikills) and optionally full matches; a timeline of match events; trim and share clips `[?]` **(K)**. The alternatives in this niche are Insights Capture, Medal and Allstar `[?]` **(K)**. For comparison, DPM.lol's non-Overwolf desktop app has a "Game Recorder" (S21a). | Free with ads `[?]` | (K), S21a |

---

## 8. Merged feature matrix

**App codes**

| Code | App |
|---|---|
| PORO | Porofessor |
| MOBA | Mobalytics |
| UGG | U.GG |
| FACE | Facecheck |
| DEEP | DeepLoL |
| LOG | League of Graphs |
| TA | Team Advisor |
| PCG | ProComps.gg |
| STAT | STATUP.GG |
| ITR | iTero |
| OPGG | OP.GG Desktop |
| OUTP | Outplayed |
| HEX | Hexgate |

A trailing `?` means the feature is unverified for that app. Notes include the feasibility or data source for a native (Tauri/Rust) app with no overlay, and any policy status.

| Feature | Category | Apps that have it | Notes |
|---|---|---|---|
| Auto-detect client and game phase; pop the right window (champ select, loading, post-game) | A. Client integration & automation | PORO, MOBA, UGG, FACE?, ITR, TA? | LCU lockfile, REST and WebSocket (WAMP) events, plus the Live Client Data API on 127.0.0.1:2999. Baseline expectation. |
| Rune page import (auto on lock-in, or one click) | A. Client integration & automation | PORO, MOBA, UGG, FACE?, ITR, OPGG (auto-adjust) | LCU `/lol-perks/v1/pages`. Allowed. OP.GG's automatic adjustment is criticized as intrusive, so prefer explicit or optional. |
| Item-set import (shows in the in-game shop) | A. Client integration & automation | PORO, MOBA, UGG? | LCU item-sets endpoint. Allowed. |
| Summoner-spell import with a Flash D/F preference | A. Client integration & automation | MOBA ("Default Flash Position"), PORO?, FACE? (`spellsPositions`) | LCU `PATCH /lol-champ-select/v1/session/my-selection`. Allowed when user-initiated (S21e). |
| Skill-order push or reminder | A. Client integration & automation | PORO ("push … skills") | No LCU write exists for skill order. It is shown as a guide or reminder. |
| Auto-accept ready check | A. Client integration & automation | TA (removed), FACE? (clone plan) | LCU `/lol-matchmaking/v1/ready-check/accept`. Common in lightweight tools. |
| Custom build library ("My Playstyles": start items, core, situational, runes, shards, 1-18 skill order, spells, patch, author) | A. Client integration & automation / G. Champion data | FACE? | Local JSON. Cheap, and loved by one-tricks. |
| Meta overview for your champion (tier, counters, ban suggestions, recommended runes) | B. Champion select / draft | PORO, MOBA, UGG, ITR, OPGG | Needs an aggregated stats backend or a third-party data provider. |
| Ban suggestions | B. Champion select / draft | PORO, ITR, PCG? | – |
| Counter-pick suggestions | B. Champion select / draft | PORO, MOBA, UGG, ITR, PCG, TA | Draft-aware scoring is iTero's and ProComps' differentiator. |
| Pick suggestions from **your** champion pool | B. Champion select / draft | ITR, PCG (premium live pool), TA? | – |
| Team-comp analysis: AP/AD split, frontline, engage, peel | B. Champion select / draft | MOBA, PCG, PORO (team tags) | Static champion attributes (Data Dragon tags plus a curated table). |
| Team power-spike curves (early, mid, late) | B. Champion select / draft | MOBA | Static display is fine. Power-spike *notifications* in game are `[POLICY]`. |
| Game plan / win conditions / "Playing against" tips | B. Champion select / draft | MOBA, PORO (loading-screen lane tips) | Editorial or AI content. |
| Lobby (ally) scouting during champ select | B. Champion select / draft | PORO, MOBA, UGG? | `[POLICY]` Allies are anonymous in ranked Solo/Duo. Only works in other queues. "Reveal names" is forbidden. |
| Automatic loading-screen scouting of all 10 players | C. Pre-game & loading screen | PORO (signature), UGG, MOBA?, FACE, ITR? | Riot API: spectator-v5, league-v4, match-v5, mastery-v4. Needs a production key or your own backend (rate limits). Streamer-mode players are hidden since 25.20. |
| Player cards: rank, LP, season WR and games, previous-season rank, champion WR, games and K/D/A, main roles | C. Pre-game & loading screen | PORO, UGG?, MOBA? | Porofessor defaults to a 30-day window, with a season option. |
| **Behavior and performance player tags** (Aggressive laner, Good CSer, OTP, Fill?, casual or newbie on champion, first game today, invader, roamer, split pusher, stealer, vision good or bad, Super X) | C. Pre-game & loading screen | PORO (signature), MOBA (badges and labels such as "Aggressive Laner" and "Vision Controller") | Percentile against the same champion; per-10-minute stats; 30-day window. See §1.2 for the full list. |
| Team-level tags in the team recap | C. Pre-game & loading screen | PORO | Exact labels unverified. |
| Premade / duo group detection | C. Pre-game & loading screen | PORO | Match-history co-occurrence. `[POLICY]` Fails for the whole lobby if anyone uses streamer mode (25.20). |
| Pro-player (and streamer?) identification | C. Pre-game & loading screen | PORO (blue "Pro:" tag), DEEP (pro pages) | Needs a curated list of pro accounts. |
| Queue and window filters for scouting stats (Solo, Flex, ranked-only; 30 days or season) | C. Pre-game & loading screen | PORO | – |
| Lane matchup tips at the loading screen | C. Pre-game & loading screen | PORO, MOBA | – |
| Win probability / prediction | C. Pre-game & loading screen / D. In-game | PORO?, HEX?, (DPM, other researcher) | May fall under "no decision dictation" and depends on how it is presented. |
| Jungle camp respawn timers | D. In-game | PORO, MOBA | `[OVERLAY]`. Not on Overwolf's prohibited list, but one 2025 doc lists "jungle timers" as banned (S21e). Verify before building. Could live on a second screen. |
| Inhibitor respawn timers | D. In-game | PORO | `[OVERLAY]`. Live Client Data events. |
| Dragon, Baron and Herald timers | D. In-game | PORO?, MOBA | `[OVERLAY]`. Live Client Data events. |
| Enemy summoner-spell timers (manual click) | D. In-game | PORO (historic), League Tracker? | `[OVERLAY]` `[POLICY]` **Prohibited.** |
| Enemy ultimate timers | D. In-game | PORO (Feb to Mar 2025) | `[OVERLAY]` `[POLICY]` `[OUTDATED]` **Banned on 13 Mar 2025.** |
| CS at 10 and 20 minutes and live CS counters | D. In-game | PORO, MOBA | `[OVERLAY]`. Live Client Data `creepScore`. Fine for your own stats. |
| Team gold difference with graph | D. In-game | PORO, MOBA | `[OVERLAY]`. Estimated from items via Live Client Data, since exact enemy gold isn't exposed. |
| Ward and vision stats at 10 and 20 minutes ("Vision Mastery") | D. In-game | PORO | `[OVERLAY]` |
| Build, next-item and skill-order overlay | D. In-game | MOBA?, UGG?, PORO?, HEX (adaptive) | `[OVERLAY]`. Could work as a second-screen window. |
| Matchup tips and power spikes shown in game | D. In-game | MOBA | `[OVERLAY]`. Static info is OK; *alerts* are `[POLICY]`. |
| In-game goals and micro-challenges | D. In-game | MOBA | `[OVERLAY]` |
| AI voice coaching during the match | D. In-game | MOBA (Plus), STAT | `[OVERLAY]` / audio. Reviews are poor (STATUP 2.3/5). Risk of "dictating decisions" `[POLICY]`. |
| Patch-note summaries in game | D. In-game / G. Champion data | PORO, FACE (patch-notes lite) | Static data. |
| Overlay hotkeys, transparency and widget layout | D. In-game / K. Settings & UX | PORO, MOBA? | `[OVERLAY]` |
| Post-game summary: scoreboard, team objectives, gold and damage | E. Post-game & match analysis | PORO, MOBA, UGG, FACE, ITR | match-v5 plus timeline. |
| Matchup review against the lane opponent (CS, gold, XP diffs at 10 and 14 minutes) | E. Post-game & match analysis | PORO, FACE (tags built on @14 diffs) | match-v5 timeline frames. |
| **Post-game insight tags / badges** with sentiment and coaching sentences | E. Post-game & match analysis | FACE (78+3, §4.3), MOBA (badges), OPGG (MVP/ACE plus 14 keywords, other researcher) | Very cheap to build from match-v5 challenges and the timeline. |
| Performance score per game | E. Post-game & match analysis | MOBA (GPI delta), DEEP (AI-Score), FACE (MVP flag) | Keep the method transparent; proprietary scores get disputed (S21a). |
| Personalized improvement advice / "focus today" card | E. Post-game & match analysis | MOBA, PORO | – |
| Smart highlights (automatic clips) | E. Post-game & match analysis / J. Media | MOBA?, OUTP | Needs video capture (GPU encoder). Heavy for a lightweight app. |
| Profile and match history | F. Profile, match history & progression | PORO/LOG, MOBA, UGG, DEEP, FACE | – |
| Skill radar (8 axes, rank-anchored, before-vs-now overlay, drill-down) | F. Profile, match history & progression | MOBA (GPI) | – |
| Role and queue stats (W/L, KDA, CS/min, KP, LP) | F. Profile, match history & progression | MOBA, UGG | – |
| Rank / tier prediction | F. Profile, match history & progression | DEEP | `[POLICY?]` Close to "no MMR/ELO calculators". |
| Champion leaderboard rank (#N on a champion) | F. Profile, match history & progression / I. Social & leaderboards | LOG (feeds PORO "Super X") | Needs a large crawl. |
| Personal tier list | F. Profile, match history & progression / G. Champion data | UGG (PLUS) | – |
| Challenges / missions | F. Profile, match history & progression | MOBA | – |
| Tier lists (role, elo, patch, region filters) | G. Champion data | MOBA (expert-curated plus stats), UGG, LOG, DEEP? | Aggregated backend needed, or partner data. |
| Builds, runes and skill orders by role, elo, patch and region | G. Champion data | UGG, MOBA, PORO, LOG | – |
| Counter and matchup pages | G. Champion data | UGG, MOBA, DEEP, PORO | – |
| Combo guides | G. Champion data | MOBA (Plus) | – |
| Duo / synergy tier list | G. Champion data | UGG, DEEP | – |
| Pro builds | G. Champion data | UGG, MOBA? | – |
| TFT support | H. Game modes | PORO (Team Builder; expanded Apr 2026), MOBA, UGG | – |
| ARAM / ARAM Mayhem | H. Game modes | UGG (Mayhem tier list), FACE (Mayhem post-game), MOBA (Mayhem lagged for months) | Mayhem data isn't in Riot's API (S21e). |
| Arena (augments) | H. Game modes | MOBA?, UGG? | `[POLICY]` No win rates for augments or Arena items; pick rate is OK. |
| URF | H. Game modes | FACE | – |
| Brawl | H. Game modes | – | `[POLICY]` Reported off-limits (S21e). |
| Legends of Runeterra | H. Game modes | PORO (deck tracker), MOBA | `[OUTDATED]` (sunset). |
| LFG / duo finder | I. Social, multi-search, leaderboards, pro/esports | PORO, LOBLY (development) | An explicitly approved Riot use case. |
| Web multi-search (paste lobby names) | I. Social, multi-search, leaderboards, pro/esports | PORO (/pregame), OPGG, UGG? | `[POLICY]` Can't be used to de-anonymize ranked lobbies. |
| Live-games browser (by champion or elo; pros in game) | I. Social, multi-search, leaderboards, pro/esports | PORO, DEEP | `[OUTDATED?]` Degraded since the Oct 2025 spectator change. |
| Leaderboards | I. Social, multi-search, leaderboards, pro/esports | LOG, UGG?, DEEP? | – |
| Twitch extension | I. Social, multi-search, leaderboards, pro/esports | MOBA | – |
| Pro / reference replays | J. Media | PORO, LOG (recent replays feed) | Riot now offers replay files through the match endpoint (Oct 2025). |
| Live spectate launched from the app or site | J. Media | PORO (historic) | `[OUTDATED]` Disabled for third parties, Oct 2025. |
| Game recording and highlights | J. Media | OUTP, MOBA? | Heavy. |
| Overwolf dependency | K. Settings, UX, platform, performance, monetization | PORO (optional since Dec 2025), MOBA, UGG, FACE, TA, PCG, STAT | The #1 source of complaints: RAM, ads, account. |
| Non-Overwolf standalone build | K. Settings, UX, platform, performance, monetization | PORO (Electron), ITR | Electron is still heavy; a native or Tauri build is the owner's edge. |
| Ad-free premium | K. Settings, UX, platform, performance, monetization | PORO, MOBA ($7.99), UGG ($3.99), OPGG ($3) | Riot requires a free tier; paid content must be "transformative". |
| Localization | K. Settings, UX, platform, performance, monetization | PORO 21, LOG 20, MOBA 17, UGG 1 (EN) | – |
| Mobile companion | K. Settings, UX, platform, performance, monetization | PORO (Android wrapper of the website) | – |

---

## 9. Synthesis for the owner

### Most distinctive and best-loved features across these apps

1. **Porofessor's automatic loading-screen scouting with tags.** Short, colored, champion-contextual labels explain each player at a glance: `Aggressive laner`, `Good CSer`, `OTP Qiyana`, `Fill?`, `Blitzcrank casu`, `Newbie with Soraka`, `1st game today`, `Invader`, `Roams a lot`, `Split pusher`, `Stealer`, `Good/Bad vision`, `Super Lee Sin`, `Pro: X`. Premade markers and team tags come with them. The tooltips always give the number and the comparison base.
2. **One-click or automatic imports** of runes, items and spells, including Mobalytics' "Default Flash Position" detail.
3. **Mobalytics' GPI radar and post-game "why did I lose" loop**: 8 axes, rank-anchored, then vs now, drill-down, and "focus on your 1-2 weakest areas".
4. **Post-game insight tags** with punchy names and a one-sentence coaching line: Facecheck-format "Chovying", "Goblin", "Inthibitor", "Jungler Food", "Stone Wall"… These give personality at almost no data cost.
5. **LFG / duo finder** and **pre-game multi-search**. Both are explicitly Riot-approved categories.

### Most common complaints (the product gap)

- **Overwolf dependency**: RAM and CPU use, a forced account, and slow or failed loading at peak hours. This is why Porofessor finally shipped a standalone app in Dec 2025, but on Electron.
- **Ads and paywall creep.** Examples: Mobalytics has rising ads, a $7.99 Plus and a hard-to-cancel flow; U.GG and OP.GG ads and dark patterns; the Porofessor ad covers content.
- **Bugs and staleness.** Porofessor is described as "aging, rising error reports". Mobalytics is "freezing, bugs, 3.6★" and slow to add new modes such as ARAM Mayhem.
- **UI bloat** (Mobalytics) against the demand for glanceable info (Porofessor).
- **Fair-play backlash** against live overlays: the ultimate-timer episode led Riot to ban it. More broadly, enemy-cooldown trackers and power-spike or "go gank" notifications are banned.

### Platform risks to carry into triage

- The Riot rules are the ones listed in §0.
- Scouting only makes sense from the loading screen onward, and streamer-mode players are invisible.
- Premades can't be detected when anyone in the lobby uses streamer mode.
- Third-party live spectating is gone.
- Arena and augment win rates are forbidden.
- MMR-like predictions are risky.
- In-game ads are banned.

---

## 10. Sources

**Porofessor, official and press**

- S1. Porofessor Overwolf listing: https://www.overwolf.com/app/trebonius-porofessor.gg (via search snippets: jungle timers, "push builds, runes and skills", Meta Overview, post-match analytics, duo finder).
- S2. Overwolf landing pages: https://go.overwolf.com/porofessor/ · https://game.overwolf.com/porofessor-learn-lol/
- S3. porofessor.gg: https://porofessor.gg/ · FAQ https://porofessor.gg/faq · Current games https://porofessor.gg/current-games
- S4. Porofessor support: https://porofessor.gg/support · /support/champselect · /support/resolution · /support/weird-display · /support/empty
- S5. M.O.B.A. Network, 30 Jun 2025, "Porofessor Reaches 15.5 Million Installs…": https://storage.mfn.se/874750fb-1026-454f-9dd8-5a6d54a920af/porofessor-reaches-15-5-million-installs-as-premium-strategy-and-monetization-framework-deepen.pdf · https://www.inderes.dk/en/releases/porofessor-reaches-155-million-installs-as-premium-strategy-and-monetization-framework-deepen
- S6. M.O.B.A. Network, 5 Dec 2025, "Launches Standalone Version of the Porofessor App" (Electron): https://storage.mfn.se/d51c3c2d-8084-49bd-bc8b-3e18cccdcb7a/m-o-b-a-network-launches-standalone-version-of-the-porofessor-app.pdf · https://www.inderes.se/en/releases/moba-network-launches-standalone-version-of-the-porofessor-app
- S7. M.O.B.A. Network Q1 2026 and repositioning (TFT expansion Apr 2026; 16.6M installs; performance tracking in development): https://mfn.se/a/m-o-b-a-network/summary-of-interim-report-one · https://www.inderes.fi/en/releases/moba-network-repositioned-as-focused-higher-margin-gaming-product-company-following-the-union-for-gamers-divestment
- S8. Ultimate-timer controversy: https://www.dexerto.com/league-of-legends/popular-league-of-legends-add-on-criticized-for-adding-cheat-feature-players-think-should-be-banned-3142237/ · https://www.zleague.gg/theportal/the-league-of-legends-debate-is-porofessors-ultimate-cd-tracking-a-cheat/
- S9. Wargraphs acquisition: https://www.pcgamer.com/corporation-buys-a-popular-league-of-legends-app-for-dollar55-millionits-made-by-one-guy/ · https://medium.com/overwolf/wargraphs-sold-for-54m-5ad96c13aa41

**Riot platform changes**

- S10. Streamer-mode API change, Oct 2025: https://x.com/Sheep_Esports/status/1979286341809770888 · https://x.com/LeagueOfLegends/status/1980434309736771638 · https://blog.loltheory.gg/lol-streamer-mode/
- S11. Champ-select anonymity: https://win.gg/news/heres-why-you-cant-see-usernames-in-champion-select/ · https://blog.loltheory.gg/lol-streamer-mode/

**Articles quoting Porofessor tags and features** (secondary; some are SEO content)

- S12a. https://vonguru.fr/2020/01/07/porofessor-lallie-des-joueurs-de-league-of-legends/
- S12b. https://www.sedivertir.eu/102228/porofessor-tendances-et-statistiques-des-joueurs-league-of-legends/
- S12c. https://www.petit-jedi.fr/porofessor-comment-optimiser-votre-jeu-dans-league-of-legends/
- S12e. https://www.appbrain.com/app/porofessor-gg/gg.porofessor.app
- S13. https://lolnow.gg/porofessor/
- S14. "Introducing Porofessor.gg" (2017 boards post): https://boards.na.leagueoflegends.com/en/c/general-discussion/RbbLgNhq-introducing-porofessorgg
- S15. https://happysmurf.com/blog/what-is-opgg/
- S16. https://buildzcrank.com/en/blog/porofessor-alternatives/ · https://buildzcrank.com/en/blog/mobalytics-vs-blitz-vs-porofessor/ · https://buildzcrank.com/en/blog/lol-companion-app-without-overwolf/
- S17. https://hexgate.app/blog/mobalytics-vs-porofessor/ · https://hexgate.app/blog/best-lol-overlays-2026/
- S18. https://windowsreport.com/porofessor-overlay-not-working-in-game-why-how-to-fix/
- S19. YouTube:
  - (a) "What Tags do you get on Porofessor.gg?" https://www.youtube.com/watch?v=0RozL6-lY0A
  - (b) "This is how you find out if a teammate is tilted #ad #porofessor" https://www.youtube.com/watch?v=0__gH0WI4uk
  - (c) "LOL Spell Timer App Comparison | Porofessor vs League Tracker" https://www.youtube.com/watch?v=_A7u-Nw4OWY

**GitHub primary data** (real scraped output or data formats)

- S20a. tbocquet/the-quest: persisted Porofessor live game with FR tags and tooltips, the scraper and its types:
  - https://raw.githubusercontent.com/tbocquet/the-quest/6a2d4f16b03483437e00ee5b400e1ab459820898/the-quest-back/persistantLiveGame.ts
  - …/the-quest-back/services/porofessor.ts
  - …/the-quest-back/models/porofessor-types.ts
- S20b. Gurimarukin/thequest, Porofessor parser (niceness colors, premade container, streamer mode):
  - https://github.com/Gurimarukin/thequest/blob/e24e44e58245f46e6fc7e77b6f4aa54295e01c31/src/server/services/PoroActiveGameService.ts
  - …/src/shared/models/api/activeGame/PoroNiceness.ts
- S20c. SirDomin/league-app: Porofessor scraper (tag color classes) and Mobalytics GraphQL scraper (badges, gpi, performanceMetrics):
  - https://github.com/SirDomin/league-app/blob/master/src/DataScrapper/PorofessorScrapper.php
  - …/MobalyticsScrapper.php
  - migrations with the match-v5 challenge fields
- S20d. Lyfhael/league-loader-plugins "display_back_summoner_names" (uses porofessor.gg pregame-partial): https://github.com/Lyfhael/league-loader-plugins
- S20e. zquaa/LCU-Stats (auto-accept plus Porofessor multi-search): https://github.com/zquaa/LCU-Stats
- S20f. Remynder0/HextechCore, Facecheck-format JSON (myPlayStyles, postGame, patchNotesLite…): https://github.com/Remynder0/HextechCore/tree/main/src/data/facecheck · AGENTS.md
- S20g. uBlock Origin filters listing DeepLoL ad slots: https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters-2026.txt

**GitHub secondary research** (other builders' 2025-2026 competitive analyses, which quote primary sources)

- S21a. LINDECKER-Charles/LeagueOfDataBaseFinal, `docs/produit/analyse-concurrentielle.md` (July 2026). Covers porofessor.gg/faq, u.gg/faq, Mobalytics pricing and languages, the Riot sanctions timeline, and DeepLoL, LoG and DPM: https://github.com/LINDECKER-Charles/LeagueOfDataBaseFinal/blob/main/docs/produit/analyse-concurrentielle.md
- S21b. Kuderic/RabadonGG, `docs/research/competitive-analysis.md` and `monetization.md`. Covers the May 2025 ad ban and competitor pricing and features.
- S21c. JonathanPegaz/coach-diff, `docs/LoL-Coach-Analyse-Marche.md`. Covers installs and ratings: Porofessor 16.1M/4.1★, U.GG 5M+/4.0★, Mobalytics 3M+/3.9★, iTero 394K/4.5★, Team Advisor ~100K/3.7★.
- S21d. luansilvadb/educador_de_fundamentos_lol, `.planning/research/FEATURES.md` and `phases/05-overlay-window-compliance/05-RESEARCH.md`. Covers the competitor feature table, the Porofessor Overwolf page (17.4M), and the Overwolf Riot compliance list.
- S21e. niftymonkey/champ-sage, `docs/exploration.md` and `docs/research/augment-detection-research.md`. Covers Riot policy, the Mobalytics spell-import support article, and the lack of ARAM Mayhem support.
- S21f. stewdeveloper/diana, `docs/new-design.md`. Covers 2026 ratings and sentiment.
- S21g. renanaugustomacena-ux/Counter-Strike-coach-AI, `docs/research/global_startups.md`. Covers GPI mechanics, DeepLoL, OP.GG and Blitz.
- S21h. dedlich/lolchecker, `src/champ_assistant/ui/live_companion_view.py`. A "Mobalytics-style" Live Companion layout.
- S21i. nyx-haile/howtowin.lol, `docs/site_pedagogy_engagement_lit_review.md`. Covers Mobalytics overlay and labels, and UI bloat.
- S21j. smmdsa/riftloop, `RiftLoop_PRD_v1.0.md`. Porofessor: pregame, match analysis, reference replays.
- S21k. ryanpolasky/Ryot, CHANGELOG and download page. "Porofessor-style draft tags".
- S21l. needahmed/lobly, `LOBLY_Product_Spec.md` and `LOBLY_Architecture.md`. Facecheck is an Overwolf Native scouting app.
- S21m. AngelPedroza/macro, `plan.md`. iTero described as "Fully Riot Compliant"; iTero, Mobalytics, Porofessor and Blitz described as Windows-only because of Overwolf (this is partly outdated: Blitz and iTero ship standalone).

**Policy primary text** (backed up in GitHub repos)

- S25. Overwolf Riot compliance: https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games/ (quoted in S21d and S21e)
- S26. Riot developer policies: https://developer.riotgames.com/policies/general · https://developer.riotgames.com/docs/lol (backups: https://github.com/Roeschstudio/Lol_RMX_LATAM/blob/main/RIOTDOCSAPI.md · https://github.com/HermannPR/BlindSpotLOL/blob/main/docs/LEAGUE_API_DOCUMENTATION_BACKUP.MD)

**Other**

- S27. STATUP.GG Overwolf page: https://www.overwolf.com/app/gamer_republic-statup.gg
- S29. iTero companion-app article: https://www.itero.gg/articles/what-is-the-best-league-of-legends-companion-app-in-2025
- S30. Alucare: https://www.alucare.fr/en/porofessor-gg-the-site-that-predicts-in-advance-your-victory-or-defeat/
- S31. WeCoach: https://wecoach.gg/blog/article/all-you-need-to-know-about-porofessorgg-a-complete-guide
- S32. AdfreePorofessor: https://github.com/CallumMcLoughlin/AdfreePorofessor
- Mobalytics desktop landing page (cited by S21d): https://mobalytics.gg/lol/glp/app-download
- u.gg FAQ (cited by S21a): https://u.gg/faq
- DeepLoL: https://www.deeplol.gg/
- Enemy Stats: https://www.overwolf.com/apps/enemy-stats
