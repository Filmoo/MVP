#!/usr/bin/env node
// One entry point for every quality gate, used locally, by the Claude Code hook and by CI.
//   node scripts/check.mjs fast   → lint, types, unit tests, UI build/budgets, Rust tests (~1 min)
//   node scripts/check.mjs full   → fast + UI suites (layout, coherence, errors, perf) + website + roadmap
//   node scripts/check.mjs ui     → build + UI suites + website (the browser suites)
//   node scripts/check.mjs site   → website only (site/: pages, releases, links, EN/FR; ~15 s)
//   node scripts/check.mjs roadmap → the roadmap tool's UI against its service (apps/roadmap, ~2 min)
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const mode = process.argv[2] ?? "fast";

const rust = [
  ["cargo fmt", "cargo", ["fmt", "--all", "--check"]],
  ["cargo clippy", "cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
  ["cargo test", "cargo", ["test", "--workspace"]],
  // In CI the regenerated bindings must match what's committed (new files included).
  ["TS bindings fresh", "node", ["scripts/check-bindings.mjs"]],
];
const web = [
  ["biome", "pnpm", ["exec", "biome", "check", "."]],
  ["typecheck", "pnpm", ["--filter", "@scout/ui", "typecheck"]],
  ["unit tests", "pnpm", ["--filter", "@scout/ui", "test:unit"]],
  ["roadmap: typecheck + unit tests", "pnpm", ["--filter", "@scout/roadmap", "check"]],
];
// The desktop crate embeds ui/dist at compile time, so the UI is built before any cargo step.
const build = [["UI build + bundle budgets", "pnpm", ["--filter", "@scout/ui", "build"]]];
const ui = [
  [
    "UI: layout, coherence, errors, interactions (English and French)",
    "pnpm",
    [
      "--filter",
      "@scout/ui",
      "exec",
      "playwright",
      "test",
      "--project=layout",
      "--project=coherence",
      "--project=errors",
      "--project=interactions",
      "--project=layout-fr",
      "--project=coherence-fr",
      "--project=errors-fr",
      "--project=interactions-fr",
    ],
  ],
  ["UI: performance budgets", "pnpm", ["--filter", "@scout/ui", "exec", "playwright", "test", "--project=perf", "--workers=1"]],
];
// The website (mvpgg.com): static pages served like production, GitHub's API mocked.
const site = [
  ["Website: pages, releases, links (EN/FR)", "pnpm", ["--filter", "@scout/site", "exec", "playwright", "test", "--project=smoke"]],
];

// The roadmap tool (dev.mvpgg.com): its UI against the real service (a debug build with
// --dev-login on 127.0.0.1:4272, MVP_ROADMAP_TEST_PORT to move it), built by the suite itself.
const roadmap = [
  [
    "Roadmap: board, drag, proposals, keyboard, layout, CLI",
    "pnpm",
    ["--filter", "@scout/roadmap", "exec", "playwright", "test", "--project=roadmap"],
  ],
];

const plans = {
  fast: [...web, ...build, ...rust],
  full: [...web, ...build, ...rust, ...ui, ...site, ...roadmap],
  ui: [...build, ...ui, ...site],
  site,
  roadmap,
};
const steps = plans[mode];
if (!steps) {
  console.error(`unknown mode "${mode}" (fast | full | ui | site | roadmap)`);
  process.exit(2);
}

// Windows has no pnpm.exe, only pnpm.cmd/.ps1 shims, which Node starts only through a shell.
const shell = process.platform === "win32";

const results = [];
for (const [name, cmd, args] of steps) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const options = { cwd: root, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } };
  // Every argument is a plain word, so the shell's command line needs no quoting.
  const { status, error } = shell ? spawnSync([cmd, ...args].join(" "), { ...options, shell }) : spawnSync(cmd, args, options);
  if (error) console.error(`could not start ${cmd}: ${error.message}`);
  results.push({ name, ok: status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  if (status !== 0) break;
}

console.log("\n──────── summary ────────");
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name.padEnd(32)} ${r.seconds}s`);
const skipped = steps.length - results.length;
if (skipped) console.log(`… ${skipped} step(s) skipped after the failure`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
