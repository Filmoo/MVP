# B — Standalone (non-Overwolf) desktop apps + open-source LoL client tools

Research date: **2026-09-27**. Scope: Blitz.gg desktop, OP.GG for Desktop, DPM.LOL Desktop App (launched 2026-09-26), the unofficial `ptrtht/dpm-desktop`, and open-source community tools (LeagueAkari, Seraphine, ChampR + ~25 others). Written so it can be merged with the other research reports (same taxonomy A–K).

## How to read this

- **Tags**: `[FREE]` available without paying · `[PREMIUM]` needs a paid tier · `[?]` unverified or unclear (reason given) · `[OVERLAY]` drawn over the game (in-game overlay, **out of MVP scope but catalogued**) · `[WEB]` exists on the vendor's website, not confirmed inside the desktop app · `⚠` policy/ToS/anti-cheat risk (see §0.3).
- OSS tools are free by definition. Their `[FREE]` tag is omitted.
- **Evidence quality** (be aware when triaging):
  - **OSS tools: high.** I cloned the repositories and read the source, i18n strings, changelogs and READMEs directly (commit dates are given).
  - **Blitz / OP.GG / DPM: medium.** Their websites are blocked from this environment (egress proxy; one confirmation attempt on dpm.lol failed). Features come from web-search extracts of official pages (support/help centers, feature pages, patch notes, changelog, X/Twitter posts), two third-party competitive analyses published on GitHub (one dated 2026-07-17), winget manifests, and 2026 review/comparison blogs. Anything from a single secondary source is marked `[?]`.
  - The WebSearch budget (200 calls, shared by the session) ran out partway through, so some gaps could not be closed. They are listed as `[?]`.
- **Possibly outdated** items are flagged *(possibly outdated)*.

---

## 0. Executive summary

### 0.1 Most distinctive features seen

| App | Signature features |
|---|---|
| **DPM.LOL Desktop** (native, no ads, no Overwolf; public 2026-09-26) | Draft Helper that scores every champion against both comps and the meta and shows the team's **win probability** in draft. Composite **DPM Score** next to each player's rank. Draggable, independent overlay panels: Objective Pills, Gold Difference, live Win Probability, "is this fight yours", next-item / trinket / support-item notifications, full-clear timer. **ARAM: Mayhem augment tiers drawn on the augment cards**. Built-in **game recorder**: full-game replays with kill/objective markers, auto-clips (multikills, steals, aces), instant-replay hotkey, hardware encoding up to 1440p60, clip gallery and trimmer, link sharing coming. One-click pro spectate. Skin-collection tracker. |
| **Blitz** (Electron, Win+Mac, ads + Blitz Pro $4.99/mo) | Best-in-class **automatic import** of runes, summoner spells and item sets on lock-in. Pick/ban suggestions. Loading-screen overlay with rank, WR and champion pool. Many in-game overlays: benchmark vs lobby, item value, **ally** ult timers on portraits, jungle timers and route, CS overlay, support-item overlay, trinket reminder, ARAM relic timers, ARAM Mayhem and Arena augment help. **Phone companion app** you can draft from. ProBuilds. Premium adds Masters+ builds, customisable CS overlay, support-item overlay and removes ads. |
| **OP.GG for Desktop** (ow-electron, Win+Mac, ads + Ad-free sub) | "Live Controller" (OP.GG Pick, Multi-Search, Champion Pick, In-Game Info). Automatic multi-search. Auto runes, items and spells, plus masteries for **League Classic**. Overlays: jungle path on minimap, jungle and inhibitor timers, spell tracker, gold/item comparison, **healing-item tracker**, ward count, skill order, ARAM relic timers. Doom Bots clear ranking. Game launcher. Monthly **quests/points/prize events**. |
| **LeagueAkari** (OSS, Electron+Vue, 4.3k★) | Most complete LCU toolkit. Covers all gameflow automation. Per-mode and per-position auto pick/ban with human-like timing, bench swap, trade handling. Deep **10-player analysis** from champ select through the game: 12+ behavioural tags, premade inference, "met before", jungler pathing profiles. Very rich match card (100+ stats, event map, rune stats, line charts). Replay download, spectate, claim/loot/friend tools, cosmetic tweaks, streamer mode, overlay windows. |
| **Seraphine** (OSS, PyQt, archived) | Automatic teammate and opponent history lookup. Auto B/P and swap acceptance. OP.GG tiers and builds with one-click runes. ARAM buffs. 5v5 practice lobby. Spectate. Lock game settings. Cosmetic tweaks. |
| **ChampR** (OSS, Rust) | Build and rune importer with multiple data sources (op.gg, lolalytics, u.gg, murderbridge, 101.qq). Moved from Electron (~70 MB) to Tauri (~4 MB) and now a native **Slint** UI. |
| Other OSS worth copying ideas from | **rank-analysis** (Tauri 2, ~5 MB installer, LLM match review, player notes with cloud sync). **xyra** (Rust+Tauri. Reads ARAM Mayhem and Arena augment cards with **Windows OCR** and draws labels in a **native Direct2D click-through layer**, no webview in game. Android remote over Wi-Fi/Tailscale). **league_record** / **ninja-recorder** (Rust recorders with event-marked timelines; ~5 MB idle RAM; WGC + Media Foundation capture). **DraftGap** (Tauri draft analysis synced with champ select). **Mimic** / Blitz mobile (phone remote for champ select). **Deceive** (appear offline, Riot-tolerated). |

### 0.2 What "native" means for DPM (and what is known about the stack)

- Marketing line: "**Draft Helper. Overlays. Replays. Native. No ads. No Overwolf.**" (X, 2026-09-26). The CEO describes it as "a whole new platform with no ads, no Overwolf" (esports.gg).
- The exact tech stack is **not disclosed** in any source I could reach. I found no job posts, no GitHub organisation, no winget manifest and no public binary analysis.
- Indirect clues (inferences, `[?]`):
  - The changelog says "the app now installs with a proper **setup wizard**, into a fixed folder, and **updates itself**; existing installations move over on their own at the next launch, and keep their '**Run as administrator**' setting". That points to a classic Windows installer plus a custom updater.
  - Recording uses **hardware encoding on NVIDIA, AMD and Intel up to 1440p 60 fps**. That implies a native capture/encode pipeline (NVENC/AMF/QSV), not a browser API.
  - "Native" at least means *not Electron and not Overwolf*. Whether the UI is fully native or a system-WebView shell (Tauri/WebView2 style) is unknown.
- The **unofficial** `ptrtht/dpm-desktop` (March 2025) is a thin **Electron** wrapper that loads dpm.lol pages. Its author took down the binaries after DPM asked, because it "might hurt DPM's RIOT verification". It is not DPM's app.

### 0.3 Policy flags that affect triage (facts gathered while cataloguing)

- **2025-03-13**: Riot banned the "**Enemy Ultimate Timer**" feature in all third-party apps, on pain of API-key revocation, after the Porofessor backlash. Blitz shows **ally** ult timers only.
- **May 2025**: Riot prohibited overlays "that **simulate decision-making**" and ended third-party ads inside Riot properties. This puts **live win probability**, "fight reads" and prescriptive live suggestions (DPM) in a grey zone. Source: third-party analysis citing Riot; verify with Riot DevRel.
- Riot's General Policies ban "**MMR/ELO calculators and alternatives to official ranking systems**". Composite scores such as DPM Score, Akari Score, hh-lol-prophet "horse" tiers and OP Score are debatable. The TrueMain team explicitly refused to copy DPM's player score and black-box win probability for this reason.
- Player-facing policy against apps "**taking actions on your behalf**": auto-accept, instalock and pick automation are grey. The **2019 LCU policy** mentions an endpoint allowlist and says players in **Korea** may not use LCU-based apps (LeagueAutoAccept repeats this warning). Rune-page writes on an **explicit user click** are widely done (Blitz, OP.GG, DPM).
- **Champ-select anonymity (since patch 12.22)**: revealing hidden names ("lobby reveal") is enforced against.
  - **KBotExt** became **Vanguard-bannable** (14-day ban on first offence) on 2024-12-13, after it became the main lobby-reveal tool.
  - **LobbyReveal** was archived after a Riot statement.
  - **LeagueAkari** ships a closed native `magic.node` behind a remote feature gate to de-obfuscate hidden PUUIDs. **Do not copy.**
- Chinese tool **frank** removed match-history lookup "according to official requirements" (Tencent). This is a signal that lobby history lookup is sensitive in some regions.
- Riot's legal terms ("Legal Jibber Jabber"): **a free tier is mandatory**, registered products may monetise, and "Products should use supported services from Riot Games for data ingestion".
  - Several OSS tools call **Riot's internal SGP endpoints** (`*.pvp.net`) with the client's session tokens.
  - Several OSS tools scrape **OP.GG's private API** (`lol-api-champion.op.gg`).
  - Both are unlicensed data paths.

---

## 1. Commercial standalone apps

### 1.1 Blitz.gg — desktop app (Blitz, Inc. / Swift Media Entertainment, same holding as TSM)

**What it is:** a multi-game companion app. Games: League of Legends, TFT, VALORANT, LoR historically, Apex, Fortnite, CS, Marvel Rivals and more. Founded in 2018. It absorbed the Champion.gg/ProBuilds team (Nov 2018). Distributed with its own installer, **not Overwolf**.

**Platform / tech**

- Windows and macOS desktop. **Overlays are Windows-only** and are not supported on PBE.
- Built on **Electron**:
  - Community ad-block patchers modify `app.asar` (`lulzsun/blitz-app-adblock`, 185★, now broken).
  - Listed as Electron by the TrueMain analysis.
- NSIS (`nullsoft`) per-user installer. winget `Blitz.Blitz` **2.1.630 released 2026-09-05**. Frequent releases: versions 2.1.100 → 2.1.630 are all in winget.
- A mobile app (iOS/Android) pairs with the desktop app.
- Backend: Elixir, Databricks lakehouse.
  - Blitz support says it uses official APIs.
  - A Databricks blog co-written by a Blitz data engineer mentions "reverse engineering" and a "scraping backend".

**Pricing:** free with ads ("heavy ads" per a 2026 review). **Blitz Pro / Blitz Premium** is **$4.99/month** standard, with regional pricing based on the card's issuing country. One subscription covers every Blitz game. Pro perks for LoL:
- ad-free experience
- **Masters+ builds**
- **customisable CS overlay**
- **support-item overlay**

*(Older posts also mention "Pro Builds+". Possibly outdated.)*

**Features**

A. Client integration & automation
- Detects the game automatically; no setup ("simply jump directly into a game") [FREE]
- A pop-up appears on champion **hover or lock-in** asking for build preferences and overlay settings [FREE]
- **Auto-import of runes, summoner spells and item builds** as soon as you lock in. Can be toggled on or off. Requires summoner level ≥10 [FREE]
- One-click import of **pro builds** [FREE]
- **Phone remote**: the Blitz mobile app, paired with the PC or Mac app, lets you **draft entirely on your smartphone**. Both apps must be running and logged in. [FREE] [?] (tier not stated)
- Auto-accept ready check: **not found** in any Blitz source [?]

B. Champion select / draft
- Pick and ban suggestions: "S-tier pick and ban recommendations based on your **past performance, team comp, opponents, and metagame trends**", "power picks, synergies, counters" [FREE]
- Live statistics on your team and the enemy team during champ select [FREE]
- Champion detection in champ select via **computer vision** [?] (only one 2026 third-party analysis says this; may be legacy)
- Build variants per role or preference, chosen in the pop-up [FREE]

C. Pre-game & loading screen
- **Loading Screen Overlay**: each player's rank, win rate, recent performance and most-played champions. Also described as "rank histories, champion pools" [FREE] [OVERLAY]

D. In-game (all Windows-only)
- **Benchmarking overlay**: tracks key performance metrics in real time and compares them with your teammates or with the best player in the lobby [FREE] [OVERLAY]
- **CS overlay**: a keybind shows it for 5 s; hidden when you play support [FREE] [OVERLAY]. The **customisable** version is [PREMIUM].
- **Support-item overlay**: tracks when your support item will upgrade [PREMIUM] [OVERLAY]
- **Skill-order overlay**: tells you which skill to level, based on the selected Blitz build [FREE] [OVERLAY]
- **Timers** for jungle camps, inhibitors and dragon ("minimap timers") [FREE] [OVERLAY]
- **Teammate ultimate timers** shown on ally portraits [FREE] [OVERLAY]. Allies only; enemy ult timers are banned since March 2025.
- **Item value / inventory comparison** ("evaluate and compare the value of players' item inventories") [FREE] [OVERLAY]
- **Jungle pathing / clear-route overlay** ("the most effective jungle camps clearing route") [FREE] [OVERLAY]
- **Trinket reminder** [FREE?] [OVERLAY]
- **ARAM health-relic respawn timers** [FREE] [OVERLAY]
- **ARAM: Mayhem augment tier list** shown in game while you pick augments ("hand-crafted") [FREE] [OVERLAY]
- **Arena augment stats** shown while you pick [FREE] [OVERLAY]
- "Objective reminders / situational advice" [?] (secondary blog only)

E. Post-game & match analysis
- **Post-match analysis / report**: performance breakdowns, "key insights", post-game feedback [FREE]

