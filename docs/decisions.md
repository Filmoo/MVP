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
