# D — Draft helpers: tool catalog, DraftGap source-level deep dive, and a stats-only design

*Research date: 2026-09-27. Scope: champion-select (pick/ban) helpers for a lightweight LoL desktop companion. Our feature must be statistics only (no AI/ML recommendations) and update live as picks and bans come in.*

---

## 0. TL;DR

**The model worth copying.** DraftGap is the only well-known open-source, stats-only draft helper. It uses a **log-odds (Elo-scale) additive model** with a **Beta-style prior on every term** [SRC]:

```
rating(p) = −400·log10(1/p − 1)        winrate(d) = 1/(1 + 10^(−d/400))      (Elo scale = logit × 400/ln10)

base_i   = rating( (w_patch + K·p30d) / (g_patch + K) )          current patch, pulled toward the 30-day win rate
exp_vs   = rating(p_a) − rating(p_b)                             "no interaction" expectation (Bradley–Terry / log5)
exp_duo  = rating(p_a) + rating(p_b)
m_ab     = rating( (w_ab + K·winrate(exp_vs)) / (n_ab + K) ) − exp_vs       matchup delta (all 25 ally×enemy pairs)
s_ab     = rating( (w_ab + K·winrate(exp_duo)) / (n_ab + K) ) − exp_duo     duo delta (10 pairs per team)
Total    = Σbase_ally + Σs_ally + Σm − Σbase_enemy − Σs_enemy ;   P(win) = winrate(Total)
K ("risk level") = 3000 / 2000 / 1000 (default) / 500 / 250 prior games, the same for every pair type
```

**What our empirical check found.** I ran a variance-components (empirical-Bayes) analysis on a public DraftGap-format snapshot: lolalytics-derived, Diamond 2+, all regions, 30 days to patch 16.19, about 1.96M games [DATA]. How big the real interaction effects are depends strongly on the role pair:

| Pair type | True SD τ of the delta | Prior strength k = 0.25/τ² (games) |
|---|---|---|
| Top-vs-top / mid-vs-mid lane | 2.1 / 1.9 pp | ≈570 / 700 |
| Jungle, bot and support lanes; enemy bot-vs-support | 1.2–1.3 pp | ≈1,400–1,700 |
| Jungle vs other roles | 0.8–1.0 pp | ≈2,300–3,900 |
| Other cross-map pairs | 0.6–0.8 pp | ≈4,200–7,100 |
| Bot+support duo | 1.2 pp | ≈1,800 |
| Jungle+mid duo | 0.7 pp | ≈5,000 |
| Duos involving top | ≈0–0.4 pp | ≈20k to ∞ (negligible) |

DraftGap's uniform K=1000 therefore **under-shrinks cross-lane and duo noise**. Changing only the prior changes the #1 last-pick suggestion in **56% of scenarios**. The posterior SD of a candidate's score is **≈2.1 pp**, while the gap between the #1 and #10 candidates is **≈2.4 pp**, and P(#1 is truly better than #2) ≈ 0.58. **Rankings need uncertainty shown.** The implied draft-only accuracy of the additive model is ≈55%, which is in line with published draft-only models (≈52–57%).

**Proposed model.** Keep DraftGap's additive log-odds structure. Changes:
- Fit a separate prior strength k for each role pair by empirical Bayes at each data refresh.
- Use a patch-aware prior for the base win rate.
- Take the expectation over the possible enemy role assignments instead of using only the single most likely one.
- Carry a posterior variance on every term.
- Add a separate, shrunk **personal-comfort** term.
- Add **counter-risk** and **ban-value** metrics.
- Put every term with its games count in a "why" breakdown.

**Best UX ideas to reuse:**
- Live re-ranked table with "team win rate if picked" and a Δ-vs-current column (DraftGap, draftgap-plus).
- Role-probability chips on enemy picks, with click-to-lock (DraftGap).
- A contribution table (Base / Matchup / Duo / Total) and a win-rate decomposition dialog (observed vs model win rate, number of games) (DraftGap).
- A ⚠ marker on small samples (DraftGap).
- Placement of banned / unowned / favourite champions (DraftGap).
- A "blind-safe" view adjusted for being counterpicked (LoLDraftAI does this with a neural net; we can do it transparently).
- Per-recommendation explanations (Winrate.gg uses SHAP; our model is additive, so the explanation is exact).
- Champion-pool personalisation (iTero, stats-only in our version).
- Ban suggestions (Porofessor and OP.GG, per third-party reports).

---

## How to read the evidence tags

- **[SRC]** I read it in source code or official repository files during this session.
- **[DATA]** I computed it in this session from a public dataset. Scripts are listed in the Appendix.
- **[SNIP]** It comes from web-search result snippets of vendor pages captured this session. These are vendor claims; the pages were not opened because the egress proxy blocks non-GitHub sites.
- **[3P]** It comes from third-party documents dated 2026 found on GitHub (competitor analyses, PRDs). These are unverified.
- **[BK]** It is my background knowledge (up to mid-2026), not re-verified. **Treat it as a hypothesis.**

**Limitations.** The session's shared WebSearch budget ran out after the first few queries (the tool reported "200 of 200 used"), and all vendor domains are blocked. As a result, the commercial-tool entries (Blitz, Mobalytics, U.GG, OP.GG, Porofessor, DPM) are weakly verified. §1.4 has a checklist for a manual verification pass.

---

## 1. Catalog of champion-select and draft helpers

### 1.1 Overview matrix

