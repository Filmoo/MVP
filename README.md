# MVP

A lightweight desktop companion for League of Legends: live lookups, builds and stats,
match history, post-game analysis and a stats-only champion select helper.

> Working name. Built with Tauri 2 (Rust) + SolidJS. No Electron, no Overwolf.

## Get the Windows app

- **Every push**: GitHub Actions → *CI* → latest run → artifact **scout-windows**
  (installer `MVP_x.y.z_x64-setup.exe` and portable `MVP.exe`).
- **Releases**: push a tag `vX.Y.Z` → a draft GitHub release with the installer.
- **Locally on Windows**: install [Rust](https://rustup.rs), [Node 22+](https://nodejs.org)
  and pnpm (`corepack enable`), then:

  ```sh
  pnpm install
  pnpm build:exe      # → target/release/bundle/nsis/MVP_*_x64-setup.exe
  ```

## Develop

```sh
pnpm install
node scripts/fetch-dev-assets.mjs   # game icons for dev/tests (not committed)
pnpm dev                            # UI in the browser with mock data (http://127.0.0.1:1420)
pnpm app                            # the real desktop app
node scripts/check.mjs full         # every quality gate
```

Mock scenarios: add `?scenario=<name>` to the dev URL — `default`, `not-running`,
`slow-loading`, `profile-error`, `new-player`, `extreme`, `widget-crash`.

## Quality gates

| Suite | What it guarantees |
| --- | --- |
| Rust `cargo test`, clippy pedantic | core logic, parsers (property tests) |
| Vitest | pure UI logic (formatting, aggregations) |
| Layout (Playwright) | every view × 8 window sizes × all scenarios: no overflow, clipping, overlap, off-screen or squeezed widgets; live resize sweep |
| Coherence | only design tokens are rendered; one heading per view; shared page frame |
| Errors | client missing, core failures, slow core (no layout shift), crashing widget contained, missing assets |
| Perf | per-widget mount time & DOM size budgets, boot time, **zero work when idle**, view switch, memory, resize cost, bundle size |

## Layout

```
apps/desktop   Tauri shell (window, tray, commands)
crates/        Rust core: domain types, League client API, statistics
ui/            SolidJS UI, mock scenarios, Playwright suites
docs/          decisions, Riot policy notes, research
scripts/       checks, dev assets, hooks
```
