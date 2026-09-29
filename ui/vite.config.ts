/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

/**
 * The desktop build's CSS module class names: the class and a hash of its file
 * (`_statsTitle_rt7mq`), without the line number Vite's default adds (`_statsTitle_rt7mq_199`):
 * spelled out in every chunk's class map and stylesheet, the digits were what gzip couldn't
 * squeeze (2 KB of JS in all). A module's classes are unique within it; two files hashing alike
 * fail the build. The browser preview (the UI tests, the dev server) keeps Vite's names.
 */
function shortClassNames(): (local: string, file: string) => string {
  const owners = new Map<string, string>();
  return (local, file) => {
    const path = relative(import.meta.dirname, file.split("?")[0] ?? file).replaceAll("\\", "/");
    const suffix = createHash("sha256").update(path).digest("base64url").slice(0, 5);
    const owner = owners.get(suffix);
    if (owner && owner !== path) throw new Error(`CSS modules ${owner} and ${path} both hash to ${suffix}`);
    owners.set(suffix, path);
    return `_${local}_${suffix}`;
  };
}

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
 * `vite build --mode app` is what ships in the desktop app (`pnpm build`, Tauri's before-build
 * command): it leaves out the browser mock (scripted scenarios, stats fixtures, the widget
 * harness), which only the browser preview, the dev server and the UI tests use.
 */
export default defineConfig(({ mode }) => ({
  plugins: [solid(), devAssets()],
  define: { __MVP_MOCK__: JSON.stringify(mode !== "app") },
  css: mode === "app" ? { modules: { generateScopedName: shortClassNames() } } : {},
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
  },
  test: {
    // src: pure logic (browser code); tests/unit: checks that read the source tree (Node).
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
    environment: "node",
    // The views' words load with the views in the app; tests of their code need them at once.
    setupFiles: ["src/i18n/test-setup.ts"],
  },
}));
