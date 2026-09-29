# Decisions

Short log of product/architecture decisions. Newest last.

## 2026-09-27 — Checkpoint 1 (owner)
- **Stack: Tauri 2 + Rust core**, UI rendered by the system WebView2. Rejected: Electron/Overwolf
  (weight), fully native Rust UI (slower to reach the target polish; weaker test/screenshot tooling;
  harder web version). Budgets and an idle-CPU test keep the webview honest.
- **Audience: public and free.** Implies Riot product registration + production key, signed
  installer, auto-update, privacy policy; strict policy compliance (docs/policy.md).
- **Stats: our own backend** crawling the Riot API and publishing per-patch aggregates.
  No scraping of other stat sites.
- **Region: EUW first.** Other regions once the pipeline is proven.

## 2026-09-27 — Implementation choices (Claude)
- UI: **SolidJS** (fine-grained reactivity, ~7 KB runtime) + TypeScript + CSS modules + design
  tokens; hash router; Inter variable font (Latin subsets only).
- Shared types: Rust `domain` crate → TypeScript via ts-rs (single source of truth).
- UI talks to the core only through `Transport` (Tauri IPC / mock scenarios / future HTTP for web).
- Quality gates in `scripts/check.mjs`, run by CI, locally and by a Claude Code Stop hook.
- Working name **Scout** (placeholder; Riot forbids "League"/"LoL"/champion names in product names).

## 2026-09-27 — Checkpoint 2 (owner)
Full triage lives in the checkpoint page; the owner's calls that shape the roadmap:
- **UI first, always.** No new feature ships until the existing screens look polished and
  balanced; every feature must fit the UI without bloating it. Design work ≥ feature work.
- **Look:** dpm.lol-like dark UI with a **pastel** palette. An ambient background that takes the
  colors of what is shown (champion art), computed once and static — smooth on every machine.
- **Live screens don't scroll** (champ select, live game); histories may.
- **Name: MVP** (replaces the "Scout" placeholder). New logo later.
- Scouting on the **loading screen**; player cards: rank, champion experience, recent results,
  neutral/positive tags only (no "first time" tag). Own per-game grade: yes.
- Draft: global stats + the player's pool (pool-first, using **mastery**, not only recent games);
  shows picks, comp analysis and enemy roles. **No ban suggestions.**
- Automations: runes (click and auto), item sets, spells (Flash side safe, never swapped last
  second, can be disabled), auto-accept off by default.
- In game: a view with the build and skill order (no overlay).
- Stats: **Emerald+**, current patch with fallback to previous; modes: Ranked + **ARAM**.
- Player search by Riot ID in v1: a fast, stable search bar (no result swapping under Enter,
  no layout jumps).
- Windows only; **English + French**; auto-update; opt-in crash reports.
- Backend hosting: a VPS + Cloudflare R2 for the published aggregates.
- Not now: recording/clips, overlay, ban suggestions, premium, social features.

## 2026-09-27 — Backend platform services (Claude)
- **Updates from our backend, installers on GitHub Releases.** `GET /v1/updates/…` speaks the
  Tauri v2 updater format from a `releases.json` edited by an admin CLI (no web admin). Staged
  rollouts bucket installs by `SHA-256(install id, version)` (stable answers, monotonic when
  widened). **No downgrades:** a blocked release stops spreading and its installs are moved by
  the next fix, which skips the rollout for them and is flagged mandatory.
- **Remote config** (feature flags, kill switches, min version, banners) is a validated JSON file
  re-read on change (mtime check on request, no watcher, no polling), served with an ETag.
- **Crash reports:** opt-in, scrubbed server-side, no IP stored, 30-day retention, erasable per
  install id.
- A **random install id** (`X-MVP-Install`) keys rate limits, rollouts and GDPR deletion; it is
  not linked to the Riot account.
- Riot caches persist as a **JSON snapshot on shutdown**, not a database (bounded, tens of MB).

