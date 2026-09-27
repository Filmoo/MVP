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
