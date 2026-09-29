#!/usr/bin/env node
// Claude's door to MVP's roadmap (apps/roadmap, https://dev.mvpgg.com): read it, propose features,
// move accepted work along, comment. Accepting and rejecting proposals stays the owner's.
//
//   node scripts/roadmap.mjs list [--version 0.4] [--status proposed,in_progress] [--area draft] [--all] [--json]
//   node scripts/roadmap.mjs show <id> [--json]
//   node scripts/roadmap.mjs propose "Title" --area draft [--version 0.4] [--description "…"] [--json]
//   node scripts/roadmap.mjs status <id> in_progress|done|accepted [--link <url> [--label <text>]]
//   node scripts/roadmap.mjs comment <id> "Text (markdown)"
//   node scripts/roadmap.mjs link <id> <url> [--label <text>]
//   node scripts/roadmap.mjs versions | areas
//
// The server: MVP_ROADMAP_URL (default https://dev.mvpgg.com). The token (made on the server by
// `mvp-roadmap token create --name claude`): MVP_ROADMAP_TOKEN, else the git-ignored file
// .cache/roadmap-token. A proposal goes to --version, else to the last version (Later).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const BASE = (process.env.MVP_ROADMAP_URL ?? "https://dev.mvpgg.com").replace(/\/+$/, "");
const STATUS_WORDS = {
  proposed: "proposed",
  accepted: "accepted",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  started: "in_progress",
  done: "done",
  rejected: "rejected",
};
const LABEL = { proposed: "proposed", accepted: "accepted", in_progress: "in progress", done: "done", rejected: "rejected" };

function fail(message) {
  console.error(`roadmap: ${message}`);
  process.exit(1);
}

function token() {
  const fromEnv = process.env.MVP_ROADMAP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = resolve(root, ".cache/roadmap-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  fail("no token: set MVP_ROADMAP_TOKEN or put it in .cache/roadmap-token (the owner makes it: mvp-roadmap token create --name claude)");
}

/** Splits `--flag value` pairs (and bare `--json`/`--all`) from positional words. */
function parse(args) {
  const flags = {};
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" || arg === "--all") flags[arg.slice(2)] = true;
    else if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i++;
    } else words.push(arg);
  }
  return { flags, words };
}

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    fail(`${BASE} can't be reached (${error.cause?.code ?? error.message})`);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) fail(`${response.status} ${data?.message ?? response.statusText}`);
  return data;
}

const roadmap = () => call("GET", "/api/roadmap");

function versionOf(map, name) {
  const version = map.versions.find((v) => v.name.toLowerCase() === String(name).toLowerCase());
  if (!version) fail(`no version ${name} (there are: ${map.versions.map((v) => v.name).join(", ")})`);
  return version;
}

function areaOf(map, name) {
  const wanted = String(name).toLowerCase();
  const area = map.areas.find((a) => a.key === wanted || a.name.toLowerCase() === wanted);
  if (!area) fail(`no area ${name} (keys: ${map.areas.map((a) => a.key).join(", ")})`);
  return area;
}

