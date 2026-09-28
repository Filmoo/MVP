#!/usr/bin/env node
// Refuses secrets in the repository: every file git tracks or would add (anything not ignored) is
// scanned for real keys and tokens, Riot API keys included (GitHub's own scanner may not know
// them). Part of every `check.mjs` run, so the Stop hook and CI run it too. A finding names the
// file, the line and the kind of secret, never the secret itself.
//   node scripts/check-secrets.mjs
// A line that must hold a key-shaped value (a test fixture) can end with `check-secrets: allow`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

// Real formats only: placeholders such as `RGAPI-replace-me` or `RGAPI-…` don't match.
const kinds = [
  ["Riot API key", /RGAPI-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  // Built from parts so that this file doesn't match itself.
  ["update signing key", new RegExp(["untrusted comment:", "(?:rsign|minisign) encrypted secret key"].join(" "))],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];

// The patterns check themselves on made-up values, so a broken one can't pass silently.
const fake = (length) => "a1b2c3d4e5f6".repeat(9).slice(0, length);
const samples = {
  "Riot API key": `RGAPI-${fake(8)}-${fake(4)}-${fake(4)}-${fake(4)}-${fake(12)}`,
  "private key": ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" "),
  "update signing key": ["untrusted comment:", "rsign encrypted secret key"].join(" "),
  "GitHub token": `ghp_${fake(36)}`,
  "AWS access key": `AKIA${fake(16).toUpperCase()}`,
  "Slack token": `xoxb-${fake(24)}`,
};
for (const [kind, pattern] of kinds) {
  if (!pattern.test(samples[kind])) {
    console.error(`check-secrets: the "${kind}" pattern no longer matches its own format.`);
    process.exit(2);
  }
}
for (const placeholder of ["RGAPI-replace-me", "RGAPI-test", "RGAPI-…", "RGAPI-secret"]) {
  if (kinds.some(([, pattern]) => pattern.test(placeholder))) {
    console.error(`check-secrets: the placeholder "${placeholder}" would be reported.`);
    process.exit(2);
  }
}

const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (listed.status !== 0) {
  console.error(`check-secrets: git ls-files failed: ${listed.stderr}`);
  process.exit(2);
}

const findings = [];
let scanned = 0;
for (const file of new Set(listed.stdout.split("\0").filter(Boolean))) {
  let bytes;
  try {
    bytes = readFileSync(resolve(root, file));
  } catch {
    continue; // deleted in the working tree
  }
  if (bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 8000).includes(0)) continue; // binary or huge
  scanned += 1;
  const lines = bytes.toString("utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.includes("check-secrets: allow")) return;
    for (const [kind, pattern] of kinds) {
      if (pattern.test(line)) findings.push(`${file}:${index + 1}: ${kind}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Secrets found — remove them, and revoke any that was ever pushed:\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-secrets: no secrets in ${scanned} files.`);