## 2026-09-28 — Liquid glass (owner asked, Claude designed)
Owner: "real optic effects, like iOS, real distortion", running at 120 fps easily, never a
burden, not abusive. Design calls:
- **Glass is for the layer that floats over content** (title bar, search results, toasts, the
  rail's selection, controls being touched), like Apple's guidance. Content cards stay calm:
  a crisp rim of light and a soft thick-glass edge drawn by the backdrop shader, no lensing of
  their text.
- **Real refraction from real optics**, not a blur with a gradient: Snell's law through a curved
  bezel, Fresnel on the rim, a hair of colour split only where light bends most (never over
  labels). One optics model for both the SVG lenses over the page and the WebGL card glass.
- **The page scrolls under the title bar** so its glass has something to bend.
- **Motion only when the player acts**: springs (compositor-only) for the rail lens and switches;
  nothing moves at rest; reduced motion jumps.
- **Budget first**: lenses are GPU filters with maps computed once; only on machines where the
  WebGL backdrop is cheap ("Full"). "Light" (plain blur) and "Off" (flat) are one click away in
  Settings, saved by the core.
- The hex mosaic in the backdrop is dropped: in screenshots it read as compression blocks.

## 2026-09-28 — Refraction you can see (owner asked, Claude designed)
Owner: more visible distortion on the sides, real distortion that differs by shape, bent
background widgets visible through the glass, precise and clearly optical, icons and text
respected. Design calls:
- **Glass floats**: the optics model the gap between the glass and the page (its elevation),
  where most of a real floating pane's bend comes from. Rims now bend 10–40 px instead of < 10,
  and drops are loupes (parabolic, ≈ ×1.3, even) instead of barely-there domes.
- **Clear where it bends**: tint eases in across the bezel (none at the rim), frost is 1–3 px,
  so what is behind shows, bent, along every rim; text-heavy panes keep a deep middle.
- **Light from the surface**: rim light computed from the same normals (brighter where the rim
  faces the top-left light, a third of it opposite), not a painted gradient only.
- **Text first**: drops sit behind labels at rest and lift over them only while gliding. Bars
  and panels whose labels sit over moving content (title bar, tab bar, search, toasts) frost
  their middle and keep the rim sharp and bent (design review: text behind the tab labels read
  almost sharp).
- Maps at screen density (up to 2×) for a precise bend; a glass lab in the dev server to see
  every shape bend detailed content.

## 2026-09-28 — Glass you see through (owner asked, Claude tuned)
Owner, on the real app (Windows, RTX 3070): "on ne voit pas assez la distortion, trop de blur, il
faudrait un gradient plus doux". Design calls:
- **Less frost, more bend**: the title bar's middle frost 12 → 4 px (rail, tab bar, panels 6 px),
  its bend stronger (thicker, higher glass); rims narrow enough to stay under the labels
  (bar 14, dock 12, panels 14 px), the design review's call after a first try at 18–22 px put the
  frost ramp on the search field and the tab labels.
- **A soft gradient**: the frost and the tint ease in across the bezel (a gamma on the thickness)
  instead of starting a few pixels from the rim.
- **No mirrored text**: a 1 px pre-blur at every rim (0.5 px over art); at 0 the band at the rim
  showed text upside down in toasts and search, and a bent badge faked a tab indicator.
- **Full means Full**: the default follows Windows' "Transparency effects" switch (off → Light,
  and Settings says why); a Full the player picks wins over it. On the owner's PC the switch was
  off, so the glass never showed.
- **Smooth refraction** (owner: "you can see lines in refraction"): rims are parabolic, not
  squircles. A squircle's bend jumped 20–28 px between two pixel rows at the rim, cutting what is
  behind into bands; a parabola bends as clearly (12–21 px) but at most ~2.5 px per row.
- **Drops are evenly tinted glass** (owner: the rail's animation "isn't great… how big the icon
  gets and shrinks, pixelated", "the same everywhere", "double contouring", then "it seems like
  it's 2 bubbles… the glass being fully colored, but slightly… all glass buttons… not smooth enough
  borders, put effort into it"): the selection on the rail, segmented controls and choices, and a
  held switch's knob are one CSS material (`.glass-drop`): an even light tint (the accent for a
  choice), a soft sheen over the upper half, and a 1 px rim drawn with inset shadows (anti-aliased
  on every curve), brighter along the top. They glide behind the labels, never lifted, never
  scaled on the way (a held knob swells ≈1.2×). No SVG lens on them: the loupe enlarged icons
  through a displacement filter that doesn't smooth, swelled and shrank them, drew the track's
  border again inside the thumb; tinted by thickness it read as a ring around a coloured middle;
  and its backdrop filter settled a pixel off after each glide.