F. Profile, match history & progression
- Stat tracking and a list of previous matches ("track all your stats and view any of your previous matches") [FREE]

G. Champion data
- Tier lists for every mode [FREE]
- Builds, runes and skill order [FREE]
- Counters and matchups [FREE]
- **ProBuilds**: pro players' runes and items, plus how they performed with each build [FREE]
- **Masters+ builds** [PREMIUM]

H. Game modes
- ARAM tier list and relic timers
- **ARAM: Mayhem** augment tier list (web and overlay)
- **Arena** tier list and augment tier list/stats
- **URF** tier list
- TFT has its own overlay set
- Other games

I. Social / multi-search / esports
- Nothing LoL-specific found for the desktop app [?]

J. Media
- No LoL recording or replay feature found [?]

K. Settings, UX, platform, monetisation
- Windows + Mac. Overlays Windows-only.
- Per-game overlay settings.
- Mobile companion app.
- Ads in the free tier. Premium removes them.
- Help-centre articles: auto-import troubleshooting, overlay troubleshooting, "Web vs App".

**UX strengths:**
- 2026 reviews call Blitz the **automation leader** ("leads auto-imports").
- It handles champ select without Overwolf and is "more consistent" with a smaller footprint than Overwolf apps.
- Clean and beginner-friendly.

**Complaints:**
- Heavy ads in the free tier. Two community ad-block patchers exist, both against the ToS.
- High RAM usage ("several GB") [?] (secondary source).
- Trust issues:
  - The data-sourcing contradiction (official APIs vs "reverse engineering").
  - NetEase banned Blitz in Marvel Rivals competitive play as "cheating software" (2025-02-21).

---

### 1.2 OP.GG for Desktop (OP.GG Inc., Korea)

**What it is:** OP.GG's desktop companion and game launcher. Games: LoL, TFT, VALORANT, Palworld, MapleStory (KMS) and more.

**Platform / tech**

- Windows and macOS. Standalone installer, no Overwolf client needed.
- It is listed on the Overwolf store as `opgg-electron-app`. That strongly suggests Overwolf's **ow-electron** runtime (Electron plus Overwolf's SDK and ads) [?] (inferred from the listing).
- Versions:
  - **v2.0.0 (2025-05-08)**: major rework.
  - **v2.5.2 (2026-07-30)**: latest found.
- Web pages: patch-notes page, "download by version" page (rollback) and a **service-status page**.

**Pricing:**
- Free with ads.
- **OP.GG Ad-free** subscription: **₩3,900/month**, 7-day free trial. USD sources disagree: **$3/month** on member.op.gg vs **$3.99/month or $39.99/year** in the App Store.
  - Removes ads across all OP.GG web, mobile and desktop apps when logged in.
  - Adds a **personal stats dashboard** for a main account set on My Page, and "upgraded favorites".
  - Find-Duo posts get a badge and highlight; Clan/Clash post bumps go from every 3 days to daily.
- A higher tier at **₩7,900/month** adds "**Agent**, **AI Voice**, VALORANT replay analysis".

**Features**

A. Client integration & automation
- **Game launcher**: detects your most-played games and starts them in one click [FREE]
- **Auto-set runes and items**; **auto-select summoner spells** by highest pick rate [FREE]
- **League Classic masteries** applied automatically when selected (v2.5.2) [FREE]
- **Live Controller** (v2.0.0): a compact controller with *OP.GG Pick*, *Multi-Search*, *Champion Pick* and *In-Game Info* [FREE]
- "Customised display mode" [?]
- Unified account search platform (v2.0.0) [FREE]

B. Champion select / draft
- **OP.GG Pick** (pick recommendations) and **Champion Pick** [FREE]
- "Instantly see which champions each champion **performs well against and struggles against**" (counters, v2.0.11, 2025-12-08) [FREE]
- **Champion Select page for Classic Mode** (League Classic, v2.5.2) [FREE]
- "Real-time champion information" [FREE]

C. Pre-game & loading screen
- **Automatic multi-search** of your lobby, up to 5 summoners [FREE]
- **Loading-screen information** overlay [FREE] [OVERLAY]

D. In-game overlays (default hotkey **Shift+Tab**; toggled in the Overlay tab)
- **Jungle path**: the most common jungle path for your champion, drawn on the minimap [OVERLAY]
- **Jungle timers** [OVERLAY]
- **Inhibitor timers** (ally and enemy) [OVERLAY]
- **Spell tracker** (summoner spells) [OVERLAY] ⚠? (enemy spell tracking; not covered by the ult-timer ban, but check)
- **Real-time stats** [OVERLAY]
- **Gold & item comparison**: total items and gold difference between the teams [OVERLAY]
- **Healing-item tracker**: enemy healing items vs your team's anti-heal [OVERLAY]
- **Item builds** [OVERLAY]
- **Skill recommendations** (optimised skill order) [OVERLAY]
- **Ward count**: control wards used by your team [OVERLAY]
- **ARAM health-relic timers** [OVERLAY]
- "Recent match details, overall AD/AP ratio for all champions" [OVERLAY]
- TFT only: augment tiers for your current champions; comps in game [OVERLAY]
- A new overlay system plus a legacy "**Classic Overlay**" (v2.5.2 notes: "The Palworld Overlay is only available when using the Classic Overlay") [?]

E. Post-game & match analysis
- Not confirmed for the desktop app [?]. The web has full match details and **OP Score**.

F. Profile, match history & progression
- Account search and profile [FREE]
- **Personal stats dashboard** [PREMIUM] (Ad-free perk)
- Match-history retention on OP.GG is 2–5 months (help.op.gg)

G. Champion data
- "Best builds and in-depth stats through analysis of over **40 million** games" [FREE]
- Champion tier UI; improved **patch-note tooltips** (v2.0.11) [FREE]
- **Champion skill-combo guides** (help centre: "learning champion skill combos") [FREE]
- "AI tips summary (Beta)" on builds [WEB] [?]

H. Game modes
- **Doom Bots**: clear ranking and builds (v2.0.5, 2025-09-02)
- **League Classic**: champ-select page and masteries
- ARAM relic timers
- TFT
- Arena, ARAM, URF and Nexus Blitz builds exist on the web [WEB]

I. Social / multi-search / esports
- Multi-search [FREE]
- **Events** with quests → points → rankings and raffles. Example: Summer Event 2026-07-11 → 08-17 with a Nintendo Switch 2 prize (v2.5.1) [FREE]
- Find-Duo, Clan/Clash boards, esports and a coach marketplace on the web [WEB]
- Public **MCP server** for AI agents (`mcp-api.op.gg/mcp`) [WEB]

J. Media
- "How to spectate a game" help article; whether it applies to the desktop app is unclear [?]
- Not a recorder

K. Settings, UX, platform, monetisation
- Overlay on/off and hotkey
- Ads in the free tier; Ad-free subscription
- ~24 languages on the web
- Rollback downloads; status page
- Win + Mac

**Complaints:**
- "OP Score" seen as unreliable
- Automatic rune setting seen as intrusive
- High CPU usage
- An **ad dark pattern** reported since Aug 2024: the close button redirects to the advertiser. A community `op-gg-remove-ads` repo exists.
- Help article "The Desktop App **Closes When the Game Starts**" (known issue)
- App Store rating 3.5/5

---

### 1.3 DPM.LOL — Desktop App (DPM.LOL, France; CEO "Juliano"; Caedrel and Kameto involved)

**Timeline**

| Date | Event |
|---|---|
| 2025-05-03 | DPM Premium launches on the web. |
| 2025-05-05 | "Now that Premium is live … shift focus to the Desktop App … **in-game overlays, replays, spectate mode**, and more". |
| 2025-08-01 | "DPM DESKTOP APP **ROADMAP**" post (image-only content, not readable here). |
| 2025-08-30 | Closed **beta**, reserved for **6-month and 1-year Premium** members. |
| 2025-09-09 | "Overlays coming today". |
| **2026-08-21** | **App 1.6.0, "The App, rebuilt"**: new champ-select designs, post-game advanced stats, rebuilt skin collection, clips gallery, **7 new languages**. |
| 2026-09-18 | "**DPM Overlays: Notifications**". |
| **2026-09-26** | **Public launch**: "The DPM Desktop App is live ⚡️ Draft Helper. Overlays. Replays. Native. No ads. No Overwolf." **Free for everyone until Saturday 3 October 2026.** |

**Platform / tech:** Windows. "Native", not Overwolf, no ads. Stack **not disclosed**; see §0.2. Setup-wizard installer with self-update. A "Run as administrator" option is kept across updates.

**Pricing:**
- **DPM Premium: €3.99/month, €19.99/6 months, €35.99/year** (Stripe prices noted in a 2026-07-17 analysis).
- Premium perks on the web: exclusive profile badges, **Hall of Fame** listing, gift Premium to a friend.
- The dpm.lol/premium page presents the **live overlay, draft assistant, auto-clips, replays and one-click pro spectate** as Premium features.
- Mid-2025, DPM said current Premium would keep its perks and that "**another premium tier** with other features on the app" would come.
- After the free window ends (3 Oct 2026), which app features stay free is **unknown** [?].

**Features** (all Windows. Tier per feature is unclear, so `[?]` unless stated.)

A. Client integration & automation (from dpm.lol/app/settings)
- **Auto Accept Queue**: automatically accepts the ready check [?] ⚠
- **Auto-import Runes / Auto-import Summoners / Auto-import Items** during champ select [?]
- **Focus on Champion Select**: brings DPM to the front when champ select starts [?]
- The app **opens on the player's own state** (a personal home, per TrueMain's review) [?]
- Setup wizard, fixed install folder, **self-updater**, "Run as administrator" setting [FREE]

