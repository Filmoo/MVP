/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** The roadmap service (`pnpm roadmap --dev-login`), which the dev server proxies to. */
const SERVICE = process.env.MVP_ROADMAP_SERVICE ?? "http://127.0.0.1:8790";

/**
 * The roadmap's web UI. `vite build` writes `dist/`, which the service serves (debug builds read
 * it from disk, release builds embed it). `vite` (port 1445) is the dev server with hot reload:
 * API and sign-in calls go to the service, as if the page came from it.
 */
export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: 1445,
    strictPort: true,
    host: "127.0.0.1",
    proxy: Object.fromEntries(
      ["/api", "/auth", "/_", "/health"].map((path) => [
        path,
        {
          target: SERVICE,
          // The service refuses changes from another origin: present them as its own.
          configure: (proxy: {
            on: (event: "proxyReq", handler: (request: { setHeader: (n: string, v: string) => void }) => void) => void;
          }) => proxy.on("proxyReq", (request) => request.setHeader("origin", SERVICE)),
        },
      ]),
    ),
  },
  build: {
    target: "es2022",
    sourcemap: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