## 2026-09-28 — Rank emblems (owner asked, Claude designed)
Owner: rank icons "look old/fake". Design calls:
- **Riot's own emblems** where a player's rank shows (Home, Live cards): the League client's art,
  downloaded by the core at run time from `CommunityDragon`'s mirror of the client's files,
  cropped to the crest and cached on disk. Never in the repository (like Data Dragon icons).
- **Our own crest until then** (first start offline, a download that fails): a metal shield with a
  bevel and a cut gem in the tier's colour, with ornaments that grow with the tier as in the
  client (crowns, blades, then wings), in the same 4:3 box so nothing moves when the art arrives.
  The old flat hexagon is gone.

## 2026-09-28 — Scouting identity, app side of updates/config/reports (Claude)
- **Scouting names players by Riot ID.** Client PUUIDs aren't our API key's (Riot encrypts
  PUUIDs per key), so they never leave the core; the backend resolves Riot IDs with account-v1
  and cards are matched back by Riot ID, case-insensitively. The PUUID form stays for 0.1.0 apps.
- **The core drives updates** (the webview has no updater permission): the policy is a pure,
  tested `UpdatePlan`; nothing downloads or installs during a ready check, champ select or game;
  the player restarts into an update, or it installs on quit without reopening MVP. The public
  key lives in one place, `tauri.conf.json` `plugins.updater.pubkey`; without it a build doesn't
  update itself and the release workflow refuses to build.
- **Remote config is kept on disk** so kill switches hold offline and from the first second of
  the next start; kill switches only ever turn things off. Banners gained `dismissible`.
- **Crash reports are scrubbed in the app too**, with the server's rules (`crates/scrub`);
  panics are saved by the hook (release builds abort) and sent at the next start.
- **Notices load lazily**: the banners, update prompt and update-required card cost nothing at
  first paint; banner links open through the core by banner id, never from a URL the UI gives.

## 2026-09-28 — Champion list: sorting and categories (owner asked, Claude designed)
Owner: "Champs is a huge list, a bit hard to read, we need better sorting and categorizing. Keep
it very simple and efficient"; then "avoid the general look everywhere, don't always use slider
buttons, vary". Design calls:
- **Categories are the roles the tier list has**: a champion is in every role it has a tier-list
  row in (≥ 50 games and 0.5 % pick rate there), so a flex pick shows in both of its roles. The
  role control stays the shared one (a shared vertical role picker will replace it).
- **Three sorts, remembered**: tier (default: groups that read like a tier list, the letter and
  its size beside the champions, the letter staying in view while its group scrolls by), pick
  rate, A–Z. Each tile shows the number it's sorted by (win rate, or pick rate); a tier group's
  tiles leave the badge to the heading. The sort is words with a gliding accent bar, not another
  pill; it waits, dimmed, while the field filters (matches come best first).
- **The field filters as you type**, best match first; Enter opens the first. "Type anywhere to
  filter" was left out: the title bar search (`/`, Ctrl+K) already finds a champion by name.
- **No stats is still a page**: one line says why sorting by stats is unavailable (a retry when it
  can help), the champions are grouped by Data Dragon class.
- **Budget**: the JS bundle had 1.3 KB left; the list fits in it (the loading skeleton is drawn by
  CSS, constant classes are set once with `/*@once*/`).

## 2026-09-29 — Live names from Riot's live game, then the game (owner's brief, Claude built)
A real client (2026-09-28, EUW, ARAM: Mayhem and custom games) names nobody but the local player
in its gameflow session, so every real game showed nine "Unknown player" cards. Calls:
- **Riot's live game first** (Spectator-V5 on our server): answers from the loading screen on,
  applies Streamer Mode itself (anonymous players have no PUUID; their name is dropped), and
  brings the cards in the same round trip. The app sends only its own player's Riot ID and the
  game's id; the server keeps each game for its duration under every visible player's PUUID,
  so the other nine players of that game cost no Riot call.