B. Champion select / draft — "**Draft Helper**" [PREMIUM?]
- When bans start, it proposes "the pick with the best shot to win, with **runes and build already sorted**".
- "Every champion is **scored against their composition and the meta**". "See your **team's edge** before a single lock-in". That is a **black-box win probability** in draft ⚠.
- An **explicit "unknown" slot** in the enemy composition for picks not yet revealed; **trends rather than bare values** (per TrueMain's review).
- **Show Hover Picks**: shows champions teammates are hovering before they lock in [?]
- New champ-select designs (1.6.0).

C. Pre-game & loading screen
- **Composite player score (DPM Score) shown next to each player's rank** [?] ⚠ (Riot ban on MMR/ELO alternatives)
- The web has a **live-game page** per player (`dpm.lol/<name>-<tag>/live`) [WEB]

D. In-game overlays: **draggable, independently repositionable panels** rather than one monolithic HUD [OVERLAY] [PREMIUM?]
- **Objective Pills** (objective timers)
- **Gold Difference**
- **Win Probability**, live ⚠
- "Live **fight reads**": "know if a fight is yours before committing" ⚠
- Baron/Dragon awareness ("avoid getting caught out by Baron or Dragon")
- Optimal **item suggestions**
- **Ability leveling**
- **Ward management**
- **Notifications** (2026-09-18): live win probability, **next-item suggestions**, **trinket reminders**, **support-item suggestions**, **full-clear timer**
- **ARAM: Mayhem augment tiers on the cards**: when the augment pick opens, each card shows its tier **for the champion you play**. Six tiers, **S+ → D**. Labels disappear once you pick.
- *Conflict:* the Premium page summary mentions reading and tiering **TFT** augment cards, while the July-2026 analysis says "no TFT (one day, not before 2027)". [?]

E. Post-game & match analysis
- **Post-game advanced stats** (1.6.0) [?]
- Replays with kills, objectives and teamfights marked on the timeline (see J)

F. Profile, match history & progression
- **Skin Collection**: skins owned out of all skins in the game, completion %, **RP spent**, filters by champion, set, tier and availability [?]
- "Collections" and "**Data Studio**" client-suite modules (per TrueMain) [?]
- On the web [WEB]:
  - DPM Score with a detailed breakdown ("dozens of variables")
  - Real-time peak elo
  - Rank-distribution chart ("where you fit in the ladder")
  - Leaderboards and OTP leaderboards

G. Champion data
- Builds and runes, imported into the client [?]
- On the web: tier lists (Ranked / Duo / Arena / ARAM), builds, **30,000+ video matchups** [WEB]

H. Game modes
- **ARAM: Mayhem augment overlay**
- Arena and ARAM tier lists [WEB]
- TFT unclear [?]

I. Social / multi-search / esports
- **Spectate pros in one click** [PREMIUM]; "spectate mode" was on the roadmap
- Esports on the web: **RFT** (rft.gg, "the HLTV of LoL"), LEC/LCK/LCS/LPL/Worlds with **pick'ems** [WEB]
- Gift Premium; Hall of Fame; profile badges
- A pro-career mini-game, "Rift Legacy" [WEB]

J. Media — replays, recording, clips, spectate [PREMIUM per the Premium page]
- **Records games in the background**. Rewatch **any game from start to finish** with every kill and objective marked on the timeline. It "understands League", so it knows where your kills, objectives and teamfights are.
- **Auto-clips**: multikills, steals and aces are saved on their own. You choose what gets clipped.
- **Instant replay**: one key saves the last few minutes.
- **Hardware encoding** on NVIDIA, AMD and Intel, **up to 1440p 60 fps**.
- **Clips gallery**, rebuilt to stay smooth with hundreds of clips. A **trimmer** opens in a modal, with game objectives marked on the timeline.
- Clips and replays are **volume-normalised** when saved. The "clip saved" sound goes up to 200%.
- **DPM Cloud** (coming): share a clip with a link.

K. Settings, UX, platform, monetisation
- **No ads**; **no Overwolf**
- Full UI translation including champ select, post-game, clips gallery, collection and every settings row. **7 new languages** in 1.6.0; the web supports 18.
- Premium subscription (see pricing)

**Reception:**
- The app is too new for reviews. French YouTube beta reviews exist ("DPM APP EN BETA… JE L'ESSAIE EN SOLOQ !"). An Instagram post lists the app's features. Neither was readable here.
- Web criticism: the DPM Score is called "too flattering" (jeuxvideo.com thread).
- DPM's ToS forbid scraping.

---

### 1.4 `ptrtht/dpm-desktop` — UNOFFICIAL DPM desktop wrapper (not DPM's product)

- **Electron 35** + `ws`. MIT. 4 commits. Last commit 2025-03-05. Binaries taken down at DPM's request ("might hurt DPM's RIOT verification").
- Features:
  - Reads the LCU **lockfile** and subscribes over WebSocket to `OnJsonApiEvent_lol-champ-select_v1_session` and `…_lol-gameflow_v1_gameflow-phase`.
  - **Opens `dpm.lol/champions/<alias>/build`** when you enter champ select.
  - Opens **`dpm.lol/<name>-<tag>/live`** when the game starts.
  - Planned but never built: rune import, spell import, item sets, overlays.
- Takeaway: the cheapest possible "desktop app" is a webview that follows LCU events and deep-links into an existing stats website. Nothing indicates the official DPM app is built this way.

---

## 2. Open-source community tools

### 2.1 LeagueAkari — `LeagueAkari/LeagueAkari` (formerly `Hanxven/LeagueAkari`)

- **Tech**: **Electron + Vue 3**, TypeScript throughout.
  - Main process: MobX state and TypeORM + **SQLite** (local database of past games and tagged players).
  - Renderer: Pinia, Naive UI, Tailwind.
  - Build: electron-vite; Yarn 4; Node 24.
  - Five separate renderer windows: main, aux, champion data (OP.GG), ongoing-game overlay, CD timer.
  - Windows native add-ons: native input for simulated keys, and a closed `magic.node` binary (see ⚠ below).
  - Architecture: dependency-injected "**shards**" (~30 main-process modules).
- **Licence / metrics**:
  - MIT since v1.4.4 (it had a different licence before).
  - **4,332★**, 372 forks.
  - **v1.5.0 (2026-07-21)**, **v1.5.1 (2026-07-26)**; last commit 2026-09-09. Dev pre-releases are ongoing.
  - Windows + **macOS since v1.5.0**. Riot-operated regions only; **no Tencent (CN) servers**. No admin needed, except for some native features.
- **Data sources**:
  - LCU (local client API).
  - **SGP** — Riot's internal regional game-platform servers, `*.lol.sgp.pvp.net` / `*.pp.sgp.pvp.net`. Called with the client's entitlements token and league-session token. **This is the default data source.** ⚠
  - Live Client Data API (`127.0.0.1:2999`).
  - OP.GG's private API (`lol-api-champion.op.gg`) and 101.qq.com (CN) for champion data. ⚠
  - Fandom and gtimg for ARAM balance and ARAM: Mayhem augment data.
  - It also records some **usage statistics** (since v1.3.6).

**Features** (from the app's English i18n strings, settings and changelogs)

A. Client integration & automation
- Auto-connect to the client.
  - Remembers the last auth key so it can reconnect even if the UX process was closed.
  - Reads the command line through WMI/WMIC, with a "rebuild WMI" option (may need admin).
  - Shows **login-queue position** and estimated wait.
- **Auto-accept** match, with a configurable delay (seconds).
  - UI to cancel this auto-accept, or to decline or accept after the fact ("matches already accepted can still be declined").
- **Auto-matchmaking**: minimum number of members, delay before searching, wait for invitees.
  - Stop-and-requeue strategy: never / fixed duration / "exceeds estimated queue time".
  - Waits out dodge-penalty timers.
- **Auto play-again** (return to lobby).
- **Auto reconnect** when the game can be rejoined (10 s delay).
- **Auto honor** with strategies: lobby members first, only premades, all teammates, all players including opponents, or opt out.
- **Auto skip leader** (hand party leadership to someone else).
- **Invitations**: auto accept, decline or ignore **per queue type**; reject invites while status is Away.
  - "**Schedule invite**": watches chosen friends and invites them the moment they become available.
- **Auto reply** to DMs, optionally only when Away.
- **ARAM / ARAM Mayhem team-side message**: tells chat whether you are blue or red side, optionally visible to the team.
- **Dodge** champ select without closing the client ⚠. Exit a stuck post-game screen. Leave lobby.
- **Create a lobby for any queue ID**, with lists of available and disabled queues.
- League client:
  - Disconnect.
  - Quit the client process.
  - **Restart, kill or launch the UX process** — killing it "can significantly reduce resource usage" while you are in game.
  - **Fix the window size** via WinAPI (FixLCUWindow; admin).
- Game client:
  - **Terminate the game with a shortcut** (admin).
  - **Lock game settings**: makes `PersistedSettings.json` read-only.
- **Claim tools**: bulk-claim Rewards, Event Hub and Missions.
- **Loot tools**.
- **Friend tools**: bulk delete, with last-game date, friend-since date and groups; search.
- **In-game send** presets: post generated text to **champ-select or lobby chat** (through the LCU), or to **in-game chat by simulated keystrokes** (native input, admin) ⚠.
  - Presets:
    - **Performance rating**: win rate, KDA, solo kills, vision, damage/taken/gold share, CS/min, KP, damage-to-gold, main champions and positions.
    - **Jungle preference**.
    - **Premade status**.
    - **Fixed texts**, each with its own hotkey.
    - **Custom JavaScript templates** in a Monaco editor, with a risk warning.
  - Options: targets (allies / enemies / all), name display style, dry run, send interval, cancel hotkey.
- Global keyboard shortcuts; tray; self-update (release notes, ignore a version, external download); remote config and announcements (GitHub or Gitee).

B. Champion select / draft
- **Auto pick / auto ban**:
  - Separate config per **mode** and per **assigned position**.
  - Ordered champion priority list.
  - "Show intent" (hover) and "ignore teammates' intent".
  - Lock strategy: *just show* / *show and lock in* / *lock in immediately*, with a delay. Default flow is hover → show → lock "to feel natural".
  - Can be temporarily disabled for the current champ select. ⚠
- **Bench modes** (ARAM, URF):
  - Auto-swap from the bench once the target champion has sat there for N seconds.
  - Pick the first available champion from the list.
  - Handle **swap requests** automatically: accept if the swap matches your list, otherwise decline.
  - **Reroll**, and "**charity**" (reroll, then take back your previous champion).
- **ARAM balance** shown per champion: damage dealt/taken, healing, shielding, AH, regen, AS, MS, tenacity, AoE.
- **Auto champion config**: saved **runes and summoner spells per champion**, per mode (Ranked, Normal, ARAM, URF, Nexus Blitz, **Ult Book**) and per position, applied on lock-in.
- **Champion-data window**. Sources: OP.GG, or 101 (CN).
  - Tier table with W/R, P/R, B/R and counters.
  - Builds, runes, spells and **item-set import**.
  - **Flash key preference (D/F)**.
  - Filters: mode (ranked, classic, ARAM, ARAM Mayhem, Arena, Nexus Blitz, URF), region, rank tier, position, patch.
  - **ARAM Mayhem overview**: champions, augments and "combinations".
  - "Champ select assistant" mode that follows your hovered or locked champion.
- **Skin picker** (apply a skin from the carousel).
- **Aux window**, pinned and aligned to the client window:
  - Live champ-select action list (picked / banned / voting / "10 bans reveal").
  - Automation plan ("Will pick …", "Will ban …", "Will accept or decline swap").
  - Auto-accept countdown; matchmaking status.
  - Bench and reroll buttons.
- Chat hint in champ select when a **tagged player** is in your game.

C. Pre-game & loading screen ("**Ongoing game**" page — lobby, champ select and in game; can switch to it automatically)
- Loads each visible player's recent history. You can set match count, queue filter, concurrency and details count. It can also **query party members while still in the lobby**.
- **Player card** metrics:
  - Win rate and KDA popovers.
  - Team **damage share**, damage-taken share, gold share.
  - CS/min and CS share.
  - **Damage-to-gold efficiency**.
  - Average **"enemy missing" pings**.
  - Vision score.
  - Solo kills.
  - **Kill-damage efficiency**, labelled "KS" or "Damage Dealer".
- **Tags on player cards**:
  - "**Easy / Very easy / Hard to gank**" (deaths before 15 min involving the enemy jungler).
  - Win and loss **streaks**.
  - High win rate.
  - **Private profile**.
  - "**SusFlash**" (Flash used on both D and F — "the key preference looks inconsistent").
  - Outstanding / Extraordinary.
  - Last-game ally or opponent.
- **Akari Score**: composite of KDA, WR, damage, damage taken, healing, CS, gold, KP and vision ⚠.
- **Premade detection** from `teamParticipantId`, plus **inference from shared match history** (threshold of 5 shared games by default). **Team tags**: win-rate team, lose-rate team, premade size, team average W/R and KDA.
- "**Met before**": encounter history from the local database, with dates, result and side, and a link to inspect each game.
- **Player tags**: your own tags, tags from other sources, quick phrases, import and export.
- **Jungler pathing profile**, per current champion or overall, split by blue/red side:
  - Zone weights (top / mid / bot preference).
  - First-clear camp distribution, including **invade starts**.
  - **Level 3 / level 4 gank rates**.
  - First-dragon rate and time; average dragons, voidgrubs, heralds and barons.
  - Algorithm explained in the UI. Can also show for non-junglers.
- Arena: top-4 and 1st-place rates.
- Sort players by position, premade group, W/R, KDA or Akari Score. "Draft mode" for a dry-run view.
- ⚠ **De-obfuscation of hidden champ-select identities**: a closed native `magic()` turns `obfuscatedPuuid` into a real PUUID, behind the remote feature gate `ongoing-game.deobfuscation`. This is lobby reveal. **Do not replicate.**

D. In-game (or second screen)
- **Ongoing-game overlay window**: transparent, always on top ('screen-saver' level), click-through, toggled by a shortcut. Shows the player cards over the game [OVERLAY].
- **Timer overlay window**: manual summoner-spell cooldown timers, countdown or count-up, with an option to send "X Flash ready in …" to game chat [OVERLAY] ⚠.
- **Respawn timer** indicator in the app sidebar (Live Client Data `/liveclientdata/playerlist`).
- In-game send via simulated keystrokes (see A) ⚠.

E. Post-game & match analysis ("match card", reworked in v1.4.0; mostly relies on SGP)
- Per-mode **overview table**: team kills, gold, bans, epic monsters; per-player hexagon **radar chart**, champion, position, augments, CS and items.
- **Details table** with 100+ match-v5/challenge stats: skill and summoner casts, every ping type, steals, solo kills, wards, plates, surrender/behaviour flags, and more.
- **Event timeline**: every champion kill, building destroyed and plate taken, with **map position** and damage dealt/received per victim.
- **Rune statistics**, e.g. how much damage Electrocute did, how much AH Transcendence gave.
- **Skill order and item purchase timeline**. Arena and ARAM Mayhem show how many **anvils/forges** were bought.
- **Line charts** (gold, CS, XP, damage dealt/taken) per team or player.
- **Replay download and watch** (same region, via the client). Screenshot of a tab to the clipboard.

F. Profile, match history & progression
- **Summoner search**: fuzzy, exact Riot ID, or PUUID. Cross-region search via SGP ("up to 1500% faster"), with a combined-servers reference. Recent visits, pinned players, friends list.
- **Tabbed profiles**.
- Ranked data (solo/flex, highest, cross-region).
- **Match history filters**: position, champion, time range, queue/mode, practice tool, advanced conditions. Win/loss summary; streaks; Akari Score breakdown.
- **Collection progress** (assets, champions, skins, ward skins, icons, emotes, chromas).
- **Previously used name**; champion mastery.
- Browse games stored in the local database; "view game by ID".

G. Champion data: through the champion-data window (OP.GG / 101 CN) — tiers, builds, counters, and ARAM Mayhem augment strength per champion (v1.4.3).

H. Game modes
- ARAM / ARAM: Mayhem (side message, bench, balance, augments).
- Arena (top-4/1st rates, augments column, gold column; a "Brave move" auto-select was added in v1.3.6 [?] — possibly dropped in the v1.4 rewrite).
- **Swarm** tools: set current champion, map and difficulty.
- URF, Nexus Blitz, Ult Book configs.
- Lobby for any queue ID.

I. Social
- Chat status: chat / mobile / away / dnd / **offline** / spectating, plus "try locking offline status".
- **Chat signature** (status message), reapplied at login.
- **Fake ranked status on the chat card** (queue/tier/division) ⚠.
- Cosmetics: profile background (skin or augment), last season's banner, remove prestige crest, remove all tokens, remove all emotes.
- Friend tools; scheduled invites; auto reply.

J. Media
- **Spectate by Riot ID or PUUID**. Since Riot's spectator change this is limited to some servers and depends on SGP.
- **Token spectate**.
- Replay download and watch.

K. Settings, UX, platform
- EN and zh-CN.
- Light/dark **theme presets**; **Mica** on Windows 11; custom wallpaper.
- Opacity, pin and "align with League Client UX" for each window.
- **Streamer mode**: hide sensitive info, "Akari-styled names", **content protection** (window excluded from screen capture). Also detects streaming tools or the client's streamer mode and suggests turning it on.
- HTTP proxy; log level; disable hardware acceleration; export/import settings; uninstall; developer tools.

### 2.2 Seraphine — `Zzaphkiel/Seraphine` (archived) · backup fork `Miuguel/Seraphine`

- **Tech**: **Python 3.8, PyQt5 + PyQt-Fluent-Widgets**, qasync/aiohttp. Packaged with PyInstaller + 7z.
- **Licence**: GPLv3, **non-commercial use only**.
- **Metrics**: 3,138★ / 299 forks.
- **Status**:
  - README dated 2025-03-05: "Due to force majeure, this repository has ceased updates".
  - The final commit (2025-03-09) **removed all code**, and history was squashed.
  - The Portuguese-maintained backup `Miuguel/Seraphine` has 32★; last commit 2026-08-03.
- Warns that "some HTTP requests crash the client". FAQ: per-mode or per-champion **total games / WR cannot be computed** because the LCU has no such endpoint.

Features:
- **A**
  - Auto-accept match.
  - **Auto reconnect** after the game exits.
  - **Fix infinite loading or shrunk client** after a game.
  - **Hot-restart the client** (`/riotclient/kill-and-restart-ux`); client zoom scale.
  - **Lock in-game settings** (`PersistedSettings.json`).
- **B**
  - Auto pick; auto ban.
  - **Auto accept teammates' champion-swap and pick-order ("floor") swap requests**.
  - **ARAM champion buff/nerf info** (scraped from jddld.com).
  - **OP.GG tier list**; **OP.GG builds and skill order with one-click runes**.
- **C**
  - Automatically looks up **teammates' match history on entering champ select**.
  - Automatically looks up **opponents' history when the game starts**.
- **F**: summoner match-history search on the same server (TFT not supported); career page.
- **H**: create a **custom 5v5 Practice Tool lobby** (name and password).
- **J**: **spectate** live games of players on the same server.
- **I / K** — cosmetics:
  - Profile background.
  - Online status and signature.
  - **Rank shown on the profile card** (fake-rank ⚠).
  - Remove badges (tokens) in one click; remove icon frame (regalia) in one click.

### 2.3 ChampR — `cangzhang/ChampR` ("Yet another League of Legends helper")

- **Tech history**: v1 **Electron** (~70 MB) → v2 **Tauri** (~4 MB, needs WebView2) → current `main` (2026) **pure Rust with a Slint native GUI** (`crates/app/ui/app.slint`), an `lcu` crate, and its **own axum backend** (`crates/server`, JWT admin, database). A TypeScript **OP.GG crawler** (`packages/opgg`) feeds that backend.
- **Licence**: LGPL-2.1. **1,695★**.
- **Status**: latest tagged release **v2.0.2-b7 is from 2023-07-12** *(possibly outdated binaries)*. `main` is active (last commit 2026-04-17, "connect to remote server").
- **Features**
  - **Auto-recommend and import item builds**: writes per-champion item-set JSON files into the LoL install folder. Needs admin and a chosen LoL folder.
  - **Rune list pop-up with one-click import**.
  - **Multiple data sources per mode** (Summoner's Rift / ARAM / URF): op.gg, lolalytics.com, u.gg, champion.gg, murderbridge.com, 101.qq.com.
  - Remembers the sources and rune source you picked last time.
  - i18n: zh-CN, en, fr. Update notifications.

### 2.4 Other notable OSS / community tools (condensed)

| Tool (repo) | Tech · ★ · last activity | Features worth cataloguing | Notes |
|---|---|---|---|
| **frank** (`SYJun404/frank`) | **Tauri + Rust + Vue 3** · 1,941★ · 2026-08-16 | Auto-accept; **auto B/P**; rune config (101.qq data) with auto apply; champion ranking pages; "ranked notes" (**blacklist** of players with "hater details"); teammate data; champion mastery | CN/WeGame focus. **Removed match-history lookup "according to official requirements"**. |
| **hh-lol-prophet** (`real-web-world/hh-lol-prophet`) | **Go** · 991★ · 2025-06-26 | In champ select, scores every teammate's last 20 games and posts a "horse" tier (通天代 / 小代 / 上等马 … 牛马) **into champ-select chat**. Auto-accept; auto B/P. **LCU proxy on `localhost:4396`** so web front-ends can call LCU REST/WSS. | Scoring rules published (`计分方式.md`). ⚠ public shaming / "alternative rating" |
| **rank-analysis** (`wnzzer/rank-analysis`) | **Tauri 2 + Rust + Vue 3** · 426★ · 2026-09-27 · **~5 MB installer** · Win + macOS (Apple Silicon) | **LLM match review** (streaming; DashScope/Qwen): who carried / fed / got stomped / was dragged down; per-player review. Lobby-level **risk assessment**. Match history with WR highlighting and MVP. Auto tags (streaks, **smurf suspect**, hot streak, slump). **Nemesis/friend relationships**. Premade detection. Separate match-details window (items, skills, runes/augments). **Rule-engine auto pick/ban** (role × ally/enemy conditions). Auto matchmaking and accept. **Player notes with colour labels** (friendly / normal / careful / blacklist). **Cloud sync** of notes and config. JSON export. | Good benchmark for a light Tauri companion. |
| **KBotExt** (`KebsCS/KBotExt`) | **C++** (ImGui) · 469★ · 2024-12 | "Fastest" instalock, auto-accept, instant message, auto ban, secondary pick or dodge if banned. **Mute everyone in champ select**. Dodge without closing the client. Mass invite. **Multi-search op.gg/u.gg/poro with all players (works in ranked — lobby reveal)**. Best runes from op.gg, "even when not unlocked". Map side in all modes. Hidden-mode lobbies; custom bot difficulty; force jungle/lane in Nexus Blitz. **Fake icon/background/status/rank/mastery/challenges**; glitched or empty badges; invisible banner. Look up any player. Champion/skin lists. Force-close the client. Mass delete friends; accept/delete friend requests. **Check any account's email**. Custom minimap scale. **Mass disenchant**. Raw LCU / Riot Client / RTMP / Store / Ledge requests. Stream-proof window. IFEO debugger. Log cleaner. **Ban checker**. 1-click login; multiple clients; language changer. | ⚠⚠ **Vanguard-bannable since 2024-12-13** (14-day ban on first offence; Riot comment). Example of what not to build. |
| **Deceive** (`molenzwiebel/Deceive`) | **C#** · 1,716★ · 2026-09-01 | **Appear offline** (or mobile) while keeping chat, lobby and champ-select chat working. Tray icon. Choose which game to launch (LoL / LoR / VALORANT). | Local **chat (XMPP) proxy**; rewrites the Riot client's chat host through its config proxy. "Riot has confirmed that you won't get banned". Fake `deceive.app` site ships malware. |
| **Pengu Loader** (`PenguLoader/PenguLoader`) | **C++** · 731★ | **JavaScript plugin loader injected into the League Client UI** (themes, UI features, DevTools, API hooks). Ecosystem example: `Nicetyone/league-lean` (auto runes/builds, meta tier list, post-game op.gg). | ⚠ modifies the client. Riot tolerance not guaranteed. |
| **Mimic** (`molenzwiebel/Mimic`, archived) | C# conduit + **Vue** web + Node relay · 556★ | **Run lobby → champ select from your phone** in a browser: pick, ban, bench swap, reroll, skin picker, and more. | Conduit proxies LCU REST/WebSocket to a mobile web UI through a relay ("rift") with **6-digit pairing codes** and end-to-end encryption. Commercial version at mimic.lol. |
| **Futaba** (`adv-inn/Futaba`) | **Tauri** · 77★ · 2026 · *not open source yet* | Desktop + **mobile control**: auto-accept, match history, friends (chat / invite / scheduled invite), mode selection. OP.GG-based augment/build/rune/spell recommendations. **Automatic counter-pick calculation**. "**AI situation analysis**" and "**AI game evaluation**". Change champion freely in ARAM/Mayhem. | CN. Planned GPL-3.0. |
| **xyra** (`DiegoFernandoLojanTenesaca/xyra`) | **Rust + Tauri + Svelte**, **native Direct2D layer**, **Windows OCR** · new (2026-09-25) · MIT | **Labels ARAM: Mayhem and Arena augment cards** for your champion (5 label styles; best highlighted; bad cards suggest a reroll) [OVERLAY]. Champ-select headline ("Take Jinx from the bench", "vs Yasuo take Malzahar"). **Recommends only champions you own or that are free**. Builds (runes, spells, items, skills) for ARAM Mayhem and SR normals by position, with import. Counters. **One-click official game options** (attack-range indicator, minimap timers, tower range vs AI, minimap size); keeps Borderless on. Auto-accept after N s. Patch meta by position with rise/fall vs last patch and a patch-notes link. **In-game tips from the Live Client API** (next skill; next item and gold missing). **Android companion** (QR pairing over Wi-Fi or **Tailscale**): accept, follow champ select, import, builds, meta, stats, settings. Per-account stats with **CSV export**. **Voice alerts**; resolution calibration; bug-report screenshots; tray-resident. | Very close to our target stack. No memory reads, no injection, no simulated input: screen OCR plus a click-through overlay only. |
| **DraftGap** (`vigovlugt/draftgap`) | Solid/TS + **Tauri** desktop · 67★ · 2026-08-30 | Draft analysis from **meta, matchups against every opponent and ally duos** ("unopinionated, statistics only"): best pick, "was the game lost in draft". **Syncs automatically with champ select**. Web + desktop. | Reads `lol-champ-select/v1/session`, `all-grid-champions` and `pickable-champion-ids` through Rust commands. |
| **RuneChanger** (`stirante/RuneChanger`) | Java / JavaFX · 85★ · 2023 *(possibly outdated)* | Quick rune import for the selected champion. **One-click lane call in champ-select chat** (BOT/MID/TOP). Quick-select recently played champions. Disenchant all champion shards. Disable "Away". Save/restore/share rune pages. | UI is a **separate window glued onto the League Client** (tracks the client's position and size). A pattern for adding UI without injecting. |
| **Legendary Rune Maker** (`pipe01/legendary-rune-maker`) | C# · 85★ · 2021 *(outdated)* | Fast rune-page editing. Auto rune page on lock-in, per lane. Providers: Champion.GG, LoLFlavor, MetaLoL, OP.GG, Runes.lol, U.GG. Auto-accept; auto pick/ban/spells. **Auto item-set download**. Skill-order display. **Share rune pages as a short text string**. | — |
| **LeagueAutoAccept** (`sweetriverfish/LeagueAutoAccept`) | C# .NET 9 console · 124★ · 2026-09-25 | Auto-accept, pick, **instalock**, ban, summoner spells, **chat message on entering the lobby**. | Warns that "use of the LCU API is not allowed on the Korean server". |
| **lol-auto-accept** (`jasonwu1994/lol-auto-accept`) | JS / Electron (React) · 134★ · 2025-01 | Auto-accept within 1 s (can undo with "decline"). **Teammates' rank points in champ select** (breaks where names are hidden). **Duo/premade display in game**, sorted by size. Show each team's queue rules. **ARAM random-pick helper** (tick wanted champions; auto-grab when rolled). Edit your hover card. | Event-driven, "~0% CPU" when idle. Premades read from `gameData.teamOne/teamTwo[].teamParticipantId`. |
| **LobbyReveal** (`0xInception/LobbyReveal`, archived) | C# · 107★ | Showed who is in your ranked lobby. | ⚠ **Archived after a Riot statement**. |
| **Lytical** (`LyticalApp/Lytical`) | Vue / Electron · 45★ · 2024-01 *(possibly outdated)* | "OP.GG for **Garena/WeGame**": summoner search and **pre-game analysis** through the LCU in every region. | GPLv2. |
| **ReplayBook** (`fraxiinus/ReplayBook`) | C# / WPF · 449★ · 2025-09 | **Organise, inspect and play downloaded `.rofl` replays**: library, metadata, rename, favourites, file association; launches the correct game executable. | Replays from 14.9–14.10 have no metadata. |
| **League Director** (`RiotGames/leaguedirector`, **official Riot**) | Python / Qt · 1,021★ · 2026-01 | **Stage and record videos from replays**: camera keyframes, sequences, render and particle toggles, playback control, recording. | Uses the **Replay API** (`/replay/*` on `127.0.0.1:2999`; needs `EnableReplayApi=1`). |
| **LeagueRecord** (`FFFFFFFXXXXXXX/league_record`) | **Rust + Tauri + libobs** · 49★ · 2026-05 | **Auto-records** every game (or only ranked). Library with size, favourites, rename, delete. Player with **colour-coded event markers** (kill, death, assist, structure, dragon, herald, Atakhan, baron) you can filter. Hotkeys (next/previous event, speed). Settings: resolution, fps, quality, **audio sources** (game only / system / + mic), filename format, autostart. | **~5 MB RAM idle, ~50 MB while recording, ~160 MB while watching (WebView2)**; ~75 MB on disk. Fork `league_record_custom` adds manual recording, A-B loop, clip creation and mode filters. |
| **ninja-recorder** (`NinjaGoldfinch/ninja-recorder`) | **Rust headless daemon + Tauri/Svelte 5 UI** · alpha · 2026-09 | Automatic VOD recording; timeline tagged with in-game events; **review player "for improving rather than editing"**; notifications from the daemon with no window open. | Own capture backend: **Windows Graphics Capture + D3D11 + Media Foundation**, fragmented MP4 (libobs fallback). "Capture has run across many live Vanguard-protected games". |
| **DetailedLoLRPC** (`developers192/DetailedLoLRPC`) | Python · 33★ · 2025-07 | **Discord Rich Presence**: current skin splash (including animated), accurate mode names, loading-screen state, in-game KDA/CS/level, mute toggle, map-icon styles, settings import/export, in-app updates. | — |
| League Profile Tool (`MManoah/league-profile-tool`) / `lenny-ts/league_profile_tool` (Tauri v2) | Electron+Angular (2021, unmaintained) / Tauri+React (2026) | Profile cosmetics: icon, background, hover card, custom status; read profile and friends data. | Cosmetic "exploits". |
| Dev tooling | — | `KebsCS/lcu-and-riotclient-api` (LCU + Riot Client API docs, 159★); `HextechDocs/lcu-explorer` (archived); `BlossomiShymae/Needlework(.Net)` (LCU + Game Client explorer); `KebsCS/LeagueClientDebugger` (view/modify all client traffic ⚠); `dysolix/hasagi-core` (typed TS LCU client); `sousa-andre/lcu-driver` (Python); `cuppachino/hexgate` (TS); `Hi-Ray/LCU-Arguments`; `CommunityDragon`. | Use for endpoint discovery. |

Other standalone (non-Overwolf) apps spotted but outside this report's deep-dive (covered elsewhere or worth a look):
- **iTero** (Rust + Tauri, AI draft coach)
- **buildzcrank** (standalone AI build overlay, free, no ads)
- **Hexgate** (standalone; 3 free games/day)
- **Rift Companion** (native macOS)
- **Warden** (Tauri; `snacbot/warden-releases`)
- MetaBot.gg desktop
- Counterplay

---

## 3. Merged feature matrix

App codes:
- **Commercial**: **BLZ** = Blitz · **OPD** = OP.GG for Desktop · **DPM** = DPM.LOL Desktop · **dpm-u** = unofficial ptrtht/dpm-desktop
- **Main OSS**: **AKR** = LeagueAkari · **SER** = Seraphine · **CHR** = ChampR
- **Other OSS**: **FRK** = frank · **HHP** = hh-lol-prophet · **RAN** = rank-analysis · **KBE** = KBotExt · **DEC** = Deceive · **PEN** = Pengu Loader · **MIM** = Mimic · **FUT** = Futaba · **XYR** = xyra · **DGP** = DraftGap · **RCH** = RuneChanger · **LRM** = Legendary Rune Maker · **LAA** = LeagueAutoAccept · **LAC** = lol-auto-accept · **LRV** = LobbyReveal · **LYT** = Lytical · **RBK** = ReplayBook · **LDR** = League Director (Riot) · **LRC** = LeagueRecord · **NRC** = ninja-recorder · **RPC** = DetailedLoLRPC · **LPT** = League Profile Tool(s)

Other notation:
- `(P)` = Premium-only in that app
- `(?)` = unverified
- `[WEB]` = on the vendor's website only
- `[OVERLAY]` = in-game overlay

| Feature | Category | Apps that have it | Notes |
|---|---|---|---|
| Auto-detect client/game and connect to the LCU (lockfile or process command line) | A | All desktop apps and tools | Foundation for everything. dpm-u reads the lockfile; AKR and CHR read the process command line (WMI / PowerShell CIM). |
| Auto-accept ready check | A | DPM, AKR (delay + cancel/decline UI), SER, FRK, HHP, RAN, KBE, LAA, LAC, LRM, XYR (after N s), FUT. BLZ/OPD: not found (?) | ⚠ "acting on your behalf". Korea: LCU apps disallowed per the 2019 policy. |
| Undo auto-accept (decline after accept) / cancel pending accept | A | AKR, LAC | Nice UX detail. |
| Auto-start matchmaking (min members, wait for invitees, requeue if the queue runs too long, respect dodge timer) | A | AKR, RAN | ⚠ automation |
| Auto play-again / return to lobby after the game | A | AKR, FRK | — |
| Auto reconnect to an in-progress game | A | AKR, SER | — |
| Auto honor (strategies) | A/E | AKR | — |
| Invitation automation (auto accept/decline per queue, reject when Away, scheduled invite when a friend is free, mass invite) | A/I | AKR (per queue + scheduled), KBE (mass invite), FUT (scheduled invite) | — |
| Auto-reply to DMs (only when Away) | A/I | AKR | — |
| Auto transfer party leader | A | AKR | — |
| Dodge champ select without closing the client | A/B | AKR, KBE | ⚠ |
| Fix stuck post-game / infinite loading; exit post-game | A | AKR, SER | — |
| Restart / kill / launch client UX (e.g. kill the UX in game to save RAM) | A/K | AKR, SER (hot restart) | Useful perf tip. |
| Fix League client window size (WinAPI) | A | AKR | — |
| Lock game settings (read-only `PersistedSettings.json`) | A | AKR, SER | — |
| Toggle official game options (attack range, minimap timers, minimap scale, borderless) | A/K | XYR (via LCU `game-settings`), KBE (minimap scale) | — |
| Game launcher / launch LoL with the app | A/K | OPD (multi-game launcher), XYR (single icon opens LoL), KBE (1-click login, multiple clients) | — |
| Login-queue position display | A | AKR | — |
| Create lobby by queue ID / hidden modes / custom 5v5 practice / bot difficulty | A/H | AKR (queue ID), SER (5v5 practice), KBE | — |
| Phone / remote control of lobby and champ select | A/B | BLZ (mobile app pairing), MIM, FUT, XYR (Android, QR + Wi-Fi/Tailscale) | Differentiator. Needs a relay or LAN pairing. |
| Terminate the game process via hotkey | A | AKR | — |
| Presence control (appear offline, mobile, DND, custom status) | A/I | DEC (offline/mobile via chat proxy), AKR (availability + lock offline + signature), SER (status), RCH (disable Away) | DEC is Riot-tolerated. |
| Discord Rich Presence | I | RPC | — |
| Bulk-claim rewards / missions / event pass | A | AKR | — |
| Mass disenchant loot | A | KBE, RCH (shards), AKR (loot tools) | — |
| Friend-list cleanup (bulk delete, requests) | I | AKR, KBE | — |
| Client UI plugins/themes (JS injected into the client) | K | PEN | ⚠ |
| Auto-import runes (on lock-in or one click) | B | BLZ, OPD, DPM, AKR (presets + OP.GG window), SER, CHR, RCH, LRM, XYR, FUT, KBE, RAN, FRK | Universal. Do it on an explicit click, reuse your own page, never delete user pages (TrueMain policy notes). |
| Auto-import summoner spells | B | BLZ, OPD, DPM, AKR (Flash D/F preference), LAA, LRM, XYR, FUT | — |
| Auto-import item sets | B | BLZ, OPD, DPM, AKR (global Recommended files), CHR (per-champion files), LRM, XYR (LCU item-sets API) | — |
| League Classic masteries auto-apply + Classic champ-select page | B/H | OPD | Mode released 2026-07-29 (patch 26.15). |
| Build/role preference pop-up on hover or lock-in | B | BLZ | — |
| Pick/ban recommendations (meta, counters, synergies, personal history) | B | BLZ, DPM (Draft Helper), OPD (OP.GG Pick / Champion Pick), DGP, FUT (counter calc), XYR (owned champions only), RAN (rule suggestions) | — |
| Draft win probability / team edge | B | DPM, DGP (draft score) | ⚠ black box. TrueMain rejected it on policy grounds. |
| Explicit "unknown" enemy slot in draft analysis | B | DPM | UX detail. |
| Counter/matchup lookup in champ select | B/G | OPD, BLZ, XYR, FUT, DGP, AKR (counters column) | — |
| Show teammates' hover intents | B | DPM (Show Hover Picks), AKR (intent-aware auto pick) | — |
| Bring app to front / auto-navigate on phase change | B/K | DPM (Focus on Champion Select), AKR (auto route), dpm-u (opens build page, then live page) | Gameflow-driven navigation. |
| Auto pick / instalock | B | AKR (show → lock strategies, per mode/position), SER, HHP, KBE, LAA, LRM, RAN (rule engine), FRK | ⚠ |
| Auto ban | B | AKR, SER, HHP, KBE, LAA, LRM, RAN, FRK | ⚠ |
| Auto-accept swap / trade / pick-order requests | B | AKR (accept/decline by preference), SER | — |
| Bench auto-swap / reroll / reroll-and-take-back (ARAM/URF) | B/H | AKR, LAC (grab wanted champion when rolled), FUT | ⚠ |
| ARAM balance buffs per champion | B/H | AKR, SER | — |
| Send stats / lane / side / premade info to champ-select chat | B/I | AKR (presets + custom JS), HHP (ratings), RCH (lane call), LAA (lobby message), KBE | ⚠ HHP-style public ratings. |
| Mute everyone in champ select | B | KBE | — |
| Skin picker helper | B | AKR, MIM | — |
| Temporarily disable automation for this draft | B | AKR | Good safety UX. |
| Recommend only owned or free champions | B | XYR | Uses `owned-champions-minimal`. |
| Lobby/teammates' match-history lookup during champ select | C | AKR, SER, HHP, RAN, LAC (rank points), LYT, FUT, FRK (removed in CN) | ⚠ anonymised queues. Regional restrictions. |
| Opponents' history lookup when the game starts | C | AKR, SER, RAN, LYT | — |
| Multi-search of the lobby (open op.gg/u.gg multi) | C | OPD (automatic multi-search), KBE (incl. hidden names ⚠) | — |
| Loading-screen overlay (rank, WR, recent performance, champion pool) | C | BLZ, OPD | [OVERLAY] |
| Premade / duo detection | C | AKR (`teamParticipantId` + history inference), LAC, RAN | — |
| "Met before" / encounter history / nemeses | C | AKR, RAN | Needs a local DB of seen games. |
| Player notes / tags / blacklist | C/F | AKR (tags + quick phrases), RAN (colour labels + cloud sync), FRK (blacklist) | — |
| Composite player score / rating | C/F | DPM (DPM Score), AKR (Akari Score), HHP (horse tiers), OPD (OP Score [WEB]), RAN (AI verdicts) | ⚠ Riot ban on "alternative MMR/ELO" (debated). |
| Behavioural tags (streaks, smurf suspect, easy to gank, KS, SusFlash, private profile) | C | AKR, RAN | — |
| Enemy jungler pathing profile (first clear, invade rate, level 3/4 gank rate, objective control) | C | AKR | Unique and valuable. |
| Hidden-name de-obfuscation (lobby reveal) | C | AKR (gated native addon), KBE, LRV | ⚠⚠ enforced by Riot/Vanguard. **Exclude.** |
| Query party members while still in the lobby | C | AKR | — |
| Live-game web page | C | DPM [WEB], dpm-u | — |
| Objective / jungle-camp / inhibitor timers | D | BLZ, OPD, DPM (Objective Pills, Baron/Dragon) | [OVERLAY] |
| Ally ultimate timers | D | BLZ | [OVERLAY]. Enemy ult timers **banned** 2025-03-13. |
| Summoner-spell tracker / CD timers | D | OPD (spell tracker), AKR (manual timer overlay + send to chat) | [OVERLAY] ⚠ check. |
| Gold difference / item-value comparison | D | BLZ (item value), OPD (gold & item), DPM (Gold Difference) | [OVERLAY] |
| Live performance benchmark vs lobby | D | BLZ (benchmark), OPD (real-time stats) | [OVERLAY] |
| CS overlay | D | BLZ (P for customisable) | [OVERLAY] |
| Live win probability | D | DPM | [OVERLAY] ⚠ May-2025 "simulate decision-making" rule |
| Fight prediction ("is this fight yours") | D | DPM | [OVERLAY] ⚠ |
| Next-item suggestion | D | DPM, XYR (next item + gold missing, Live Client API) | [OVERLAY] ⚠ prescriptive |
| Skill level-up prompt | D | BLZ, OPD, DPM, XYR | [OVERLAY] |
| Trinket reminder | D | BLZ, DPM | [OVERLAY] |
| Support-item upgrade tracking / suggestions | D | BLZ (P), DPM | [OVERLAY] |
| Ward management / control-ward count | D | OPD, DPM | [OVERLAY] |
| Healing / anti-heal tracker | D | OPD | [OVERLAY] |
| Jungle path / clear route on minimap | D | BLZ, OPD | [OVERLAY] |
| Full-clear timer | D | DPM | [OVERLAY] |
| ARAM health-relic timers | D/H | BLZ, OPD | [OVERLAY] |
| Augment tiers on cards (ARAM Mayhem / Arena; TFT for OPD) | D/H | DPM (Mayhem S+→D), BLZ (Mayhem tier list + Arena stats), OPD (TFT), XYR (Mayhem + Arena via OCR), FUT (Mayhem recommendations) | [OVERLAY]. xyra shows a no-injection way to do it (screen OCR + click-through layer). |
| Respawn timer | D | AKR (sidebar, Live Client Data) | Second screen. |
| Player-cards overlay over the game | D | AKR (ongoing-game overlay window) | [OVERLAY] |
| In-game chat macros (simulated keystrokes) | D | AKR | ⚠ input injection |
| Voice alerts | D | XYR | — |
| Draggable / independent overlay panels; overlay hotkey | D/K | DPM (draggable panels), OPD (Shift+Tab), BLZ (CS key), AKR (pin/opacity/align) | — |
| Post-game report / advanced stats | E | BLZ, DPM, AKR (match card), RAN, LYT, SER | — |
| AI / LLM match review | E | RAN (Qwen/DashScope), FUT, OPD (AI Voice / Agent, P ₩7,900 tier) | — |
| Event timeline with map positions and damage breakdown | E | AKR | — |
| Gold / CS / XP / damage line charts | E | AKR | — |
| Rune-effectiveness stats | E | AKR | — |
| Skill-order and item-purchase timeline | E | AKR | — |
| 100+ challenge stats (pings, casts, steals, plates, behaviour flags) | E | AKR | From match-v5 details (SGP). |
| End-of-game stats block / LP change | E | RAN, LRC, NRC, XYR (EOG endpoint) | — |
| Summoner search (Riot ID, fuzzy, PUUID, cross-region) | F | AKR (SGP cross-region), SER, LYT, RAN, OPD, BLZ, KBE | — |
| Ranked stats, peak, LP | F | BLZ, OPD, DPM (peak elo [WEB]), AKR, SER, RAN, LYT, XYR | — |
| Match history with advanced filters | F | AKR, RAN, SER, LYT, BLZ | — |
| Challenges / collection progress | F | AKR; `sivir/crystal` (Tauri challenge tracker) | — |
| Skin collection completion % + RP spent | F | DPM | — |
| Champion mastery | F | AKR, FRK, XYR | — |
| Personal dashboard / home on your own state | F/K | DPM, OPD (P dashboard), XYR (per-account stats + CSV) | — |
| Previously used names | F | AKR | — |
| Rank distribution / ladder position | F | DPM [WEB] | — |
| Profile cosmetics (background, banner, crest, tokens, emotes) | F/I | AKR, SER, KBE, LPT | ⚠ low-risk cosmetics via LCU |
| Fake rank on chat card | I | AKR, SER, KBE | ⚠ misleading. Avoid. |
| Tier lists (role, rank, region, patch) | G | BLZ, OPD, DPM [WEB], AKR (OP.GG window), SER, XYR (with rise/fall) | — |
| Builds (runes/items/skills/spells) | G | BLZ, OPD, DPM, AKR, SER, CHR, LRM, XYR, FRK, FUT | — |
| ProBuilds / pro players' builds | G | BLZ, OPD [WEB] | — |
| High-elo builds (Masters+) | G | BLZ (P), AKR (tier filter) | — |
| Matchups / counters (incl. video matchups) | G | OPD, BLZ, DPM [WEB] (30k+ videos), AKR, XYR, DGP | — |
| Duo synergies | G | DGP; OPD (MCP / web) | — |
| Champion skill-combo guides | G | OPD | — |
| Patch-note summaries / tooltips / links | G | OPD, XYR, RAN (CN notes) | — |
| Selectable data source | G | CHR (6 sources), LRM (6 providers), AKR (OP.GG / 101) | — |
| ARAM builds / tiers | H | BLZ, OPD, AKR, SER, CHR, XYR | — |
| ARAM: Mayhem augments | H | BLZ, DPM, AKR, XYR, FUT | — |
| Arena (tiers, augments, top-4 rate) | H | BLZ, AKR, RAN, XYR, DPM [WEB] | — |
| URF | H | BLZ, AKR, CHR | — |
| Nexus Blitz | H | AKR, KBE (force role) | — |
| Swarm tools | H | AKR | — |
| Doom Bots ranking / builds | H | OPD | — |
| League Classic | H | OPD | — |
| TFT support | H | BLZ, OPD, DPM (?) | Out of LoL scope. |
| Ult Book config | H | AKR | — |
| One-click pro spectate / esports hub | I/J | DPM (P), OPD [WEB], DPM RFT [WEB] | — |
| Events / quests / prizes inside the app | I/K | OPD | Gamification. |
| Premium badges / hall of fame / gifting | I/K | DPM | — |
| LFG / Find Duo | I | OPD [WEB] | — |
| Spectate any player by name/PUUID | J | AKR (limited post-change, SGP), SER | Riot changed the spectator system. |
| Replay download / watch through the client | J | AKR, SER, RAN | — |
| Replay file manager (`.rofl`) | J | RBK | — |
| Background game recording with event-marked timeline | J | DPM (P), LRC, NRC | — |
| Auto-clips (multikills, steals, aces) | J | DPM (P) | — |
| Instant-replay buffer hotkey | J | DPM (P) | — |
| Clip gallery / trimmer / share link | J | DPM (share link "coming"), `league_record_custom` (clip creation, A-B loop) | — |
| Hardware-encoded capture (NVENC/AMF/QSV), up to 1440p60 | J | DPM | — |
| Replay cinematics / camera tool | J | LDR | Replay API |
| Ads in the free tier | K | BLZ (heavy), OPD | DPM + OSS have none. |
| Paid tier | K | BLZ ($4.99/mo), OPD (₩3,900 / ₩7,900), DPM (€3.99 / €19.99 per 6 months / €35.99 per year) | — |
| macOS support | K | BLZ (no overlays on Mac), OPD, AKR (≥1.5.0), RAN (Apple Silicon) | DPM appears Windows-only (?) |
| Mobile companion | K | BLZ, FUT, XYR (Android), MIM | — |
| Multi-language UI | K | DPM (+7 languages in 1.6.0; 18 on the web), OPD (~24 on the web), AKR (en/zh), CHR (zh/en/fr), XYR (es/en), RBK | — |
| Self-update | K | All maintained apps | — |
| Tiny footprint | K | RAN (~5 MB installer), CHR v2 (~4 MB), LRC (5 MB RAM idle), NRC (headless daemon) | BLZ (Electron) criticised for RAM. |
| Themes (light/dark, Mica) | K | AKR, RAN | — |
| Settings export/import; cloud sync | K | AKR (export), RAN (cloud sync), RPC (export) | — |
| Streamer mode / content protection (hide window from capture) | K | AKR, KBE (stream-proof) | — |
| Proxy settings | K | AKR, SER (OP.GG proxy) | — |
| Telemetry / usage stats | K | AKR (since 1.3.6) | — |

---

## 4. OSS implementation pointers: feature → LCU endpoint / mechanism → source

Conventions:
- LCU = `https://127.0.0.1:<app-port>`, Basic auth `riot:<remoting-auth-token>`, self-signed Riot certificate.
- Live Client Data / Replay API = `https://127.0.0.1:2999`.
- Links point at the default branch as of 2026-09-27.
- `LA` = `https://github.com/LeagueAkari/LeagueAkari/blob/dev/`

| Feature | Endpoint(s) / mechanism | Where to look |
|---|---|---|
| **Discover the LCU (port + token)** | Option 1: read `<LoL install>/lockfile` (`name:pid:port:password:protocol`). Option 2: read the `LeagueClientUx.exe` command line and parse `--app-port=`, `--remoting-auth-token=`, `--riotclient-app-port=`. Command line via WMI/WMIC; PowerShell `Get-CimInstance Win32_Process -Filter "name = 'LeagueClientUx.exe'"` (may need elevation). | LeagueAkari [`ux-command-line-parser.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/league-client-ux/ux-command-line-parser.ts) · ChampR [`crates/lcu/src/cmd.rs`](https://github.com/cangzhang/ChampR/blob/main/crates/lcu/src/cmd.rs) · dpm-desktop [`main.js`](https://github.com/ptrtht/dpm-desktop/blob/master/main.js) (lockfile) |
| **Real-time events** | WAMP over `wss://127.0.0.1:<port>`. Subscribe with `[5, "OnJsonApiEvent"]` (everything) or per URI, e.g. `[5, "OnJsonApiEvent_lol-champ-select_v1_session"]` and `…_lol-gameflow_v1_gameflow-phase`. | ChampR [`lcu_api.rs`](https://github.com/cangzhang/ChampR/blob/main/crates/lcu/src/lcu_api.rs) · dpm-desktop [`main.js`](https://github.com/ptrtht/dpm-desktop/blob/master/main.js) · Seraphine [`connector.py`](https://github.com/Miuguel/Seraphine/blob/master/app/lol/connector.py) |
| Gameflow phase and session | `GET /lol-gameflow/v1/gameflow-phase`. `GET /lol-gameflow/v1/session` (queue, map, `gameData.teamOne/teamTwo`, `playerChampionSelections`). | `LA` [`src/shared/http-api-axios-helper/league-client/gameflow.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/gameflow.ts) |
| **Auto-accept** | `GET /lol-matchmaking/v1/ready-check`. `POST /lol-matchmaking/v1/ready-check/accept` (or `/decline`). | `LA` [`matchmaking.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/matchmaking.ts) · xyra [`matchmaking.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/crates/xyra-core/src/matchmaking.rs) · LeagueAutoAccept [`MainLogic.cs`](https://github.com/sweetriverfish/LeagueAutoAccept/blob/main/Leauge%20Auto%20Accept/MainLogic.cs) |
| Auto matchmaking / requeue | `POST` / `DELETE /lol-lobby/v2/lobby/matchmaking/search`. `GET /lol-matchmaking/v1/search` (estimated time, dodge/penalty timer). `POST /lol-lobby/v2/play-again`. `GET /lol-lobby/v2/party/eog-status`. | `LA` [`lobby.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/lobby.ts), [`auto-gameflow/matchmaking-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-gameflow/matchmaking-controller.ts) |
| Reconnect / dodge / exit post-game | Reconnect: `POST /lol-gameflow/v1/reconnect`. Dodge ⚠: `POST /lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=["","teambuilder-draft","quitV2",""]`, or `POST /lol-gameflow/v1/session/dodge`. `POST /lol-end-of-game/v1/state/dismiss-stats`. | `LA` [`gameflow.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/gameflow.ts), [`login.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/login.ts) |
| Auto honor | `GET /lol-honor-v2/v1/ballot/`. `POST /lol-honor/v1/honor` (or `/lol-honor/v1/ballot`). | `LA` [`honor.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/honor.ts), [`auto-gameflow/honor-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-gameflow/honor-controller.ts) |
| Invitations / party | `GET /lol-lobby/v2/received-invitations`, then `POST …/{id}/accept` or `/decline`. `POST /lol-lobby/v2/lobby/invitations`. `POST /lol-lobby/v2/lobby/members/{summonerId}/promote` or `/kick`. `POST /lol-lobby/v2/eligibility/party` and `/self`. | `LA` [`lobby.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/lobby.ts), [`auto-gameflow/invitation-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-gameflow/invitation-controller.ts) |
| Create lobby / custom game | `POST /lol-lobby/v2/lobby` with `{queueId}`, or with `{customGameLobby:{configuration:{gameMode:"PRACTICETOOL",mapId:11,teamSize:5,…},lobbyName,lobbyPassword},isCustom:true}`. Swarm map: `PUT /lol-lobby/v2/lobby/strawberryMapId`. | `LA` [`lobby.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/lobby.ts) · Seraphine `create5v5PracticeLobby` in [`connector.py`](https://github.com/Miuguel/Seraphine/blob/master/app/lol/connector.py) |
| **Champ-select state (lobby players, intents, positions)** | `GET /lol-champ-select/v1/session`: `myTeam` / `theirTeam` with `puuid`, `cellId`, `assignedPosition`, `championPickIntent`, `nameVisibilityType`, `obfuscatedPuuid`; `actions`; `bench`; `timer`. Also `GET /lol-champ-select/v1/summoners/{cellId}`. Hidden identities (`nameVisibilityType:"HIDDEN"`) must **not** be de-obfuscated ⚠⚠. | `LA` [`ongoing-game/champ-select-members.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/ongoing-game/champ-select-members.ts) (the `magic()` call is what to avoid: [`src/main/native/magic.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/native/magic.ts)) · DraftGap [`src-tauri/src/main.rs`](https://github.com/vigovlugt/draftgap/blob/main/apps/frontend/src-tauri/src/main.rs) |
| Pickable / owned champions | `GET /lol-champ-select/v1/pickable-champion-ids`, `bannable-champion-ids`, `all-grid-champions`, `disabled-champion-ids`. `GET /lol-champions/v1/owned-champions-minimal` (or `/lol-champions/v1/inventories/{summonerId}/champions`). | `LA` [`champ-select.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/champ-select.ts) · xyra (owned-only recommendations) · ChampR [`lcu_api.rs`](https://github.com/cangzhang/ChampR/blob/main/crates/lcu/src/lcu_api.rs) |
| **Pick / ban / hover** ⚠ | `PATCH /lol-champ-select/v1/session/actions/{actionId}` with `{championId, completed:false}` to hover/show and `{…, completed:true}` to lock. | `LA` [`auto-select/ban-pick-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-select/ban-pick-controller.ts), [`action-executor.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-select/action-executor.ts) · rank-analysis [`lcu/api/champion_select.rs`](https://github.com/wnzzer/rank-analysis/blob/main/rank-analysis-app/src-tauri/src/lcu/api/champion_select.rs) · frank [`src/lcu/autoBP.ts`](https://github.com/SYJun404/frank/blob/frankrust/src/lcu/autoBP.ts) · hh-lol-prophet [`services/lcu/api.go`](https://github.com/real-web-world/hh-lol-prophet/blob/main/services/lcu/api.go) |
| Bench / reroll / trades (ARAM, URF) | `POST /lol-champ-select/v1/session/bench/swap/{championId}`. `POST /lol-champ-select/v1/session/my-selection/reroll`. Swaps and trades: `POST /lol-champ-select/v1/session/{swaps,trades,champion-swaps}/{id}/{accept,decline,request,cancel}`. `GET /lol-champ-select/v1/ongoing-champion-swap`. | `LA` [`auto-select/bench-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-select/bench-controller.ts), [`trade-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-select/trade-controller.ts) · Mimic [`web/src/components/champ-select/`](https://github.com/molenzwiebel/Mimic/tree/master/web/src/components/champ-select) |
| **Summoner spells / skin** | `PATCH /lol-champ-select/v1/session/my-selection` with `{spell1Id, spell2Id}` or `{selectedSkinId}`. `GET /lol-champ-select/v1/skin-carousel-skins`. | `LA` [`champ-select.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/champ-select.ts) |
| **Rune page import** | `GET /lol-perks/v1/pages`. `GET /lol-perks/v1/inventory` (free page count). `DELETE /lol-perks/v1/pages/{id}` (only **your own** page). `POST /lol-perks/v1/pages` with `{name, primaryStyleId, subStyleId, selectedPerkIds[9], current:true}`, or `PUT /lol-perks/v1/pages/{id}`. `PUT /lol-perks/v1/currentpage`. Client recommendations: `/lol-perks/v1/recommended-pages/champion/{id}/position/{pos}/map/{mapId}`. | `LA` [`perks.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/perks.ts), [`auto-champ-config/auto-config-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/auto-champ-config/auto-config-controller.ts) · ChampR [`lcu_api.rs`](https://github.com/cangzhang/ChampR/blob/main/crates/lcu/src/lcu_api.rs) · TrueMain [#1678](https://github.com/ilyanfraimbault/TrueMain/issues/1678) (policy-aware design) |
| **Item sets** — three variants | (1) **LCU API** (cleanest): `GET` then `PUT /lol-item-sets/v1/item-sets/{summonerId}/sets` (upsert your set). (2) Files: `<LoL>/Config/Champions/<Champ>/Recommended/*.json` (ChampR). (3) Files: `<LoL>/Config/Global/Recommended/<prefix>*.json` (LeagueAkari; install dir from `GET /data-store/v1/install-dir`). | xyra [`client_import.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/crates/xyra-core/src/client_import.rs) · ChampR [`builds.rs`](https://github.com/cangzhang/ChampR/blob/main/crates/lcu/src/builds.rs) · `LA` [`src/main/shards/league-client/index.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/league-client/index.ts) (`writeItemSetsToDisk`), [`opgg/utils/loadout.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/renderer/src-opgg-window/opgg/utils/loadout.ts) |
| **Lobby / teammates' match history** | `GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=19`. `GET /lol-match-history/v1/games/{gameId}` (details). `GET /lol-match-history/v1/game-timelines/{gameId}`. LCU only covers the **current shard**, with limited depth and no per-mode totals. Alternative ⚠: **SGP** `GET /match-history-query/v1/products/lol/player/{puuid}/SUMMARY` and `…/{REGION}_{gameId}/DETAILS` on `https://<cluster>-red.pp.sgp.pvp.net`, with the client's tokens (`GET /entitlements/v1/token`, `GET /lol-league-session/v1/league-session-token`). | `LA` [`match-history.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/match-history.ts), [`sgp/match-history-query.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/sgp/match-history-query.ts), [`akari-api/builtin.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/akari-api/builtin.ts) (SGP host map), [`sgp/token-state-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/sgp/token-state-controller.ts) · hh-lol-prophet [`api.go`](https://github.com/real-web-world/hh-lol-prophet/blob/main/services/lcu/api.go) · rank-analysis [`command/sgp.rs`](https://github.com/wnzzer/rank-analysis/blob/main/rank-analysis-app/src-tauri/src/command/sgp.rs) |
| Rank / summoner / mastery of any player | `GET /lol-ranked/v1/ranked-stats/{puuid}`. `GET /lol-summoner/v2/summoners/puuid/{puuid}`. Riot ID lookup: `POST /lol-summoner/v1/summoners/aliases` with `[{gameName,tagLine}]`. `GET /lol-champion-mastery/v1/{puuid}/champion-mastery`. SGP ⚠: `leagues-ledge/v2/rankedStats/puuid/{puuid}`, `summoner-ledge/v1/regions/{r}/summoners/puuids`. | `LA` [`ranked.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/ranked.ts), [`summoner.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/summoner.ts), [`sgp/leagues-ledge.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/sgp/leagues-ledge.ts) |
| **Premade detection** | In game / loading: players who share a `teamParticipantId` in `/lol-gameflow/v1/session` `gameData.teamOne/teamTwo` are one party. Inference: count games where pairs were on the same team in recent history (threshold 5). Lobby: `/lol-lobby/v2/comms/members`. EOG: `/lol-end-of-game/v1/eog-stats-block`. | lol-auto-accept [`src/components/Duo.js`](https://github.com/jasonwu1994/lol-auto-accept/blob/master/src/components/Duo.js) · `LA` [`ongoing-game/analysis-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/ongoing-game/analysis-controller.ts) · rank-analysis [`command/session.rs`](https://github.com/wnzzer/rank-analysis/blob/main/rank-analysis-app/src-tauri/src/command/session.rs) |
| "Met before" / tags / notes | Local DB (SQLite via TypeORM) keyed by PUUID, filled from every loaded game. Tags are exportable. | `LA` [`src/main/shards/saved-player/`](https://github.com/LeagueAkari/LeagueAkari/tree/dev/src/main/shards/saved-player) · rank-analysis `command/user_tag.rs`, `cloud_sync.rs` |
| Send to champ-select / lobby chat | `GET /lol-chat/v1/conversations` (find the `championSelect` or lobby room). `POST /lol-chat/v1/conversations/{id}/messages` with `{body, type:"chat"}`. | `LA` [`chat.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/chat.ts) · hh-lol-prophet [`api.go`](https://github.com/real-web-world/hh-lol-prophet/blob/main/services/lcu/api.go) |
| Send to **in-game** chat ⚠ | Simulated keyboard input (Enter + text + Enter) with a native `SendInput` add-on; only when the game window is in the foreground. | `LA` [`in-game-send/send-executor.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/in-game-send/send-executor.ts) |
| Presence / status / cosmetics | Status and fake rank ⚠: `PUT /lol-chat/v1/me` with `{statusMessage}`, `availability`, or `{lol:{rankedLeagueQueue,rankedLeagueTier,rankedLeagueDivision}}`. Background: `POST /lol-summoner/v1/current-summoner/summoner-profile` with `{key:"backgroundSkinId",value}`. Tokens / banner: `POST /lol-challenges/v1/update-player-preferences/`. Crest / frame: `PUT /lol-regalia/v2/current-summoner/regalia`. | Seraphine [`connector.py`](https://github.com/Miuguel/Seraphine/blob/master/app/lol/connector.py) · `LA` [`summoner.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/summoner.ts) |
| Appear offline (without breaking chat) | Local **XMPP proxy**: patch the Riot Client's config (chat host → localhost) and rewrite outgoing presence stanzas. | Deceive [`ConfigProxy.cs`](https://github.com/molenzwiebel/Deceive/blob/master/Deceive/ConfigProxy.cs), [`ProxiedConnection.cs`](https://github.com/molenzwiebel/Deceive/blob/master/Deceive/ProxiedConnection.cs) |
| Client UX control | `POST /riotclient/kill-ux`, `/riotclient/launch-ux`, `/riotclient/kill-and-restart-ux`. `/riotclient/zoom-scale`. Window-size fix via WinAPI (FixLCUWindow). | `LA` [`riotclient.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/riotclient.ts) · Seraphine `connector.py` |
| Game settings | Official options (window mode, minimap timers, attack range, minimap scale): `GET` / `PATCH /lol-game-settings/v1/game-settings`. Lock: `chmod 0444` on `<LoL>/Config/PersistedSettings.json`. | xyra [`game_settings.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/crates/xyra-core/src/game_settings.rs) · `LA` [`game-client/settings-file-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/game-client/settings-file-controller.ts) |
| **Replays** (download / watch) | `GET /lol-replays/v1/configuration`. `GET /lol-replays/v1/metadata/{gameId}`. `POST /lol-replays/v2/metadata/{gameId}/create`. `POST /lol-replays/v1/rofls/{gameId}/download`. `POST /lol-replays/v1/rofls/{gameId}/watch`. `GET /lol-replays/v1/rofls/path`. Offline `.rofl` playback: run `League of Legends.exe "<file.rofl>" "-GameBaseDir=…"`. | `LA` [`replays.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/replays.ts) · ReplayBook [`ExeTools.cs`](https://github.com/fraxiinus/ReplayBook/blob/master/src/Executables.Old/Utilities/ExeTools.cs) |
| Replay camera / cinematics | Replay API `GET` / `POST https://127.0.0.1:2999/replay/{game,playback,render,recording,sequence,particles}`. Requires `EnableReplayApi=1` in `game.cfg`. | League Director [`enable.py`](https://github.com/RiotGames/leaguedirector/blob/main/leaguedirector/enable.py) |
| **Spectate** | `POST /lol-spectator/v1/spectate/launch` with `{puuid, spectatorKey}`. Finding the live game uses SGP ⚠ `gsm/v1/ledge/region/{r}/puuid/{puuid}`. LeagueAkari notes Riot changed spectating, so arbitrary-player spectate only works on some servers. | `LA` [`spectator.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/spectator.ts), [`sgp/gsm.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/sgp/gsm.ts) |
| **In-game live data** (second screen: respawn, gold, items, events) | Live Client Data API: `GET /liveclientdata/allgamedata`, `activeplayer`, `playerlist`, `eventdata`, `gamestats`, `playeritems`, `playerscores`, `playersummonerspells`, `activeplayerabilities`. Polling at ~1 s is typical. | `LA` [`game-client/index.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/game-client/index.ts), [`respawn-timer-controller.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/respawn-timer/respawn-timer-controller.ts) · xyra [`engine/game_tips.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/src-tauri/src/engine/game_tips.rs) |
| Post-game / EOG stats | `GET /lol-end-of-game/v1/eog-stats-block` (or `/gameclient-eog-stats-block`). Full match-v5 stats through `/lol-match-history/v1/games/{gameId}`, or SGP `…/DETAILS` ⚠. Timeline: `/lol-match-history/v1/game-timelines/{gameId}`. | rank-analysis [`lcu/api/eog_stats.rs`](https://github.com/wnzzer/rank-analysis/blob/main/rank-analysis-app/src-tauri/src/lcu/api/eog_stats.rs) · LeagueRecord [`recorder/metadata.rs`](https://github.com/FFFFFFFXXXXXXX/league_record/blob/master/src-tauri/src/recorder/metadata.rs) |
| **Recording with an event-marked timeline** | Capture options: libobs in an external process, or **Windows Graphics Capture + D3D11 + Media Foundation** (H.264/AAC, fragmented MP4). Markers come from Live Client `eventdata` during the game plus `/lol-match-history/v1/game-timelines/{gameId}` afterwards. | LeagueRecord [repo](https://github.com/FFFFFFFXXXXXXX/league_record) · ninja-recorder [`live_client/events.rs`](https://github.com/NinjaGoldfinch/ninja-recorder/blob/main/src-tauri/src/live_client/events.rs), [`recorder/own/select.rs`](https://github.com/NinjaGoldfinch/ninja-recorder/blob/main/src-tauri/src/recorder/own/select.rs) |
| **Augment-card tiers without injection** [OVERLAY] | `BitBlt` screen grab of the card area (game must be **borderless**, in the foreground) → **Windows.Media.Ocr** `OcrEngine` in the client's language → match augment names to `/lol-game-data/assets/v1/cherry-augments.json` or the Mayhem list → score → draw with a **Direct2D DC render target** in a layered, click-through, never-focused window. | xyra [`src-tauri/src/screen.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/src-tauri/src/screen.rs), [`overlay.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/src-tauri/src/overlay.rs), [`engine/card_reader.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/src-tauri/src/engine/card_reader.rs) |
| Overlay windows (Electron variant) [OVERLAY] | Transparent `BrowserWindow`, `setAlwaysOnTop(true,'screen-saver')`, `setIgnoreMouseEvents(true)` (toggled for interaction), hotkey to show. `setContentProtection(true)` hides the window from screen capture (streamer mode). | `LA` [`window-manager/ongoing-game-window/window.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/window-manager/ongoing-game-window/window.ts), [`cd-timer-window/windows.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/window-manager/cd-timer-window/windows.ts), [`base-akari-window.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/main/shards/window-manager/base-akari-window.ts) |
| UI glued to the League **client** window (not the game) | Separate top-level window that tracks the client's position and size (or an "align with client" button). | RuneChanger [README](https://github.com/stirante/RuneChanger) · `LA` aux window |
| Phone remote | Desktop "conduit" proxies LCU REST + WebSocket to a phone web UI, through a relay with 6-digit pairing and end-to-end encryption (Mimic), or a QR pairing over LAN/Tailscale (xyra). | Mimic [`conduit/`](https://github.com/molenzwiebel/Mimic/tree/master/conduit) · xyra [`src-tauri/src/phone.rs`](https://github.com/DiegoFernandoLojanTenesaca/xyra/blob/master/src-tauri/src/phone.rs) |
| Game-data assets (no internet needed) | `GET /lol-game-data/assets/v1/{champion-summary,items,perks,perkstyles,summoner-spells,queues,maps,cherry-augments,strawberry-hub,challenges,loots}.json`, plus icons at `/lol-game-data/assets/v1/champion-icons/{id}.png`. | `LA` [`game-data.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/game-data.ts) |
| Loot / missions / rewards / event pass | `GET /lol-loot/v1/player-loot-map`. `POST /lol-loot/v1/recipes/{recipe}/craft?repeat=N`. `POST /lol-loot/v1/craft/mass`. `/lol-missions/v1/missions`. `/lol-rewards/v1/grants` + `/select-bulk`. `/lol-event-hub/v1/events/{id}/reward-track/claim-all`. | `LA` [`loot.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/loot.ts), [`event-hub.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/event-hub.ts) |
| Login queue position | `GET /lol-login/v1/login-queue-state` | `LA` [`login.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/league-client/login.ts) |
| Third-party build data used by OSS ⚠ (unlicensed) | OP.GG private API `https://lol-api-champion.op.gg/api/{region}/champions/{mode}/{championId}/{position}`, `/api/contents/tiers`, `/api/contents/aram-balance`, `/api/contents/stats/champions/{id}/aram-augments`. 101.qq.com (CN). Fandom (ARAM balance). ChampR runs its **own crawler + API server**. | `LA` [`opgg/index.ts`](https://github.com/LeagueAkari/LeagueAkari/blob/dev/src/shared/http-api-axios-helper/opgg/index.ts) · Seraphine [`opgg.py`](https://github.com/Miuguel/Seraphine/blob/master/app/lol/opgg.py) · ChampR [`packages/opgg`](https://github.com/cangzhang/ChampR/tree/main/packages/opgg), [`crates/server`](https://github.com/cangzhang/ChampR/tree/main/crates/server) |
| LLM post-game review | Stream an OpenAI-compatible chat completion (DashScope/Qwen) through a Tauri Channel. The prompt is built from quantified match stats; results are cached per match. | rank-analysis [`command/ai.rs`](https://github.com/wnzzer/rank-analysis/blob/main/rank-analysis-app/src-tauri/src/command/ai.rs) |
| LCU proxy for web front-ends | Local HTTP/WS proxy (`localhost:4396/v1/lcu/proxy`) that forwards any REST/WSS call to the LCU. | hh-lol-prophet [README](https://github.com/real-web-world/hh-lol-prophet) |

**Stack / footprint benchmarks for "native or Tauri, not Electron":**
- **rank-analysis**: Tauri 2, **~5 MB installer**.
- **ChampR**: v1 Electron ~70 MB → v2 Tauri ~4 MB → **Slint** (fully native Rust UI, no WebView).
- **LeagueRecord**: Tauri + libobs; **~5 MB RAM idle / ~50 MB recording / ~160 MB while its WebView2 UI is open**.
- **ninja-recorder**: headless Rust daemon plus a disposable UI process.
- **xyra**: Direct2D overlay so there is **no webview in game**.

---

## 5. Sources

**DPM.LOL**
- X/Twitter @dpmlol posts:
  - launch 2026-09-26: https://x.com/dpmlol/status/2103877421447381308
  - Overlays: Notifications 2026-09-18: https://x.com/dpmlol/status/2100887091521392677
  - App 1.6.0 2026-08-21: https://x.com/dpmlol/status/2090736171248754721
  - overlays 2025-09-09: https://x.com/dpmlol/status/1965381688755978480
  - beta 2025-08-19 (for 30 Aug): https://x.com/dpmlol/status/1957734705870029074
  - roadmap 2025-08-01: https://x.com/dpmlol/status/1951241835696775301
  - other premium tier 2025-07-21: https://x.com/dpmlol/status/1947266937777524777
  - desktop focus 2025-05-05: https://x.com/dpmlol/status/1919335516417282388
  - Premium live 2025-05-03: https://x.com/dpmlol/status/1918740957199011849
  - DPM Score details: https://x.com/dpmlol/status/1894455202897392034
  - rank distribution: https://x.com/dpmlol/status/2044464824592064728
- dpm.lol pages (via search extracts; direct fetch blocked):
  - https://dpm.lol/premium
  - https://dpm.lol/changelog
  - https://dpm.lol/app/settings
  - https://dpm.lol/app/overlays
  - https://dpm.lol/faq
  - https://dpm.lol/studio/ranks
  - https://dpm.lol/game
- esports.gg interview: https://esports.gg/news/league-of-legends/how-dpm-lol-is-transforming-lol-analytics/
- TrueMain review of DPM's app (policy framing): https://github.com/ilyanfraimbault/TrueMain/issues/1671 · LCU policy questions: https://github.com/ilyanfraimbault/TrueMain/issues/1680 · rune import design: https://github.com/ilyanfraimbault/TrueMain/issues/1678
- Competitive analysis dated 2026-07-17 (DPM prices, overlay names, Blitz verified feature list, Riot precedents): https://github.com/LINDECKER-Charles/LeagueOfDataBaseFinal/blob/HEAD/docs/produit/analyse-concurrentielle.md
- Unofficial wrapper: https://github.com/ptrtht/dpm-desktop
- Not readable here: Instagram "DPM Desktop App features" https://www.instagram.com/p/DPgjLdLDXJ0/ · YouTube beta review https://www.youtube.com/watch?v=DuOpVD9zVr0

**Blitz**
- Feature pages:
  - https://blitz.gg/overlays/lol
  - https://blitz.gg/lol/overlay/loading-screen
  - https://blitz.gg/overlays/tft
  - https://blitz.gg/premium
  - https://blitz.gg/lol/tierlist/aram
  - https://blitz.gg/lol/tierlist/arena
  - https://blitz.gg/lol/tierlist/urf
  - https://blitz.gg/lol/arena-augments
  - https://blitz.gg/lol/aram-mayhem-augments
  - https://blitz.gg/lol/champions/MasterYi/probuilds
- Support centre:
  - https://support.blitz.gg/hc/en-us/articles/4415422406425 (price)
  - https://support.blitz.gg/hc/en-us/articles/4415437829273 (Premium, multi-game)
  - https://support.blitz.gg/hc/en-us/articles/8771266395535 (QuickGuide)
  - https://support.blitz.gg/hc/en-us/articles/360032708372 (auto-import)
  - https://support.blitz.gg/hc/en-us/articles/900001178283 (overlay troubleshooting)
  - https://support.blitz.gg/hc/en-us/articles/4415407336857 (in-depth guide)
  - https://support.blitz.gg/hc/en-us/articles/4415407357465 (web vs app)
- Mobile app: https://apps.apple.com/ca/app/blitz/id1591484739
- winget manifest (2.1.630, 2026-09-05, nullsoft): https://github.com/microsoft/winget-pkgs/tree/master/manifests/b/Blitz/Blitz
- Ad-block patcher (Electron `app.asar`): https://github.com/lulzsun/blitz-app-adblock
- Org repos (Elixir backend): https://github.com/theblitzapp
- Reviews:
  - https://buildzcrank.com/en/blog/best-league-of-legends-app-2026/
  - https://buildzcrank.com/en/blog/lol-companion-app-without-overwolf/
  - https://buildzcrank.com/en/blog/mobalytics-vs-blitz-vs-porofessor/
  - https://www.itero.gg/articles/what-is-the-best-league-of-legends-companion-app-in-2025
  - https://1v9.gg/blog/best-league-of-legends-companion-apps
  - https://hexgate.app/blog/hexgate-vs-blitz-vs-mobalytics/
- RAM complaint (secondary): https://github.com/luansilvadb/educador_de_fundamentos_lol/blob/HEAD/.planning/research/FEATURES.md
- Databricks blog (via analysis): https://www.databricks.com/blog/how-blitz-and-databricks-are-powering-new-era-competitive-gaming

**OP.GG for Desktop**
- Product and patch notes:
  - https://op.gg/desktop
  - https://op.gg/desktop/en/overlays/lol
  - https://op.gg/desktop/en/patch-notes
  - https://op.gg/desktop/en/patch-notes/2025.05.08-v2.0.0
  - https://op.gg/desktop/en/patch-notes/2025.09.02-v2.0.5
  - https://op.gg/desktop/en/patch-notes/2025.12.08-v2.0.11
  - https://op.gg/desktop/en/events
  - https://op.gg/desktop/en/games
  - https://op.gg/desktop/en/downloads
  - https://op.gg/desktop/en/status
- Help centre:
  - https://help.op.gg/hc/en-us/articles/48465006797721 (overlay on/off)
  - https://help.op.gg/hc/en-us/articles/48467238743961 (getting started)
  - https://help.op.gg/hc/en-us/articles/48461900303001 (app closes when game starts)
  - https://help.op.gg/hc/en-us/articles/31091483351065 (Ad-free features)
  - https://help.op.gg/hc/en-us/articles/31091870209689 (Ad-free desktop)
  - https://help.op.gg/hc/en-us/articles/30992541874969 (spectate)
  - https://help.op.gg/hc/en-us/articles/31088821370777 (multi-search)
  - https://opggfordesktop.zendesk.com/hc/en-us/categories/45781265715737-Guide-to-Features
- Other:
  - Membership: https://member.op.gg/membership
  - Overwolf listing: https://www.overwolf.com/app/opgg-electron-app
  - MCP: https://github.com/opgginc/opgg-mcp
  - League Classic (mode context): https://www.hotspawn.com/league-of-legends/news/league-of-legends-classic-guide

**Policy**
- KBotExt Vanguard ban notice: https://github.com/KebsCS/KBotExt/issues/252
- Riot Vanguard third-party FAQ: https://www.riotgames.com/en/DevRel/vanguard-faq (not read, listed in search)
- Enemy-ult-timer ban context (Dexerto via analysis): https://www.dexerto.com/league-of-legends/popular-league-of-legends-add-on-criticized-for-adding-cheat-feature-players-think-should-be-banned-3142237/

**OSS repositories (cloned and read)**
- https://github.com/LeagueAkari/LeagueAkari (CHANGELOG, i18n `src/shared/i18n/en/renderer/*.yaml`, `AGENTS.md`) · releases: https://github.com/LeagueAkari/LeagueAkari/releases
- https://github.com/Zzaphkiel/Seraphine (archived, code removed) · backup: https://github.com/Miuguel/Seraphine
- https://github.com/cangzhang/ChampR
- https://github.com/SYJun404/frank
- https://github.com/real-web-world/hh-lol-prophet
- https://github.com/wnzzer/rank-analysis
- https://github.com/KebsCS/KBotExt
- https://github.com/molenzwiebel/Deceive
- https://github.com/PenguLoader/PenguLoader
- https://github.com/molenzwiebel/Mimic
- https://github.com/adv-inn/Futaba
- https://github.com/DiegoFernandoLojanTenesaca/xyra
- https://github.com/vigovlugt/draftgap
- https://github.com/stirante/RuneChanger
- https://github.com/pipe01/legendary-rune-maker
- https://github.com/sweetriverfish/LeagueAutoAccept
- https://github.com/jasonwu1994/lol-auto-accept
- https://github.com/0xInception/LobbyReveal
- https://github.com/LyticalApp/Lytical
- https://github.com/fraxiinus/ReplayBook
- https://github.com/RiotGames/leaguedirector
- https://github.com/FFFFFFFXXXXXXX/league_record
- https://github.com/arasan95/league_record_custom
- https://github.com/NinjaGoldfinch/ninja-recorder
- https://github.com/developers192/DetailedLoLRPC
- https://github.com/MManoah/league-profile-tool
- https://github.com/lenny-ts/league_profile_tool
- https://github.com/sivir/crystal
- https://github.com/KebsCS/lcu-and-riotclient-api
- https://github.com/BlossomiShymae/Needlework.Net
- https://github.com/HextechDocs/lcu-explorer
- https://github.com/KebsCS/LeagueClientDebugger
- https://github.com/dysolix/hasagi-core
- https://github.com/Nicetyone/league-lean
- https://github.com/snacbot/warden-releases
- Discovery: GitHub topic `lcu-api` (155 repos)
- FMHY MOBA tools list: https://github.com/fmhy/edit/blob/main/docs/gaming-tools.md