| Tool | Stats or AI | Surface | Live client sync | What it shows in champ select | Updates during the draft | Explains "why" | Price | Evidence |
|---|---|---|---|---|---|---|---|---|
| **DraftGap** | **Stats**: log-odds additive model plus prior | Web (draftgap.com) and desktop (Tauri); MIT open source | Yes. Polls `/lol-champ-select/v1/session` every 500 ms | Suggestion table (team win rate if picked; optional Champions/Matchups/Duos columns); win rate for both teams; enemy role probabilities; damage-type bar; analysis view; scaling chart; suggestions for the opponent too | Recomputes on every lock; hovers optional ("Analyze hovered champions in the draft") | **High**: every term with its games count; ⚠ below 1000 games | Free | [SRC] |
| **iTero** | AI ("AI-Powered Drafting Coach") | Web and desktop (Overwolf listing "The iTero AI Coach") | Yes ("jump into a game to let the coach work out the best champions") | Personalised picks (both teams, your match history, your champion pool); lobby scouting; composition-based runes and spells; after lock-in, matchup details and "which team scales best" | Live | Unknown | Free plus premium (price not public) [3P] | [SNIP][3P] |
| **LoLDraftAI** | AI (neural net) | Web and desktop (Electron) | Yes ("automatic champion live tracking") | Win probability; champion recommendations (flex-aware, keystone-aware; "Typical Counterpick Adjusted" mode); runes; full item build (one-click item set) | Live | Low (black box) | Free to try; "7-day free trial to access the full champion pool" | [SRC readme][SNIP] |
| **Winrate.gg** | AI (gradient-boosted trees, 58 features, TreeSHAP) | Web ("LoL Draft Assistant") | Unknown | Recommendations with SHAP explanations | Unknown | Medium (SHAP) | Unknown | [SNIP] |
| **Blitz.gg** | Stats and builds | Desktop (own installer, not Overwolf [3P]) | Yes | Auto-import of runes, items and spells; "opponent scouting, matchup insights" [3P] | Live | Unknown | Free with ads; Pro ≈ $4.99/mo [3P] | [3P][BK] |
| **Mobalytics** | Stats plus ML scores (GPI) | Desktop (Overwolf [3P]) and web | Yes | "draft tools overlay, per-champion coaching", build import [3P] | Unknown | Unknown | Free; $7.99/mo or $69.99/yr [3P] | [3P] |
| **U.GG** | Stats | Web and desktop app | App: yes | Per-champion counters (win rate and games), tier lists, bot-lane duo tables, builds, auto-import [3P][BK] | Unknown | Medium (win rate plus games) | Free; U.GG PLUS $3.99/mo or $29.88/yr [3P] | [3P][BK][SRC API clients] |
| **OP.GG** | Stats (plus AI features) | Web and desktop | Yes | "Real-time recommendations for your role (hourly updates), opponent scouting, ally synergy tooltips, ban suggestions" [3P] | Live | Unknown | Free; ≈$3/mo to remove ads [3P] | [3P] |
| **Porofessor** | Stats and scouting | Overwolf desktop and web | Yes | Scouting (rank history, champion pool, recent games, tags); "Suggestions bans/counterpicks in champ select" [3P] | Live | Unknown | Free with ads plus premium (2025) [3P] | [3P] |
| **DPM.LOL** | Third parties call it an "AI-powered draft assistant" | Web and desktop ("no ads, no Overwolf"; for 6-month and annual subscribers) [3P] | Unknown | "Draft Helper" (Sept 2026, per the brief): **not verified** | Unknown | Unknown | €3.99/mo; €19.99/6 mo; €35.99/yr [3P] | [3P][UNVERIFIED] |
| **Lolalytics** | Stats data | Web | No | Counters: win rate, **Δ1, Δ2**, pick rate, games; synergy tables | Static pages | High (Δ2 is normalised for both champions' strength) | Free | [SRC via DraftGap][3P] |
| **METAsrc Counter Picker** | Stats | Web | No (manual input) | "Full draft input (bans + ally + enemy picks) → filtered champion suggestions" | Manual | Unknown | Free | [3P] |
| **Counterstats.net**, League of Graphs, LoLCounter | Stats (LoLCounter: community votes) | Web | No | Counter lists per champion and lane; "best with" lists | Static | Low–medium | Free with ads | [BK] |
| **ProComps.gg** | Tag-based composition drafting | Overwolf and web | Yes (claimed) | "Team-composition-aware drafting (AP/AD balance, frontline, engage, poke)" | Unknown | Unknown | Freemium; premium for live-draft champion-pool features [3P] | [3P][SNIP] |
| Smartpick.gg ("Daisy"), lol-brain.com, draftlol.ai, Champ Select Coach (Overwolf), Team Advisor, Meeko.ai | AI | Various | Some claim real-time sync | Win probability and suggestions | Unknown | Unknown | Unknown | [SNIP][3P] |
| **Draft simulators**: drafter.lol, draftlol.dawe.gg, uDrafter, pickban.pro, drafting.gg, Riot prodraft | No stats (practice and tournament drafting) | Web | No | Captain and spectator links, timers, Fearless and Ironman series lockouts, stream overlays | Real-time between captains | n/a | Free | [3P][BK] |

### 1.2 Per-tool notes

#### DraftGap (vigovlugt/draftgap) — reference implementation. Full math in §2.

- **Features, literally from the UI code [SRC]:**
  - Suggestion table columns: favourite ★, Role, Champion, optional "advanced" columns (Champions / Matchups / Duos), **Winrate** (team win rate if picked), and an info icon that opens a per-champion analysis dialog.
  - Search box; role filter; favourites filter; filter menu "Minimum game count (7d)" with options 500 / 1000 / 2500 / 5000 (default 1000).
  - Settings:
    - "Ignore individual champion winrates"
    - "Risk level" (Very Low … Very High)
    - "Place favourites at top of suggestions"
    - "Place banned champion suggestions at" Bottom / In Place / Hidden
    - "Place unowned champion suggestions at" Bottom / In Place / Hidden
    - "Show advanced winrates"
    - "Disable league client integration"
    - "Favourite builds site" (lolalytics / u.gg / op.gg)
  - Team sidebar: damage distribution bar (magic / physical / true), the team's "estimated winrate", five pick slots.
  - Each pick slot shows role icons with probabilities (roles above 5%). Clicking locks the role; tooltip: "Click to lock the champion in this position, the current estimated position is highlighted".
  - Analysis view:
    - Summary cards: Champions / Matchups / Duos / Winrate.
    - "Ally overview" contribution table: BASE, MATCHUP, DUO (each duo split half-and-half), TOTAL.
    - Base win rates of individual champions.
    - "Matchups" table with HEAD 2 HEAD (same-role pairs only) or ALL.
    - Duo tables.
    - "Scaling" chart by game length: 0–20, 20–25, 25–30, 30–35, 35+ minutes.
  - "Winrate Decomposition" dialog shows:
    - "Draftgap winrate" ("more conservative than the real winrate … will heavily change depending on the risk level")
    - "Observed winrate" ("Raw normalized winrate from the sample")
    - "Observed games"
  - Any value based on fewer than 1000 games gets a yellow ⚠: "This winrate might not be accurate due to the small sample size of N games".
  - Win-rate colour classes: below 45%, 48.5%, 51.5%, 53% and 55% boundaries.
- **How it updates [SRC]:**
  - While in champ select it polls the client every 500 ms (1 s at the main menu, 2 s when the client is not found).
  - Ally roles come from `assignedPosition`. Enemy roles are inferred (§2.9). Bans come from completed ban actions. Owned champions come from `/lol-champions/v1/inventories/{summonerId}/champions-playable`. Client favourites are imported from `/lol-champ-select/v1/grid-champions`.
  - Hovers (`championPickIntent`) are included only if the toggle is on.
  - Every change recomputes both teams' suggestions: ours, and what the enemy "should" pick.
- **Model and data:** stats only; data is lolalytics Emerald+, all regions (§2). The FAQ lists its own limitations: "The overall team comp identity is not taken into account… Damage composition is also not used in the calculation". It deliberately avoids hand-labelled tags: "we do not want to incorporate opinions like 'malphite is an engage champion'". The method is credited to the YouTuber Jayensee (video linked in the FAQ).
- **Maintenance [SRC]:** v3.2.1 was released 2026-02-01; the last commit is 2026-08-30 ("Fix patch format"). Desktop builds use **Tauri**, which is lightweight.
- **Forks and derivatives [SRC readmes]:**
  - **draftgap-plus** adds:
    - "Dynamic Smart Tiers" per lobby, with an "S+" badge when one option is "statistically miles ahead".
    - A **"Delta Column"** (win-rate difference vs the current team state, green or red).
    - **Hover insight tooltips** (matchup breakdown and synergy).
    - A "Draft Training Mode" with keyboard-first navigation.
  - **AirMile/draftgap** is a champion-pool optimiser (U.GG data):
    - Matchup matrix, **coverage gaps** ("bad matchups where your entire pool has a sub-50% winrate"), blind-pick rankings, ban targets, and an A–F pool grade.
    - Uses Meraki metadata for damage types and CC.
  - **chimera-alex/draftgap-daten** publishes a daily, signed DraftGap-v5 dataset (Diamond 2+). I used it in §3.5.

#### iTero [SNIP][3P]
- Vendor copy: "AI-Powered Drafting Coach which provides champion recommendations to suit any draft, proven to win you more games".
- "analyses both teams, your match history and your champion pool to give you personalized draft and builds suggestions".
- "Advanced Lobby Scouting … from how aggressive they play the laning phase to whether they prefer to farm or fight in the mid game".
- "Composition-based Rune and Summoner recommendations".
- "Once both teams are locked in, iTero analyzes the teams and provides recommendations on builds, details on the match-up and works out which team scales best".
- An account analyser with "over 500 statistics".
- Web tools: Drafting Simulator (itero.gg/drafting-simulator), Champion Pool Builder (itero.gg/champion-pool-builder).
- Articles: "The iTero AI Drafting Model" (itero.gg/articles/the-draft-model); "How to win your Solo Queue Draft - a statistical analysis of 1M+ games" (itero.gg/articles/draft-sq).
- Third-party reports: 394K–500K+ installs, 4.5★, partner GIANTX, "no Overwolf required". This conflicts with the Overwolf listing "The iTero AI Coach"; possibly both versions exist.
- **AI (ML).** UI details were not verifiable.

#### LoLDraftAI (contrast: AI) [SRC readme][SNIP]
- **Model [SRC]:**
  - Neural network with learned champion, patch and champion×patch embeddings, plus queue-type and elo embeddings.
  - MLP with residual connections.
  - Multi-task heads (e.g., gold@15, win), with a separate win head per game-duration bucket.
  - Masking during training so it can handle partial drafts.
  - Trained on "tens of millions" of games.
  - README-reported validation accuracy: solo-queue model 56.1%, pro model 56.8%.
- **Site claims [SNIP]:**
  - 56.7% accuracy from the draft alone; 57.7% including runes.
  - "Flex pick aware suggestions" and "Keystone-aware suggestions".
  - A **"Typical Counterpick Adjusted" mode** that "adjusts predicted winrates based on how much each champion's impact typically swings when counterpicked, helping you identify safe blind picks". We can build a transparent stats version (§3.10).
  - Rune model and full item build conditioned on the whole draft; one-click item set in the desktop app.
  - Model updated every patch ("usually … by Saturday").
  - Free to try with no signup; "7-day free trial to access the full champion pool".
- The public monorepo stops at May 2025 (desktop app is Electron + React). A third-party document reports a self-declared "65.6% vs 56.5% for DraftGap" [3P, unverified].

#### Winrate.gg [SNIP]
- Gradient-boosted trees with "58 hand-engineered features (champion stats, pairwise matchups and synergy, team composition, playstyle clusters), with TreeSHAP explanations on every recommendation".
- Vendor-run benchmark on 20,000 ranked drafts, measuring the realised win rate when the pick that was actually made appears in the tool's top-10:

  | Tool | Realised win rate |
  |---|---|
  | Winrate.gg | 55.1% |
  | iTero | 52.9% |
  | LoLDraftAI | 49.8% |

  When the pick made was Winrate's top-1 recommendation, the realised win rate was 58.7%.
- The **benchmark design** (realised win rate by top-K bucket on historical drafts) is reusable for validating our stats model. It is confounded by player selection.

#### Blitz / Mobalytics / U.GG / OP.GG / Porofessor / DPM.LOL [3P][BK]: low confidence

Only third-party summaries were available. Take the free vs premium and "AI" labels from the matrix above.

**Shared pattern [BK]:**
- In champ select, these apps focus on **builds and auto-import** (runes, spells, item sets).
- They show **per-champion counter lists** for your lane opponent.
- They show **scouting**, which is limited in ranked solo/duo because champ select is anonymised.
- Some add **ban suggestions** (Porofessor, OP.GG [3P]) and "ally synergy tooltips" (OP.GG [3P]).

A 2026 competitor analysis [3P] says U.GG and OP.GG offer "Role-specific meta picks only; lacks full draft context scoring" and "Champion-centric counters, not draft-aware (one enemy vs. five simultaneously)".

**Data APIs seen in open-source clients [SRC]:**
- **U.GG matchups:** `stats2.u.gg/lol/1.5/matchups/{patch}/ranked_solo_5x5/{champId}/1.5.0.json`, rows `[champion_id, losses?, matches]`. The uggo-derived client (aovoq/lol-overlay) keeps counters with at least **0.5%** of the champion's total matches and shows the best and worst 5.
- **U.GG duos:** `…/champion_duos/…`.
- **OP.GG:** `lol-api-champion.op.gg/api/{region}/champions/ranked/{id}/{position}`. Counters have the form `{champion_id, play, win}`.

**DPM.LOL:** A July 2026 third-party analysis describes an "AI-powered draft assistant" and a Windows desktop app ("a whole new platform with no ads, no Overwolf", CEO quote) reserved for subscribers. The **"Draft Helper" (Sept 2026)** named in the brief could not be checked. Verify:
- Is it stats or ML?
- Does it show sample sizes?
- How does it handle a pool filter and roles?

#### Lolalytics (data provider) [SRC][3P]
- DraftGap's source. Endpoints:
  - `lolalytics.com/lol/{champ}/build/?tier=emerald_plus&region=all&patch=…&lane=…` (Qwik JSON: `header.n`, `header.wr`, `header.damage`, `enemy[lane]` rows `[championKey, winRate, Δ1, Δ2, pickRate, games]`, `sidebar.time`)
  - `a1.lolalytics.com/mega/?ep=build-team&…` (synergy rows)
- **Δ1 and Δ2 are not officially documented.** Third-party reverse engineering (hextech-studies build.py, lol_coachV2 tests) suggests:
  - Δ1 = WR(A vs B) − [average WR of all champions vs B]
  - Δ2 = WR(A vs B) − [strength-only expectation from both champions] ("normalized delta")
  - This makes **Δ2 the "matchup delta"** we want.
- A 2026 analysis calls Lolalytics "Pure data reference; no draft assistant" [3P].

#### Other open-source stats tools on GitHub (design ideas) [SRC]
- **hextech-studies / counterpick-coverage:**
  - Shrunk matchup effect = `n/(n+k) × Δ2`, where k is one **globally fitted empirical-Bayes concentration** (beta-binomial marginal likelihood, grid search plus golden-section search), "disclosed as equivalent prior games".
  - Pool coverage score = `Σ_j q_j · max(0, candidate − current)`, where q_j is the opponent's normalised lane pick rate.
  - Separate "matchup complementarity" and "absolute" views.
  - "Prior-only rows remain visibly marked".
- **wApMorty/LeagueStats SPEC-05:**
  - Score = Σ 0.04·(WR−50) + Σ 0.04·k_m·Δ2 + Σ 0.04·k_s·Δ2_syn − (enemy side), then P = sigmoid(score).
  - Confidence weight `n/(n+500)`; entry filter of 200 games; k_m = 1, k_s = 0.5.
  - **Logs (prediction, outcome) at draft end** so the parameters can later be calibrated with logistic regression and checked with a Brier score and reliability curve.
- **lol-best-picker:** 0.5 × enemy score + 0.5 × ally score; ties broken by games.
- **LoL-drafting-tools:** hand-weighted mix, e.g. `(counter.winRatio − winRatio)·0.1 + delta1·0.13 + (winRatio − opponentWR)·0.07 + …`. This is an anti-pattern: the weights are arbitrary.
- **deltadraft:** Electron client, Cloudflare R2 static JSON, GitHub Actions scraper; all computation happens client-side.
- **Draft-Buddy:** C# app that shows counters.
- ML projects for contrast: DraftSense (XGBoost), LoLAnalyzer, DraftGenius-AI, Beatrice.
- A data-science student project found draft-only models reach "~52%" accuracy with 129 features from OP.GG and DPM [3P]. This is consistent with draft being only weakly predictive.

#### Draft simulators [3P][BK]
- drafter.lol ("Fearless/Ironman/First Selection, UI stream/OBS, free"), draftlol.dawe.gg (the historical reference), uDrafter, pickban.pro, drafting.gg.
- Shared features: "Browser-based, no-signup pick/ban simulators… two captain links plus a spectator link with real-time updates; support timers, side selection, series (Fearless/Ironman) lockouts, corrections, role assignment, and stream overlays".
- GitHub examples: BlitzDraft (recreates pro drafts), draftlab, LoLDrafting (AI opponents), fearless-draft-helper.
- **None of these provides live stats.** Their only lesson for us: a training mode (as in draftgap-plus) can reuse our engine.

### 1.3 Riot policy constraints

Sources are third-party 2026 summaries [3P]. **Verify at developer.riotgames.com/policies/general before launch.**

- Every product that touches the client must be registered. The League Client API (LCU) "is not officially supported".
- If the product is monetised, a free tier is mandatory, paid content must be "transformative", and betting is not allowed.
- **Anonymity:** in Ranked Solo/Duo champ select, "non-party summoner names must stay hidden". "Lobby reveal" features count as de-anonymisation. So comfort statistics may only use the **local player's own** data.
- Enemy ultimate timers were banned (the two sources disagree: March 2025 vs March 2026) and in-game overlay ads were banned (May 2025).
- "Products cannot display win rates for Augments or Arena Mode items". This affects Arena, not Summoner's Rift drafting.
- One summary says Riot does not want tools that "solve games". Win-rate and counter suggestions are offered by many registered apps (DraftGap, OP.GG, Porofessor…), which suggests stats-based draft help is tolerated. **Keep the player in control: suggestions only, never automatic locking.**

### 1.4 Manual verification checklist for the commercial tools

For each of Blitz, Mobalytics, U.GG app, OP.GG desktop, Porofessor, DPM desktop "Draft Helper", iTero and LoLDraftAI, record:
1. Does it show a **ranked pick list** for my role? Does the list change after each enemy lock?
2. Which features does it use: lane counter only, or all five enemies plus ally synergy? Does it show **games count or confidence**?
3. How does it infer enemy roles? Can I override them?
4. Does it suggest bans, and are they tied to my intended pick?
5. Does it filter by my champion pool, owned champions, or mastery?
6. Does it show a team-vs-team win % and composition warnings (AD/AP)?
7. Is it free or behind a paywall, which parts, and at what price? Is it built on Overwolf? RAM usage?

---

## 2. DraftGap deep dive: exact math with code links

Repository: https://github.com/vigovlugt/draftgap (MIT). The core lives in `packages/core/src`.

### 2.1 Data pipeline [SRC]

- `apps/dataset/src/index.ts` builds two datasets:
  - `current-patch`: **base stats only**. `deleteDatasetMatchupSynergyData` strips matchups and duos.
  - `30-days`: base plus matchup, synergy and game-length stats.
  - Both are stored on S3.
- Sources:
  - Base and matchups: lolalytics Qwik JSON, `tier=emerald_plus`, `region=all` (`lolalytics/qwik.ts`).
  - Synergy: `a1.lolalytics.com/mega/?ep=build-team&tier=emerald_plus&queue=ranked&region=all` (`lolalytics/qwik-champion2.ts`).
  - Champion list and patch: Riot Data Dragon (`riot.ts`).
- Per champion-role, the pipeline stores:
  - `games = header.n`, `wins = round(n·wr/100)`
  - `matchup[role][champ] = {games, wins = games·wr/100}`
  - `synergy[role][champ]`
  - `damageProfile = header.damage` (physical / magic / true)
  - `statsByTime`: five game-length buckets built from lolalytics' seven time buckets.
- **Rank-bias removal** (`Dataset.ts::removeRankBias`): compute the overall win rate of the tier (e.g., the D2+ snapshot averages 51.4% [DATA], plausibly because D2+ players also face lower-ranked opponents). Then shift **every** win rate (base, matchup, duo, time) in rating space so the mean is 50%:
  `wins' = winrate(rating(wins/games) − rankRating) · games`.
- Refresh: `.github/workflows/dataset.yml` runs on cron `0 12 * * *` (daily at 12:00 UTC) plus manual dispatch. The FAQ says "updated every 12 hours", which does not match the cron.
- FAQ: "current Emerald+ Lolalytics solo/duo winrates from all regions of the last 30 days". Rank filtering is not offered, to avoid adding load on lolalytics and because of sample-size issues.
- Matchup data "are vs champions of every rank" (code comment). This is one reason DraftGap **averages both perspectives** (A's view of A–B and B's view inverted).

### 2.2 Rating scale — `rating/ratings.ts` [SRC]

```ts
ratingToWinrate(d) = 1 / (1 + 10^(−d/400))
winrateToRating(w) = −400 · log10(1/w − 1)            // = 400/ln(10) · logit(w) ≈ 173.7·logit(w)
getMatchupWinrate(w1,w2) = ratingToWinrate(rating(w1) − rating(w2))   // log5 / Bradley–Terry
getDuoWinrate(w1,w2)     = ratingToWinrate(rating(w1) + rating(w2))
```

Near 50%, 1 percentage point ≈ 6.95 rating points ≈ 0.04 logit.

### 2.3 Champion base term — `draft/analysis.ts::analyzeChampion` [SRC]

```ts
fullWR = full30d.games === 0 ? 0.5 : full30d.wins / full30d.games
stats  = addStats({wins: patch.wins, games: patch.games}, {wins: priorGames·fullWR, games: priorGames})
rating = winrateToRating(stats.wins / stats.games)          // absolute, relative to 50%
```

This is a Beta-binomial posterior mean of the current-patch win rate, with a prior centred on the 30-day win rate and weight `priorGames`. The code has a TODO for the case where the 30-day data has no games.

### 2.4 Matchups — `analyzeMatchups` (every ally × enemy pair: 25 pairs, lane and cross-lane) [SRC]

```ts
expectedRating  = rating(WR30d(ally, allyRole)) − rating(WR30d(enemy, enemyRole))
expectedWinrate = ratingToWinrate(expectedRating)
m  = stats(ally, allyRole, "matchup", enemyRole, enemy)        // ally's perspective
m' = stats(enemy, enemyRole, "matchup", allyRole, ally)        // enemy's perspective
wins  = (m.wins + (m'.games − m'.wins)) / 2
games = (m.games + m'.games) / 2
adj   = addStats({wins, games}, {wins: priorGames·expectedWinrate, games: priorGames})
matchupRating = rating(adj.wins/adj.games) − expectedRating    // posterior delta vs "no interaction"
```

### 2.5 Duos — `analyzeDuos` (all 10 same-team pairs) [SRC]

```ts
expectedRating = rating(WR30d(a, ra)) + rating(WR30d(b, rb))
combined = averageStats(stats(a→b "duo"), stats(b→a "duo"))
adj = addStats(combined, {wins: priorGames·winrate(expectedRating), games: priorGames})
duoRating = rating(adj.wins/adj.games) − expectedRating
```

### 2.6 Team total — `analyzeDraft` [SRC]

```ts
total = allyChampions + allyDuos + matchups − enemyChampions − enemyDuos
winrate = ratingToWinrate(total)
```

- With "Ignore individual champion winrates", both base terms are set to 0.
- The UI's per-champion contribution (`TotalChampionContributionTable.tsx`) is base + Σ its matchups + ½ Σ its duos.

### 2.7 Suggestions — `draft/suggestions.ts` [SRC]

- For every champion not already picked by either team, and for every role our team has not filled:
  - Skip the candidate if `games30d(champ, role) / 30 · 7 < minGames`. The default of 1000 per 7 days is about 4,286 games in 30 days.
  - Otherwise add the candidate and run `analyzeDraft`.
- Sort by resulting team win rate, descending.
- The same function runs for the opponent's perspective.
- In our D2+ snapshot the default filter leaves 45–87 candidates per role, covering about 97–99% of that role's games [DATA].

### 2.8 Risk level — `risk/risk-level.ts` [SRC]

`priorGamesByRiskLevel = {very-low: 3000, low: 2000, medium: 1000, high: 500, very-high: 250}` (default is `medium`).

Builds use a separate map: `{3000, 2000, 1000, 750, 500}`.

FAQ: "The higher the risk level, the more it will recommend duos/matchups that have a small sample size… niche duos/counters". So "risk" here is a single hand-set prior strength applied to every pair type.

### 2.9 Role inference — `role/role-predictor.ts` [SRC]

- `getTeamComps` recursively enumerates every assignment of the champions without a known role to the free roles.
  - P(assignment) = Π P(role | champion), where `P(role|champ) = games_in_role / total_games`, taken from the **current-patch** dataset.
  - Roles already taken are skipped.
  - Assignments are sorted by probability.
- `predictRoles` marginalises this into per-champion role probabilities. The UI shows roles above 5%.
- **Scoring uses only the single most probable assignment** (`allyTeamComps()[0][0]`, `opponentTeamComps()[0][0]`). Ally roles come from `assignedPosition`; the user can lock any role by clicking.
- Example with current-patch role shares, as DraftGap uses [DATA], enemy = {Pantheon, Sylas, Tahm Kench}:
  - Marginals: Pantheon top 43% / support 33%; Sylas jungle 49% / mid 46%; Tahm Kench support 50% / top 38%.
  - The **most likely full assignment has only 19% probability**. Adding Graves raises it to 46%.
  - Scoring only the argmax therefore throws away most of the probability mass.

### 2.10 Extra analysis [SRC]

- `extra-analysis.ts`: the scaling chart. For each time bucket, the champion's time win rate is shrunk toward its (shrunk) base win rate with `priorGames`, and the delta vs base is summed per team.
- `damage-distribution.ts`: sums `damageProfile` (magic / physical / true) over the team. It is shown only, never used in the score.

### 2.11 Critique (what we improve)

1. **One uniform prior strength (K=1000) for all 25 matchup and 10 duo types.** Our analysis (§3.5) shows the real effects differ roughly fourfold in SD across pair types, which means about a 16× (or more) difference in the right prior strength.
2. Scoring with the argmax role assignment instead of the expectation over assignments.
3. No posterior uncertainty is shown. The only signal is a ⚠ below 1000 games, and that threshold ignores pair type.
4. No personal comfort term, no ban suggestions, no counter-risk for blind picks.
5. The base prior ignores whether a champion was changed this patch.
6. Scaling and damage split are shown but not modelled. That is fine, but they should be labelled as informational.

---

## 3. Statistics for a transparent, stats-only draft score

### 3.1 Matchup win rate vs "matchup delta"

- The raw **matchup win rate** WR(A vs B) mixes three things: A's general strength, B's general strength, and the specific interaction between them.
- The **matchup delta** isolates the interaction: `δ = WR(A vs B) − E[WR | strengths only]`.
- With a log-odds additive (Bradley–Terry / log5 / Elo) expectation:
  `E = σ(logit p_A − logit p_B)` for opponents, and `E = σ(logit p_A + logit p_B)` for duo partners, where p is the role-specific base win rate.
- Lolalytics' **Δ2** is this kind of normalised delta; its **Δ1** subtracts only the opponent's baseline (§1.2).
- **Worked examples** (D2+, 30 days) [DATA]:

  | Pair | Base WRs | Expected | Observed (n) | Raw delta | Shrunk delta (EB k) | DraftGap K=1000 |
  |---|---|---|---|---|---|---|
  | Malphite vs Irelia (top) | 50.99% / 50.57% | 50.42% | 55.51% (n = 3,244; Wilson 95% 53.8–57.2) | **+5.1 pp** | **+4.3 ± 0.8 pp** (k=573) | +3.9 |
  | Vayne vs Malphite (top) | 47.94% / 50.99% | 46.95% | 37.5% (n = 1,514) | −9.4 pp | −6.8 ± 1.1 pp | −5.7 |
  | Lucian + Yuumi (bot/support) | 48.67% / 47.02% | 45.70% | 50.5% (n = 10,188) | **+4.8 pp** | +4.1 ± 0.5 pp (k=1,769) | +4.4 |
  | Lee Sin (jungle) vs Ahri (mid) | 49.70% / 51.11% | 48.59% | 48.02% (n = 12,780) | −0.6 pp | −0.5 ± 0.4 pp (k=2,299) | −0.5 |

  The Lucian + Yuumi raw pair win rate looks average, yet the synergy is strong once the two champions' low base win rates are accounted for.

### 3.2 Log-odds additive team model (Bradley–Terry for teams, with pairwise interactions)

```
S  = Σ_{i∈A} β_i − Σ_{j∈E} β_j                        main effects, β = logit(base WR)
   + Σ_{i∈A, j∈E} δ^vs_ij                             25 cross-team interactions
   + Σ_{i<i'∈A} δ^syn_ii' − Σ_{j<j'∈E} δ^syn_jj'       10 + 10 within-team interactions
   (+ Σ_{i ∈ me} c_i)                                  optional personal-comfort term
P(A wins) = σ(S) = 1/(1+e^{−S})
```

- DraftGap's Elo points are this model × 173.7.
- **No double counting:** each δ is defined relative to the additive expectation, and base win rates already average over typical opponents and allies.
- Remaining caveat: two-way tables can absorb correlated third-champion effects. A jointly fitted, L2-regularised logistic regression (a GLM on game-level Match-V5 data, i.e. main effects plus pair interactions with a Gaussian prior of variance τ²) would remove this. It is still a transparent statistical model, but it needs game-level data. **Option for v2.**

### 3.3 Synergy (duo) deltas

Same construction with the "+" expectation. Only **bot+support** is strong in practice (τ ≈ 1.2 pp); jungle+mid is moderate (0.7 pp); everything else is small (§3.5).

### 3.4 Bayesian shrinkage, priors and minimum samples

- **Beta-binomial posterior mean**, centred on the no-interaction expectation e:
  `p̃ = (w + k·e) / (n + k)`,  `δ = logit(p̃) − logit(e)`,  shrinkage factor `n/(n+k)`.
- **Empirical Bayes: choose k from data, not by hand.** If the true deltas of pair type t have SD τ_t (win-rate scale), sampling variance is `e(1−e)/n`, and the optimal k is
  `k_t = e(1−e)/τ_t² ≈ 0.25/τ_t²`  (because reliability = τ²/(τ² + 0.25/n) = n/(n + k)).
- **Estimating τ_t² by method of moments (DerSimonian–Laird)**, using residuals r_i = o_i − e_i with weights w_i = n_i/(e_i(1−e_i)):
  `τ² = max(0, (Q − (K−1)) / (Σw − Σw²/Σw))`, where `Q = Σ w_i (r_i − r̄)²`.
  Alternative: maximise the beta-binomial marginal likelihood over k (as hextech-studies does).
- **Posterior uncertainty of one delta** (normal approximation): `Var ≈ τ_t² · k_t/(n + k_t)`. Sum these variances across a candidate's terms to get a ± on its score.
- **Minimum samples:** keep every pair in the score (shrinkage handles small n). Hide the raw win rate when n < 30. Flag "low evidence" when `n/(n+k) < 0.3`. Use Wilson intervals only when displaying a raw win rate.

### 3.5 Empirical results

Dataset: DraftGap-v5 snapshot (lolalytics-derived) — Diamond 2+, all regions, 30 days, current patch 16.19.1, built 2026-09-27; 19,613,686 player-games (≈1.96M matches); sha256 values match the release manifest [DATA].

**Base win rates.**
- 865 champion-roles in total; 507 have at least 1,000 games.
- Among those 507: true SD of base WR ≈ **1.43 pp** (games-weighted); median games per champion-role 11.7k (p10 = 1.6k).
- Off-role picks (role share below 5%) have a pooled WR of **47.1%** (median 46.2%). A new or off-meta champion-role therefore needs a prior below 50%.

**Flex prevalence.** 85 of 173 champions have at least 10% of their games in a second role; 48 have at least 20%.

**Between-pair true SD (τ) and implied prior strength** (pairs where both champion-roles have at least 1,000 games; τ estimated from pairs with at least 200 games; stable to within ±0.05 pp for thresholds between 100 and 2,000 games):

| Matchup type | Pairs (all) | Median games | Share of pairs < 1000 games | τ (pp) | **k ≈ 0.25/τ²** |
|---|---|---|---|---|---|
| top vs top | 8,628 | 32 | 93% | **2.09** | **≈570** |
| mid vs mid | 6,878 | 32 | 92% | **1.90** | **≈700** |
| jungle vs jungle | 3,379 | 142 | 84% | 1.33 | ≈1,420 |
| bot vs bot | 2,686 | 46 | 86% | 1.31 | ≈1,460 |
| bot vs support (enemy 2v2 lane) | 6,687 | 46 | 87% | 1.28 | ≈1,540 |
| support vs support | 4,301 | 40 | 90% | 1.23 | ≈1,660 |
| jungle vs mid / support / bot / top | 6.1k–10.8k | 61–76 | 85–90% | 1.04 / 0.95 / 0.90 / 0.80 | ≈2,300 / 2,760 / 3,060 / 3,880 |
| mid vs bot / support; top vs mid / bot / support | 8.5k–15.2k | 34–42 | 89–92% | 0.77 / 0.77 / 0.75 / 0.64 / 0.59 | ≈4,200–7,100 |

| Duo (synergy) type | τ (pp) | **k** |
|---|---|---|
| bot + support | **1.19** | **≈1,770** |
| jungle + mid | 0.70 | ≈5,060 |
| mid + bot | 0.57 | ≈7,660 |
| jungle + bot | 0.52 | ≈9,200 |
| top + jungle / top + bot / jungle + support / mid + support / top + mid / top + support | 0–0.37 | ≈18k to ∞ (treat as ≈0) |

Reading the table:
- **Lane matchups are the only large interactions**, especially top and mid.
- The enemy bot-vs-support pair behaves like a lane pair (2v2 bot lane).
- **Jungle interacts with everyone** more than other cross-map pairs do.
- Most duo types are close to zero.
- Examples after shrinkage (pairs with at least 300 games):
  - 19% of top-lane and 17% of mid-lane pairs have |δ| ≥ 2 pp; only 1–2% have |δ| ≥ 4 pp.
  - Jungle, bot and support lanes: 2–4% have |δ| ≥ 2 pp.
  - Largest: Gwen vs Dr. Mundo +5.8 pp; Nasus vs Zed (mid) +4.8 pp; Rell vs Nautilus +3.6 pp; Ezreal + Yuumi −4.9 pp.

**Which part of the score varies most.** Simulation over 3,000 random drafts, champions sampled by play rate; SD of each score component in pp:

| Prior | Base | Lane | Cross-lane | Duos | Total | Implied accuracy if calibrated |
|---|---|---|---|---|---|---|
| DraftGap K=1000 everywhere | 4.7 | 2.6 | **4.2** | **3.4** | 7.9 | 56.2% |
| EB k per role pair | 4.7 | 2.7 | 2.6 | 1.6 | 6.3 | **55.0%** |

- DraftGap's cross-lane and duo components are inflated by noise that is not shrunk enough.
- ≈55% implied accuracy matches draft-only models reported elsewhere (LoLDraftAI 56–57% [SNIP]; academic and student projects ≈52–54% [3P]).
- Pairs that occur in realistic drafts have a median of ≈2,200 games (p10 ≈ 260). **28% have fewer than 1,000 games.**

**Recommendation sensitivity** (300 last-pick scenarios):
- **Top-1 pick is the same under DraftGap K and EB k in only 44% of cases**; mean top-5 overlap is 62%.
- Median gap between #1 and #10 candidates is 2.4 pp (4.7 pp between #1 and the median candidate).
- Posterior SD of a candidate's interaction sum is ≈**2.1 pp**.
- Median P(#1 truly better than #2) is **0.58**; the median number of candidates within 1 pp of #1 is 2.
- **Conclusion:** present tiers and uncertainty, not a single "best pick".

**Patch drift of base win rates** (current patch vs the rest of the 30-day window):
- Average true SD is only ≈0.32 pp (k ≈ 25k), but the tail is heavy.
- Examples: Ryze mid −2.7 pp (z = −4.5), Nocturne jungle −2.3 pp, Vi jungle −1.8 pp.
- |z| > 3 occurs in 0.7% of champion-roles, vs 0.27% expected under no change.
- So the base prior should be strong for unchanged champions and weak for champions changed this patch (§3.13).

*Caveats:*
- The data is lolalytics-derived, D2+ only; Emerald+ would have several times more games (unverified).
- Averaging the two perspectives approximates a single sample.
- τ may include structural artefacts from rank mix, but those also affect prediction.
- Reliability is computed on the win-rate scale near 50%.
- This dataset is a **research sample only**: it is scraped from lolalytics, so its licence is unclear. Do not ship it.

### 3.6 Confidence intervals

- **Raw pair win rate:** Wilson score interval. For n = 3,244 at 55.5%, the 95% interval is [53.8, 57.2].
- **Shrunk delta:** posterior SD = `sqrt(τ_t²·k_t/(n+k_t))`, e.g. ±0.8 pp for Malphite vs Irelia.
- **Candidate or team score:** SD = sqrt of the sum of term variances. Terms are about independent across different pairs, but a shared model error exists, so pad the interval (×1.2) or calibrate it (§3.14).
- Sample-size reference table:

  | n | ±95% CI (p≈0.5) | Delta size d | n for 80% power to detect ±d |
  |---|---|---|---|
  | 100 | ±9.8 pp | 5 pp | 785 |
  | 1,000 | ±3.1 pp | 3 pp | 2,180 |
  | 3,000 | ±1.8 pp | 2 pp | 4,906 |
  | 10,000 | ±1.0 pp | 1 pp | 19,625 |

- With EB k, a pair needs **n ≈ k games for 50% weight and n ≈ 4k games for 80% weight**:
  - Top/mid lanes: about 570 / 2,300.
  - Other lanes: about 1,500 / 6,000.
  - Jungle cross pairs: about 3,000 / 12,000.

### 3.7 Lane vs whole-team matchups

Keep all 25 cross-team pairs, but with **role-pair-specific k**. That shrinks cross-map pairs hard automatically. In the UI, group the terms as:
- **Lane**: same role, plus our bot vs their support and our support vs their bot.
- **Jungle**: our jungler vs everyone, and everyone vs their jungler.
- **Other**.

Evidence for this grouping: jungle cross pairs have τ of 0.8–1.0 pp vs 0.6–0.8 pp for other cross-map pairs (§3.5).

### 3.8 Flex picks and unknown enemy roles

- `P(assignment) ∝ Π_i s_{c_i}(r_i)`, where s is the champion's role share. Use current-patch shares shrunk toward 30-day shares. Assignments must be distinct and must not use roles already locked.
- **Score the expectation** `E[S] = Σ_π P(π)·S(π)`. That is at most 120 assignments per team, which is cheap.
- Show role chips (probability ≥ 5%) and allow click-to-lock, as DraftGap does.
- Show the lane-opponent probability, e.g., "Your lane opponent: Irelia 94% / Pantheon 6%".
- Pick-slot role priors are not available from Match-V5; bans carry `pickTurn` but picks do not [BK, unverified]. Use role shares only.

### 3.9 Bans

- Remove banned champions from the candidates and from enemy pick distributions (renormalise q).
- **Ban value** of champion B, from our side: `BV(B) = q_B^enemy × H(B)`.
  - `q_B` is the probability the enemy picks B given it is available, approximated as B's pick rate per team, renormalised over champions still available.
  - `H(B)` is the expected harm: `(β_B − logit 0.5)` plus Σ over our locked or hovered allies u of `P(roles) · (−δ^vs_{u,B})`.
- **"Protect my pick"** list, for my intended champion x: rank B by `q_B,lane(x) × max(0, −δ^vs_{x,B})` and show the games count. Example: Vayne top → ban Malphite (−6.8 ± 1.1 pp in lane, 1,514 games).
- Show the global ban rate as context. Ranked solo/duo bans are simultaneous (LCU action type `ten_bans_reveal`) [SRC LCU types], so ally intents (`championPickIntent`) are the only draft information available during bans [BK for the simultaneity].

### 3.10 Pick order: blind picks vs counterpicks

- If the lane opponent is still unrevealed, the expected lane delta over the natural opponent distribution is ≈0 by construction, because the base win rate already averages over opponents. **Report risk separately rather than folding it into the mean.**
- **Counter exposure** = the worst shrunk lane delta among the enemy's N most-played available options for that role (N = 10–15). Examples [DATA]:

  | Role | Most exposed | Safest |
  |---|---|---|
  | Top | Vayne −7.0 pp (vs Malphite), Dr. Mundo −5.6 pp, Irelia −5.6 pp | Shen −0.9, Kled −1.2, Illaoi −1.5 |
  | Mid | Aurelion Sol −5.3 (vs Yone), Katarina −4.8, Xerath −4.7 | Qiyana −1.0, Aurora −1.1, Ahri −1.3 |

- Alternative for a "Safe" sort (a transparent "Typical Counterpick Adjusted"): a softmin expectation `Σ_B q_B·w_B·δ_xB / Σ q_B·w_B` with `w_B = exp(−λ·δ_xB)`.
- Solo-queue order is B1 · R1 R2 · B2 B3 · R3 R4 · B4 B5 · R5 [BK]. Early slots should weight blind safety; late slots are pure counterpicks.
- **Flex value** (stats-only): a pick with high role entropy hides the lane from the enemy. Show it as a badge.

### 3.11 Team composition statistics (stats-only)

- **Damage split:**
  - DraftGap uses lolalytics per-champion-role average damage by type (`damageProfile`: physical / magic / true) and sums it across the team.
  - Our own version: per champion-role means of Match-V5 fields `physicalDamageDealtToChampions`, `magicDamageDealtToChampions` and `trueDamageDealtToChampions` [BK field names; verify].
- **CC / frontline / peel proxies** (averages per champion-role; label them literally, e.g. "CC time", not "engage"):
  - `timeCCingOthers` (CC)
  - `totalDamageTaken` + `damageSelfMitigated` (frontline)
  - `totalHealsOnTeammates` + `totalDamageShieldedOnTeammates` (peel)
  - challenge fields such as `enemyChampionImmobilizations` and `effectiveHealAndShielding` [BK; verify]
- Other tools use hand-labelled tags (ProComps [3P]) or Meraki/CommunityDragon static metadata (AirMile/draftgap [SRC]). Those are opinions; avoid them or show them as "Riot/Meraki labels".
- **Scaling:** sum the per-time-bucket deltas (as DraftGap does) and show a win-rate-by-game-length curve.
- **Warnings only where the data supports them:** compute empirical curves (e.g., team win rate by magic-damage-share decile) from game-level data before showing "too much AD" warnings. **To compute; not available here.**

### 3.12 Player comfort (stats-only, local player only)

- **Inputs:**
  - The user's own games on the champion-role: LCU `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex&endIndex` [SRC in many clients], or Match-V5 by PUUID.
  - Mastery: `/lol-champion-mastery/v1/local-player/champion-mastery` [SRC usage in clients].
  - Recency.
- **Model:**
  - `c = logit((w_me + k_p·p_ref)/(n_me + k_p)) − logit(p_ref)`, where `p_ref` is the champion's global win rate, optionally plus an **experience curve** g(games played) estimated from population data.
  - `k_p = 0.25/τ_p²`. **Assumption:** τ_p ≈ 5 pp gives k_p ≈ 100 games. Estimate τ_p from the spread of player-champion win rates vs binomial noise.
  - Personal samples are tiny: 50 games gives ±14 pp.
- **Display:** as its own row ("You: 41 games, 56%, weight 29%"), with a toggle to include it in the score. Also use it as a **pool filter** (e.g., at least 5 games in the last 90 days).
- Treat mastery points as an experience-bucket proxy only once calibrated. **Never use teammates' identities** (anonymity policy).

### 3.13 Patch-aware base prior

- `p_base = (w_patch + k_b·p_prev)/(g_patch + k_b)`, where p_prev is the previous-window win rate.
- Use **k_b ≈ 20k for unchanged champions** and **k_b ≈ 1–2k for champions named in the patch notes** or showing a significant drift (|z| > 3).
- New champion: no prior window. Use a release-week prior from past releases (**to compute**), with all deltas at 0 until data arrives, and a "new champion — limited data" banner.
- Off-meta role: centre the prior at ≈47% (§3.5 pooled off-role WR) instead of 50%.

### 3.14 Calibration and validation

- **Backtest** on held-out Match-V5 games: log loss, Brier score and reliability diagram for base-only vs base+lane vs the full model. Also realised win rate by top-K bucket (Winrate.gg-style; beware selection effects).
- **Journal in production:** with opt-in, record (predicted P, outcome, model version), as wApMorty's SPEC-05 does. Refit a global temperature T with `P = σ(S/T)` each patch, which corrects overconfidence. Re-estimate τ_t at every data refresh.

---

## 4. Proposed design for our stats-only draft helper

### 4.1 Model specification (v1: aggregate tables plus empirical Bayes, no training)

```
Inputs per refresh (bracket = Emerald+ by default, queue 420; window = current patch + 30 days):
  base(c,r): g,w ;  matchup(c1,r1,c2,r2): n,w ;  duo(c1,r1,c2,r2): n,w ;  role shares ; pick/ban rates
Precompute:
  β(c,r)  = logit( (w_patch + k_b·p_prev)/(g_patch + k_b) )       k_b patch-aware (§3.13); off-role prior centre ≈47%
  τ_t, k_t per pair type t (15 matchup types + 10 duo types) via DerSimonian–Laird (§3.4); cap k_t ≤ 20,000
Per draft state (recomputed on every LCU session change, ≤500 ms polling or websocket):
  for each enemy role assignment π (weight P(π)), each candidate x in my role (x not picked/banned; owned/pool filters):
    e_xy = σ(β_x ∓ β_y) ; p̃ = (w_xy + k_t e_xy)/(n_xy + k_t) ; δ_xy = logit(p̃) − logit(e_xy) ; v_xy = τ_t² k_t/(n_xy+k_t)
    S(x) = S_known + β_x + Σ_enemy δ^vs_xy + Σ_ally δ^syn_xy  (+ c_x if comfort toggle on)
  E[S(x)] = Σ_π P(π) S_π(x) ; SD(x) = sqrt(Σ v) ; show P = σ(E[S]/T) ± SD
Extras: counter exposure (§3.10), ban values (§3.9), flex entropy, composition panel (§3.11)
Ranking: default by E[S]; "Safe" toggle ranks by P10 = E[S] − 1.28·SD (risk preference separate from the prior)
```

Compute cost: at most about 170 candidates × (1 + 5 + 4) terms × up to 120 role assignments, which is well under 50 ms in JS/TS.

### 4.2 What is shown at each draft stage

LCU fields [SRC]: `timer.phase` (PLANNING / BAN_PICK / FINALIZATION), `actions[]` (type pick/ban/`ten_bans_reveal`, `isInProgress`, `completed`, `actorCellId`), `myTeam[].assignedPosition`, `myTeam[].championPickIntent`, `theirTeam[].championId`, `localPlayerCellId`.

| Stage | Known information | We compute | We show |
|---|---|---|---|
| **Before any pick: planning / intent** | My assigned role; ally roles and intents; nothing about the enemy | Blind score = β plus the pool; counter exposure; flex value | "Your pool for TOP": list with blind WR ± SD, **counter-risk badge** ("worst likely: Malphite −6.8"), pool games/WR; best meta picks outside the pool, collapsed |
| **Ban phase** (simultaneous) | Same, plus ally intents | Ban value q×H (§3.9); "protect my pick" list; team-aware threats vs ally intents | Three short lists: *Protect your pick*, *Meta threats*, *Vs your team*. Each row shows ban rate and games. Recompute when an intent changes; after reveal, grey out banned champions everywhere |
| **Picks, before any enemy pick in my lane** | Some locked allies/enemies; hovers | Known terms + E over enemy role assignments; counter exposure for my lane | Live list with team WR if picked, **Δ vs current**, top reason chips ("w/ Yuumi +4.1 (10k)"), **tiers within noise**, counter-risk badge |
| **After enemy picks** | Enemy champions; roles probabilistic | Update role probabilities; lane delta weighted by P(lane opponent) | Role chips on enemy portraits (click to lock); "Lane opponent: Irelia 94%"; list re-ranks with a **what-changed highlight** (e.g., "↑ Malphite +4.3: Irelia locked") |
| **My hover** (`championPickIntent`) | Candidate chosen | Full breakdown and comparison vs #1 and vs my best pool pick | Hovered champion pinned at top with waterfall (§4.3); "within noise of #1" or "−2.8 pp vs #1 (P = 0.9)" |
| **Ally hovers** | Their intents | Optionally counted as picks (toggle, as DraftGap does) | Synergy preview for my candidates |
| **Finalization / trades** | Full teams; possible swaps | Recompute with final roles | Team vs team: P ± SD for both sides; contribution table; damage split bar; scaling curve; lane cards (my lane delta with n) |
| **Post-game** | Outcome | Journal (P, outcome) | Optional personal calibration: "drafts we rated 55% won 54% (n = 120)" |

### 4.3 Explanation ("why this pick")

Each row is: term, delta in pp, evidence (games, observed vs expected, weight kept = n/(n+k)), and a mark when the evidence is low. The lane row below uses real numbers [DATA]; the other rows are illustrative.

```
Malphite · TOP                        team 54.6% ± 2.0     Δ +3.1 pp vs current (no top)
──────────────────────────────────────────────────────────────────────────────
Base   Malphite top · 127k games              +0.9  (51.0% WR, patch-adjusted)
Lane   vs Irelia (top 94%) · 3,244 games      +4.3  obs 55.5% · exp 50.4% · kept 85%  ✓
Jungle vs Lee Sin · 6.0k games                +0.2  kept 72%
Other  3 cross-map pairs · 8.1k games         −0.4  ▸ expand
Duos   with 4 allies · 11k games              +0.3  ▸ expand (bot+sup rows only matter)
You    41 games · 56% · kept 29%              +0.8  [include comfort ☐]
Risk   lane opponent locked → none | flex: low
Data   Emerald+ · 16.19 + 30d · 1.9M games · updated 3 h ago
```

- **Compare mode:** show two champions side by side row by row ("Why Malphite over Gwen?").
- **Low evidence:** grey the value when kept < 30% and show "mostly prior".
- **No raw log-odds anywhere.** Show pp around 50% and the observed win rate with n.
- Keep DraftGap's "model vs observed win rate vs games" split (Winrate Decomposition) as the drill-down.

### 4.4 Presenting rankings honestly

- **Tiers:** group consecutive candidates whose difference from the tier head is below about 1 SD. Label a tier "statistically tied".
- Show ± on the score. The "Safe" toggle ranks by the lower bound (§4.1). Allow sorting by blind score, counter risk and comfort.
- Keep DraftGap's placement options (banned / unowned: bottom / in place / hidden; favourites at top) and the owned-champion filter from the LCU inventory.

### 4.5 Edge cases

| Case | Handling |
|---|---|
| Low sample pair | Always shrink; hide raw WR when n < 30; "low evidence" when kept < 30% |
| New champion | Release-week prior (compute from history); deltas 0 until n > 0; banner |
| Off-meta role (e.g., role share < 5%) | Prior centre ≈47%; exclude from suggestions unless in the user's pool (DraftGap's min-games filter: default 1000 per 7 days) |
| Patch day | Patch-aware k_b (§3.13); flag champions with drift |
| Flex/unknown roles | Expectation over assignments; chips; manual lock |
| Role swap or trade after picks | Recompute on `assignedPosition` / trade events; manual override |
| Hover-only allies | Toggle; mark as "hover" |
| Autofilled user (small pool) | Default to "Safe" sort; lower weight on comfort |
| Queue differences (Flex 440, Normal Draft 400) | Use queue-specific tables if available; otherwise show a banner that data is solo/duo |
| LCU unavailable / manual mode | Web-style manual draft input, as DraftGap and METAsrc do |
| Anonymised ranked champ select | Never try to identify other players; comfort for the local player only |

### 4.6 Data tables needed

| Table | Key | Fields | Notes and size (from the D2+ 30-day snapshot) [DATA] |
|---|---|---|---|
| `champion_role_base` | window, patch, bracket, queue, champ, role | games, wins, pick rate, ban rate; damage_phys / magic / true; time-bucket games/wins (5 buckets); optional side split | 865 rows per window |
| `matchup` | window, bracket, queue, champA, roleA, champB, roleB | games, winsA (both perspectives if the source is perspective-based) | 417k directional rows |
| `duo` | window, bracket, queue, champA, roleA, champB, roleB | games, wins | 339k directional rows (matchup + duo together: ~264k rows with ≥30 games) |
| `pair_type_params` | window, bracket, type (25) | τ, k, K pairs, date | Refit each refresh |
| `role_shares` | patch, champ | share per role | Derivable from base |
| `patch_changes` | patch, champ | changed flag (patch notes) or drift z | Optional |
| `player_champion` (local only) | puuid, champ, role, queue | games, wins, last played, mastery points/level | From LCU / Match-V5 |
| `experience_curve` (optional) | champ or class, games-played bucket | games, wins | Population curve for comfort |
| `dataset_meta` | — | window dates, total games, rank-bias offset, source, version | For the UI data badge |

- **Download size:** the compact pairwise table (CSV) is 15.7 MB raw / **3.9 MB gzip**, or **1.8 MB gzip** when trimmed to rows with at least 30 games. That is fine for a daily delta download.
- **Refresh:** 30-day pairwise tables daily; current-patch base every 6–12 h; τ refit at each refresh.
- **Sample-size targets:**
  - A window of about 2M matches (≈ our D2+ 30-day volume) gives a median of about 2.2k games per pair that occurs in realistic drafts. That is ≈75–80% reliability for top/mid lanes, ≈55–60% for other lanes and ≈35–50% for jungle cross pairs.
  - At 1M matches the median is about 1.1k games (≈65% reliability for top, ≈45% for jungle lanes; assumes pair counts scale linearly with volume).
  - Base win rates are stable (±1 pp) at 10k games per champion-role.
- **Source options:**
  1. Own Match-V5 pipeline for Emerald+: needs a production key and a large crawl; roles from `teamPosition` [BK].
  2. License aggregates from a stats provider.
  3. Scraping lolalytics / U.GG / OP.GG internal APIs (as DraftGap and many open-source clients do). **This carries ToS and legal risk.**

### 4.7 Open questions

- Verify the commercial tools' in-draft behaviour (§1.4), especially DPM's Sept 2026 "Draft Helper".
- Estimate τ_p for comfort, the experience curve, and composition-warning curves from game-level data.
- Decide the bracket: Emerald+ gives more games; the user's own tier fits better but has fewer games. A hierarchical option is to shrink tier-specific deltas toward all-elo deltas.
- Confirm current Riot policy wording and LCU endpoint stability.

---

## 5. Sources

**Read directly (GitHub) [SRC]**
- DraftGap repository: https://github.com/vigovlugt/draftgap. Releases: /releases (v3.2.1, 2026-02-01). Commits: /commits/main (latest 2026-08-30). Issue #5: /issues/5.
- DraftGap core files, under `https://raw.githubusercontent.com/vigovlugt/draftgap/main/packages/core/src/…`: `draft/analysis.ts`, `draft/suggestions.ts`, `draft/utils.ts`, `draft/extra-analysis.ts`, `rating/ratings.ts`, `risk/risk-level.ts`, `role/role-predictor.ts`, `statistics/stats.ts` (Wilson CI helper), `stats.ts`, `damage-distribution/damage-distribution.ts`, `models/Role.ts`, `models/dataset/Dataset.ts`, `models/dataset/ChampionRoleData.ts`, `models/dataset/ChampionDamageProfile.ts`.
- DraftGap data pipeline: `apps/dataset/src/index.ts`, `apps/dataset/src/lolalytics/{index,qwik,qwik-champion2,champion2,roles}.ts`, `.github/workflows/dataset.yml`.
- DraftGap frontend: `apps/frontend/src/contexts/{DraftAnalysisContext,DraftSuggestionsContext,UserContext,LolClientContext}.tsx`, `components/dialogs/{FAQDialog,SettingsDialog,WinrateDecompositionDialog,ChampionDraftAnalysisDialog}.tsx`, `components/draft/{DraftTable,TeamSidebar,Pick,FilterMenu,AnalyzeHoverToggle}.tsx`, `components/views/analysis/{AnalysisView,TotalChampionContributionTable,MatchupResultTable,ScalingChart,SummaryCards}.tsx`, `components/common/RatingText.tsx`, `utils/rating.ts`.
- draftgap-plus: https://github.com/HuyTheSkeleton/draftgap-plus
- AirMile/draftgap: https://github.com/AirMile/draftgap
- draftgap-daten dataset: https://github.com/chimera-alex/draftgap-daten, workflow `.github/workflows/datensatz.yml`, release assets `https://github.com/chimera-alex/draftgap-daten/releases/download/v5-2026-09-27/{30-days.json.gz,current-patch.json.gz,extra.json.gz,manifest.json}`
- LoLDraftAI public monorepo: https://github.com/Looyyd/loldraftai-monorepo-public (README, `apps/machine-learning/README.md`, `apps/desktop`)
- hextech-studies: https://github.com/githubpsyche/hextech-studies (README, `projects/counterpick-coverage/build.py`)
- Lolalytics counter API shape: https://github.com/Desstroct/LoL-Companion/blob/main/src/services/champion-stats.ts
- LeagueStats SPEC-05: https://github.com/wApMorty/LeagueStats (`docs/archive/specs/SPEC-05-modele-scoring.md`)
- lol-best-picker research: https://github.com/andresldoi95/lol-best-picker (`specs/002-team-composition-recs/research.md`)
- deltadraft: https://github.com/Lydig/deltadraft
- U.GG matchups client code: https://github.com/aovoq/lol-overlay (`crates/provider-ugg/src/types/matchups.rs`); https://github.com/kade-robertson/uggo
- GitHub code-search hits used for API shapes and LCU fields: LeagueAkari/LeagueAkari, WJZ-P/sona, imperasus/sylqon, marcosGcostell/LoL-drafting-tools, SmoovePy/lol_coachV2, orlovigoor-prog/sensei-gg.

**Third-party documents on GitHub, 2026 [3P]**
- https://github.com/LINDECKER-Charles/LeagueOfDataBaseFinal/blob/main/docs/produit/analyse-concurrentielle.md (2026-07-17)
- https://github.com/Kuderic/RabadonGG/blob/main/docs/research/competitive-analysis.md (June 2026)
- https://github.com/JonathanPegaz/coach-diff/blob/main/docs/LoL-Coach-Analyse-Marche.md
- https://github.com/niftymonkey/champ-sage/blob/main/docs/research/augment-detection-research.md and `AGENTS.md`
- https://github.com/stewdeveloper/diana/blob/main/docs/new-design.md
- https://github.com/socram03/shorewire (`docs/riot-policy.md`)
- https://github.com/intendednull/bad-apple-brawl/blob/main/docs/reports/research/draft-tools.md
- https://github.com/SamuelReinaldoRamirez/datascientest-lol-draft_analyzer

**Search-result snippets, vendor claims, pages not opened [SNIP]**
- https://loldraftai.com/ · https://loldraftai.com/draft · https://loldraftai.com/blog/champion-recommendation-showcase
- https://winrate.gg/articles/draft-recommendation-benchmark · https://winrate.gg/tools/draft
- https://www.itero.gg/ · https://www.itero.gg/articles/the-draft-model · https://www.itero.gg/articles/draft-sq · https://www.itero.gg/articles/overwolf · https://www.itero.gg/drafting-simulator · https://www.itero.gg/champion-pool-builder · https://www.overwolf.com/app/itero_gaming-itero_drafting_coach
- https://www.smartpick.gg/ · https://www.lol-brain.com/draft · https://draftlol.ai/champions/draft-simulator · https://www.overwolf.com/app/samuel_blad-champ_select_coach · https://procomps.gg/ · https://meeko.ai/ · https://draftgap.com/ · https://devpost.com/software/draftgenius-ai · https://github.com/VRichardJP/LoLAnalyzer
- Method credited by DraftGap (not viewed): https://www.youtube.com/@Jayensee, https://www.youtube.com/watch?v=YQkWmysNBt8
- Riot policies (cited by third parties; not fetched): https://developer.riotgames.com/policies/general

**Standard statistical references (not fetched)**
- Bradley & Terry (1952), *Biometrika*: paired comparisons.
- Elo (1978): *The Rating of Chessplayers*.
- Efron & Morris (1975), *JASA*: Stein estimation.
- DerSimonian & Laird (1986), *Controlled Clinical Trials*: random-effects τ².
- Wilson (1927); Agresti & Coull (1998): binomial intervals.
- D. Robinson, *Introduction to Empirical Bayes* (2017).
- E. Miller, "How Not To Sort By Average Rating" (2009).
- Conley & Perry (2013), Stanford CS229: Dota 2 hero recommendation with synergy/counter features.

---

## Appendix: reproducing the analysis

- Scripts (pure Python 3, no numpy), in `/tmp/claude-0/-home-user-MVP/3f62bdd7-a287-5d6e-bd31-40a3525db360/scratchpad/`:
  - `analyze.py`: τ and k by pair type, shrinkage table, random-draft simulation. Writes `eb_results.json`.
  - `analyze2.py`: sensitivity to the games threshold, examples, counter exposure, role shares.
  - `analyze3.py`: patch drift, implied accuracy, prior sensitivity of last-pick recommendations.
  - `analyze4.py`: posterior SD of candidate scores and P(#1 > #2).
- Outputs: `analysis_out.txt`, `analysis2_out.txt`, `analysis3_out.txt`.
- Data: `scratchpad/data/` (sha256 matches the release manifest).
- The dataset is used only for research estimation. Its source (lolalytics scraping) has an unclear licence; do not redistribute or ship it.
