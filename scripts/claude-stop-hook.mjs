#!/usr/bin/env node
// Claude Code "Stop" hook: whenever Claude finishes a turn with changes in the working tree,
// run the quality gates. Fast checks always; UI suites too when ui/ changed. On failure the
// output goes back to Claude (exit 2) so it fixes things before handing over.
// Skips when nothing changed since the last green run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stateFile = resolve(root, ".cache/last-green-check");

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}

const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
const status = git("status", "--porcelain", "--untracked-files=all");
const fingerprint = createHash("sha256").update(status).update(git("diff", "HEAD")).digest("hex");

if (!status.trim()) process.exit(0);
if (existsSync(stateFile) && readFileSync(stateFile, "utf8") === fingerprint) process.exit(0);

const uiChanged = status.split("\n").some((line) => /\bui\//.test(line));
const run = (mode) => spawnSync("node", ["scripts/check.mjs", mode], { cwd: root, encoding: "utf8" });

let result = run("fast");
if (result.status === 0 && uiChanged) result = run("ui");

if (result.status === 0) {
  mkdirSync(resolve(root, ".cache"), { recursive: true });
  writeFileSync(stateFile, fingerprint);
  process.exit(0);
}

const output = `${result.stdout}\n${result.stderr}`.split("\n").slice(-80).join("\n");
if (input.stop_hook_active) {
  // Already blocked once this turn: surface the failure without looping forever.
  console.error(`Quality gates still failing:\n${output}`);
  process.exit(0);
}
console.error(`Quality gates failed — fix before finishing:\n${output}`);
process.exit(2);
