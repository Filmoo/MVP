/// <reference types="vitest/config" />
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
 * `vite build --mode app` is what ships in the desktop app (`pnpm build`, Tauri's before-build
 * command): it leaves out the browser mock (scripted scenarios, stats fixtures, the widget
 * harness), which only the browser preview, the dev server and the UI tests use.
 */
export default defineConfig(({ mode }) => ({
  plugins: [solid(), devAssets()],
  define: { __MVP_MOCK__: JSON.stringify(mode !== "app") },
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
  },
}));