- **The game itself second** (Live Client Data API): only when Riot has nothing (no server,
  not listed yet, "filtered" for Ranked Flex and Arena). It answers once the loading screen is
  over, so it is asked every 2 s during a game until it does, then never again (idle means
  idle); its streamer-mode stand-ins (no tag, a champion's name, a shared name) stay hidden.
  Riot's filter has no stated intent: asking Riot in an App Note before the production key.
- **Seats by side and champion**, not by name or order: both lists name the players of the
  session's seats, the same champion twice on a side in order; bots the session missed get
  seats. A seat marked hidden never gets a name.
- **Names before cards**: when Riot's cards take longer than 5 s the names go out without them
  and the batch picks the rest up, so a slow or rate-limited key never holds the names back.
- **Say where the names are**: `LiveGame.names` (asking / waiting / known) drives a name
  placeholder per seat (still during the minute or two the game takes to load: nothing pulses
  that long) and one line in the page head, in a slot that never makes the head wrap; a filtered
  queue is named plainly ("Riot doesn't share live Ranked Flex games"), neutral, with nothing
  to retry. Your own card doesn't wait for the others' names.
- **Bots read "AI bot"** with their champion under it ("Bot" alone is the bottom lane's name);
  streamer-mode players keep their lane ("Streamer mode · Jungle").
- **Riot IDs on Live cards open the player's page** (owner's ask, 2026-09-29): visible players
  only; hidden players and bots have no name to open.

## 2026-09-29 — Auto import, once (owner decided, Claude built)
Owner: "I want an auto import toggle instead. Auto import needs to import once, and warn if
different, not enforce. No warning if manual changes to a rune page." Asked to choose, the owner
picked per-part switches.
- **One "Auto import" switch per part** (Rune page, Item set, Summoner spells) replaces the
  Off / One click / On lock-in choice. The buttons are always there (Draft's import bar, champion
  pages), whatever the switches. Off by default. Settings files of 0.2 migrate in place: "on
  lock-in" → on, "one click" and "off" → off, nothing else touched.
- **Once**: the parts switched on are imported by themselves at the first lock-in of a champion
  select (in ARAM, the first champion given), never again by MVP in that champion select.
- **Warn, don't enforce**: if the champion or role changes after that (a trade, an ARAM reroll
  or bench swap, a role swap), Draft says "MVP's build is for Ahri Mid, you're now on Lux" with a
  one-click "Import for Lux" (a toast with the same click elsewhere in MVP). The warning goes once
  imported for the new one (by that click or the part buttons), when trading back, or when
  champion select ends.
- **Never watched**: MVP doesn't read the player's pages, sets or spells to compare; only a
  change of lock warns, so what the player changes themselves never does.
- Spells keep their rules (never in the last 5 s, Flash on the player's key); the server's kill
  switches still pause each part.
- With it, two real-client fixes (Claude): Draft's import results survive the client sending its
  session again (they went back to the idle hint after a spells change), and an import clicked as
  champion select ends says so instead of "No build for this champion and role".


## 2026-09-29 — A private roadmap at dev.mvpgg.com (owner asked, Claude built)
Owner: a todo list on our server, only for the repo's admins (him and Claude), each feature with
a way to accept, create and remove, Claude proposing as it works, split by versions; "a cool
visualizer but also a nice tool to work with". Calls:
- **Its own small service** (`apps/roadmap`, axum + SQLite, like the rest), next to the backend on
  the VPS behind Caddy and Cloudflare. The code is public; the roadmap stays in the server's file.
- **GitHub decides who is an admin**: sign-in with an OAuth App (no scope), then GitHub's
  permission for `Filmoo/MVP` must be `admin`, asked again every ten minutes. Claude gets a
  machine token instead, made on the server and stored hashed.
- **Claude proposes, the owner decides**: Claude's features start as proposals in an inbox; only
  the owner accepts, rejects, edits, orders or removes. Claude moves accepted work along and links
  its commits.
- **Everything is logged** (who, when, what), in the same transaction as the change.
- **The seed is the docs**: `apps/roadmap/seed/roadmap.json` (versions 0.2 released, 0.3 in
  progress, 0.4, Later) goes into an empty database only; after that the roadmap lives on the
  server.
- **It looks like MVP** (the app's tokens and glass) and is idle-silent: no polling, it reads the
  roadmap again when the tab comes back.
