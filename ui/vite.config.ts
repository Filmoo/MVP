/// <reference types="vitest/config" />
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

// Dev/test only: serve Data Dragon assets downloaded by `scripts/fetch-dev-assets.mjs`
// under /dd/. Riot assets are never committed or bundled; the shipped app loads them at runtime.
const DEV_ASSETS = resolve(import.meta.dirname, "../.cache/ddragon");

function devAssets(): Plugin {
  return {
    name: "scout-dev-assets",
    configureServer(server) {
      server.middlewares.use("/dd", serveDir);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/dd", serveDir);
    },
  };
}

async function serveDir(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) {
  const path = resolve(DEV_ASSETS, `.${decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")}`);
  if (!path.startsWith(DEV_ASSETS) || !existsSync(path)) return next();
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
  res.setHeader("Cache-Control", "max-age=31536000, immutable");
  res.end(await readFile(path));
}

export default defineConfig({
  plugins: [solid(), devAssets()],
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