function id(word) {
  const n = Number.parseInt(String(word ?? "").replace(/^#/, ""), 10);
  if (!Number.isFinite(n)) fail(`"${word ?? ""}" isn't a feature number`);
  return n;
}

function line(feature, map) {
  const version = map.versions.find((v) => v.id === feature.versionId)?.name ?? "?";
  const by = feature.proposedBy === "claude" ? " (Claude)" : "";
  return `#${String(feature.id).padEnd(4)} ${LABEL[feature.status].padEnd(11)} ${version.padEnd(6)} ${feature.area.padEnd(10)} ${feature.title}${by}`;
}

function show(value, json, text) {
  console.log(json ? JSON.stringify(value, null, 2) : text);
}

const [command, ...rest] = process.argv.slice(2);
const { flags, words } = parse(rest);

switch (command) {
  case "list": {
    const map = await roadmap();
    const statuses = flags.status
      ? String(flags.status)
          .split(",")
          .map((s) => STATUS_WORDS[s.trim()] ?? fail(`unknown status ${s}`))
      : null;
    const version = flags.version ? versionOf(map, flags.version) : null;
    const area = flags.area ? areaOf(map, flags.area) : null;
    const features = map.features.filter(
      (f) =>
        !f.removedAt &&
        (statuses ? statuses.includes(f.status) : flags.all || f.status !== "rejected") &&
        (!version || f.versionId === version.id) &&
        (!area || f.area === area.key),
    );
    show(features, flags.json, features.map((f) => line(f, map)).join("\n") || "nothing matches");
    break;
  }
  case "show": {
    const detail = await call("GET", `/api/features/${id(words[0])}`);
    const map = await roadmap();
    const f = detail.feature;
    const text = [
      line(f, map),
      f.description && `\n${f.description}`,
      f.links.length > 0 && `\nLinks:\n${f.links.map((l) => `  ${l.label || l.url}  ${l.url}`).join("\n")}`,
      detail.comments.length > 0 && `\nComments:\n${detail.comments.map((c) => `  ${c.author.name}: ${c.body}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n");
    show(detail, flags.json, text);
    break;
  }
  case "propose": {
    const title = words.join(" ").trim();
    if (!title) fail('propose "Title" --area <key> [--version 0.4] [--description "…"]');
    const map = await roadmap();
    if (!flags.area) fail(`--area is needed (keys: ${map.areas.map((a) => a.key).join(", ")})`);
    const version = flags.version ? versionOf(map, flags.version) : map.versions[map.versions.length - 1];
    if (!version) fail("the roadmap has no version yet");
    const created = await call("POST", "/api/features", {
      title,
      description: flags.description ?? "",
      versionId: version.id,
      area: areaOf(map, flags.area).key,
    });
    show(created, flags.json, `proposed #${created.id} for ${version.name}: ${created.title} (the owner accepts or rejects it)`);
    break;
  }
  case "status": {
    const status = STATUS_WORDS[words[1]];
    if (!status) fail("status <id> in_progress|done|accepted [--link <url> [--label <text>]]");
    const updated = await call("POST", `/api/features/${id(words[0])}/status`, { status });
    if (flags.link) await call("POST", `/api/features/${updated.id}/links`, { url: flags.link, label: flags.label ?? "" });
    show(updated, flags.json, `#${updated.id} is ${LABEL[updated.status]}: ${updated.title}${flags.link ? ` (linked ${flags.link})` : ""}`);
    break;
  }
  case "comment": {
    const body = words.slice(1).join(" ").trim();
    if (!body) fail('comment <id> "text"');
    const comment = await call("POST", `/api/features/${id(words[0])}/comments`, { body });
    show(comment, flags.json, `commented on #${comment.featureId}`);
    break;
  }
  case "link": {
    const url = words[1];
    if (!url) fail("link <id> <url> [--label <text>]");
    const link = await call("POST", `/api/features/${id(words[0])}/links`, { url, label: flags.label ?? "" });
    show(link, flags.json, `linked ${link.label || link.url} to #${id(words[0])}`);
    break;
  }
  case "versions": {
    const map = await roadmap();
    show(
      map.versions,
      flags.json,
      map.versions.map((v) => `${v.name.padEnd(8)} ${v.releasedOn ? `released ${v.releasedOn}` : ""} ${v.goal}`.trim()).join("\n"),
    );
    break;
  }
  case "areas": {
    const map = await roadmap();
    show(map.areas, flags.json, map.areas.map((a) => `${a.key.padEnd(12)} ${a.name}`).join("\n"));
    break;
  }
  default:
    fail(
      'list | show <id> | propose "Title" --area <key> | status <id> <status> | comment <id> "text" | link <id> <url> | versions | areas',
    );
}
