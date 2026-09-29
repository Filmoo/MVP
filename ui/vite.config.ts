/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// Dev/test only: serve Data Dragon assets downloaded by `scripts/fetch-dev-assets.mjs`
// under /dd/. Riot assets are never committed or bundled; the shipped app loads them at runtime.
const DEV_ASSETS = resolve(import.meta.dirname, "../.cache/ddragon");
// Profiles captured with `cargo run -p players --bin capture-profile` (never committed).
const DEV_FIXTURES = resolve(import.meta.dirname, "../.cache/fixtures");

function devAssets(): Plugin {
  return {
    name: "scout-dev-assets",
    configureServer(server) {
      server.middlewares.use("/dd", serveFrom(DEV_ASSETS));
      server.middlewares.use("/fixtures", serveFrom(DEV_FIXTURES));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/dd", serveFrom(DEV_ASSETS));
      server.middlewares.use("/fixtures", serveFrom(DEV_FIXTURES));
    },
  };
}

function serveFrom(dir: string) {
  return async (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
    const path = resolve(dir, `.${decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")}`);
    if (!path.startsWith(dir) || !existsSync(path)) return next();
    const { readFile } = await import("node:fs/promises");
    const ext = path.slice(path.lastIndexOf(".") + 1);
    const types: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      json: "application/json",
      svg: "image/svg+xml",
      webp: "image/webp",
    };
    res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.end(await readFile(path));
  };
}

/**
 * Short class names for the build's CSS modules: four letters for the file (from its path; the
 * first a capital, so never one of the global lowercase classes like `num`), then the class's
 * rank in it (`Qxtb0`, `Qxtb1`…). Each module's class map ships in JS as `key:"name"` for every
 * class; with Vite's `_key_hash_line` names those maps were ~8 KB of the app's gzipped JS. Two
 * files drawing the same letters stop the build: never a silent clash.
 */
function shortClassNames(): (name: string, filename: string, css: string) => string {
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const LETTERS = `abcdefghijklmnopqrstuvwxyz${CAPITALS}`;
  const owners = new Map<string, string>();
  const files = new Map<string, { prefix: string; ranks: Map<string, number> }>();
  return (name, filename, css) => {
    const file = relative(import.meta.dirname, filename.split("?")[0] ?? filename).replaceAll("\\", "/");
    let known = files.get(file);
    if (!known) {
      const digest = createHash("sha1").update(file).digest();
      const prefix = [...digest.subarray(0, 4)].map((byte, i) => (i === 0 ? CAPITALS[byte % 26] : LETTERS[byte % 52])).join("");
      const owner = owners.get(prefix);
      if (owner !== undefined && owner !== file) throw new Error(`CSS modules ${owner} and ${file} draw the same class prefix ${prefix}`);
      owners.set(prefix, file);
      // Ranks by first appearance in the file: the same names from one build to the next.
      const ranks = new Map<string, number>();
      for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
        const local = match[1] ?? "";
        if (!ranks.has(local)) ranks.set(local, ranks.size);
      }
      known = { prefix, ranks };
      files.set(file, known);
    }
    if (!known.ranks.has(name)) known.ranks.set(name, known.ranks.size);
    return `${known.prefix}${(known.ranks.get(name) ?? 0).toString(36)}`;
  };
}

/**
 * `vite build --mode app` is what ships in the desktop app (`pnpm build`, Tauri's before-build
 * command): it leaves out the browser mock (scripted scenarios, stats fixtures, the widget
 * harness), which only the browser preview, the dev server and the UI tests use.
 */
export default defineConfig(({ command, mode }) => ({
  plugins: [solid(), devAssets()],
  define: { __MVP_MOCK__: JSON.stringify(mode !== "app") },
  // The dev server keeps Vite's readable names (`_card_x1y2z_12`).
  css: { modules: command === "build" ? { generateScopedName: shortClassNames() } : {} },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 is evergreen Chromium: no legacy transpilation needed.
    target: "chrome120",
    sourcemap: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        // Everything the first screen loads in one chunk (the entry included). Left to itself,
        // Rolldown cut it into ~20 small chunks wherever a lazy view shares a piece of it, each
        // importing the others and each re-listed in every lazy view's preload list. No module
        // of it may await at its top level (see main.tsx): lazy chunks import from it.
        codeSplitting: { groups: [{ name: "app", tags: ["$initial"] }] },
      },
    },
  },
  test: {
    // src: pure logic (browser code); tests/unit: checks that read the source tree (Node).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
    environment: "node",
    // The views' words load with the views in the app; tests of their code need them at once.
    setupFiles: ["src/i18n/test-setup.ts"],
  },
}));
