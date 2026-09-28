#!/usr/bin/env node
// One-time setup of MVP's app updates, run by the owner on their own machine:
//
//   node scripts/setup-updates.mjs
//
// 1. Makes the update signing key pair in ~/.tauri/mvp.key (+ .pub, + .password), or reuses it.
//    The private key and its password never leave this machine and never go into the repo: whoever
//    has them can ship an update to every installed MVP.
// 2. Puts the public key in apps/desktop/tauri.conf.json (plugins.updater.pubkey): installed apps
//    check every update against it. Commit that file.
// 3. Stores the private key and its password as the repository's GitHub secrets (with `gh`, if it
//    is installed and logged in; otherwise it says what to paste where), for release.yml.
//
// Then: commit, push, tag the version in Cargo.toml (`git tag v0.2.0 && git push origin v0.2.0`).
// Install that release once by hand; every later release (a new version, tagged) installs itself.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repo = "Filmoo/MVP";
const key = join(homedir(), ".tauri", "mvp.key");
const passwordFile = `${key}.password`;
const config = join(root, "apps/desktop/tauri.conf.json");
const onWindows = process.platform === "win32";

const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, encoding: "utf8", shell: onWindows, ...options });

// 1. The key pair (kept when it exists: installed apps trust the key they were built with).
if (existsSync(key) && existsSync(`${key}.pub`) && existsSync(passwordFile)) {
  console.log(`Using the existing key pair in ${dirname(key)}.`);
} else {
  mkdirSync(dirname(key), { recursive: true });
  const password = randomBytes(24).toString("base64url");
  const made = run("pnpm", ["tauri", "signer", "generate", "--ci", "--force", "-p", password, "-w", key], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (made.status !== 0 || !existsSync(`${key}.pub`)) {
    console.error("Could not make the key pair (is `pnpm install` done?).");
    process.exit(1);
  }
  writeFileSync(passwordFile, password, { mode: 0o600 });
  console.log(`Made the update key pair in ${dirname(key)} (keep it safe, never share it).`);
}

// 2. The public key in the app's config (only that value changes in the file).
const pubkey = readFileSync(`${key}.pub`, "utf8").trim();
const before = readFileSync(config, "utf8");
const after = before.replace(/"pubkey":\s*"[^"]*"/, `"pubkey": ${JSON.stringify(pubkey)}`);
if (!/"pubkey":/.test(before)) {
  console.error(`No plugins.updater.pubkey in ${config}.`);
  process.exit(1);
}
writeFileSync(config, after);
console.log(after === before ? "tauri.conf.json already has this public key." : "Public key written to apps/desktop/tauri.conf.json.");

// 3. The GitHub secrets release.yml signs with.
const secrets = {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, "utf8").trim(),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: readFileSync(passwordFile, "utf8").trim(),
};
const gh = run("gh", ["auth", "status"], { stdio: "ignore" });
if (gh.status === 0) {
  for (const [name, value] of Object.entries(secrets)) {
    const set = run("gh", ["secret", "set", name, "--repo", repo], { input: value, stdio: ["pipe", "ignore", "inherit"] });
    if (set.status !== 0) {
      console.error(`Could not set the ${name} secret with gh.`);
      process.exit(1);
    }
  }
  console.log(`GitHub secrets set on ${repo}.`);
} else {
  console.log(`
Add two repository secrets at https://github.com/${repo}/settings/secrets/actions (New repository secret):
  TAURI_SIGNING_PRIVATE_KEY           the contents of ${key}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD  the contents of ${passwordFile}
(or install the GitHub CLI, run \`gh auth login\`, and run this script again).`);
}

console.log(`
Next:
  git add apps/desktop/tauri.conf.json && git commit -m "Updates: the update key" && git push
  git tag v<version in Cargo.toml> && git push origin v<version>   (release.yml publishes the release)
Install that release once; later releases (a new version, tagged) install themselves.`);
