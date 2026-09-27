#!/usr/bin/env node
// One entry point for every quality gate, used locally, by the Claude Code hook and by CI.
//   node scripts/check.mjs fast   → lint, types, unit tests, UI build/budgets, Rust tests (~1 min)
//   node scripts/check.mjs full   → fast + UI suites (layout, coherence, errors, perf)
//   node scripts/check.mjs ui     → build + UI suites only
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const BINDINGS_CHECK = `
const out = require("node:child_process").execSync("git status --porcelain -- ui/src/data/generated", { encoding: "utf8" }).trim();
if (out && process.env.CI) { console.error("TypeScript bindings are stale, run cargo test -p domain and commit:\n" + out); process.exit(1); }
if (out) console.log("note: regenerated bindings not committed yet:\n" + out);
`;
const mode = process.argv[2] ?? "fast";

const rust = [
  ["cargo fmt", "cargo", ["fmt", "--all", "--check"]],
  ["cargo clippy", "cargo", ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"]],
  ["cargo test", "cargo", ["test", "--workspace"]],
  // In CI the regenerated bindings must match what's committed (new files included).
  ["TS bindings fresh", "node", ["-e", BINDINGS_CHECK]],
];
const web = [
  ["biome", "pnpm", ["exec", "biome", "check", "."]],
  ["typecheck", "pnpm", ["--filter", "@scout/ui", "typecheck"]],
  ["unit tests", "pnpm", ["--filter", "@scout/ui", "test:unit"]],
];
// The desktop crate embeds ui/dist at compile time, so the UI is built before any cargo step.
const build = [["UI build + bundle budgets", "pnpm", ["--filter", "@scout/ui", "build"]]];
const ui = [
  [
    "UI: layout, coherence, errors",
    "pnpm",
    ["--filter", "@scout/ui", "exec", "playwright", "test", "--project=layout", "--project=coherence", "--project=errors"],
  ],
  ["UI: performance budgets", "pnpm", ["--filter", "@scout/ui", "exec", "playwright", "test", "--project=perf", "--workers=1"]],
];

const plans = { fast: [...web, ...build, ...rust], full: [...web, ...build, ...rust, ...ui], ui: [...build, ...ui] };
const steps = plans[mode];
if (!steps) {
  console.error(`unknown mode "${mode}" (fast | full | ui)`);
  process.exit(2);
}

const results = [];
for (const [name, cmd, args] of steps) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const { status } = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "1" } });
  results.push({ name, ok: status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  if (status !== 0) break;
}

console.log("\n──────── summary ────────");
for (const r of results) console.log(`${r.ok ? "✔" : "✘"} ${r.name.padEnd(32)} ${r.seconds}s`);
const skipped = steps.length - results.length;
if (skipped) console.log(`… ${skipped} step(s) skipped after the failure`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
