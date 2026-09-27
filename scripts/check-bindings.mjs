#!/usr/bin/env node
// The TypeScript bindings in ui/src/data/generated are generated from the Rust domain types
// (`cargo test -p domain`). In CI they must match what's committed; locally this only warns.
import { execFileSync } from "node:child_process";

const changes = execFileSync("git", ["status", "--porcelain", "--", "ui/src/data/generated"], { encoding: "utf8" }).trim();
if (changes && process.env.CI) {
  console.error(`TypeScript bindings are stale. Run \`cargo test -p domain\` and commit:\n${changes}`);
  process.exit(1);
}
if (changes) console.log(`note: regenerated bindings not committed yet:\n${changes}`);
