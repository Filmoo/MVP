/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

/**
 * CSS modules' class names: the local name and one short hash of its file (`tip_k3Zq9`), the same
 * for every class of the file. The default (`_tip_1m7gl_3`) adds the class's line, digits that
 * compress badly, to every name in the JS maps and the stylesheets.
 */
function scopedName(name: string, filename: string): string {
  const file = relative(import.meta.dirname, filename.split("?")[0] ?? filename).replaceAll("\\", "/");
  return `${name}_${createHash("sha256").update(file).digest("base64url").slice(0, 5)}`;
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
 * The chunks the page has from the start: the entry and everything it imports statically (what
 * index.html lists), found once the bundle is written (before Vite writes the lazy chunks'
 * preload lists: `pre`). Those lists leave them out, and the CSS those chunks brought: the page
 * loaded it all already, and Vite's preload helper skipped it at run time anyway; listed, it
 * weighed on the first load. Vite adds CSS files to a list after `resolveDependencies`: they're
 * taken out of its lists once written (`post`), the indices that point into them renumbered.
 */
function startupChunks(): { plugins: Plugin[]; loaded: Set<string> } {
  const loaded = new Set<string>();
  const find: Plugin = {
    name: "scout-startup-chunks",
    enforce: "pre",
    generateBundle(_options, bundle) {
      loaded.clear();
      const add = (file: string) => {
        const chunk = bundle[file];
        if (loaded.has(file) || chunk?.type !== "chunk") return;
        loaded.add(file);
        for (const imported of chunk.imports) add(imported);
      };
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk" && chunk.isEntry) add(chunk.fileName);
    },
  };
  const trimCss: Plugin = {
    name: "scout-startup-css",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const css = new Set<string>();
        for (const file of loaded) {
          const chunk = bundle[file];
          if (chunk?.type === "chunk") for (const sheet of chunk.viteMetadata?.importedCss ?? []) css.add(sheet);
        }
        for (const chunk of Object.values(bundle)) {
          // Vite's helper holds the list, `(m.f||(m.f=["assets/a.js","assets/b.css"]))`, and each
          // import names its entries, `__vite__mapDeps([0,1])`.
          const list = chunk.type === "chunk" ? /\(m\.f\|\|\(m\.f=(\[[^\]]*\])/.exec(chunk.code) : null;
          if (chunk.type !== "chunk" || !list?.[1]) continue;
          let files: string[];
          try {
            files = JSON.parse(list[1]) as string[];
          } catch {
            continue; // not plain file names (a runtime expression): left as Vite wrote it
          }
          const renumbered = new Map<number, number>();
          files.forEach((file, i) => {
            if (!css.has(file)) renumbered.set(i, renumbered.size);
          });
          if (renumbered.size === files.length) continue;
          const kept = (ids: string) =>
            ids
              .split(",")
              .filter(Boolean)
              .flatMap((i) => renumbered.get(Number(i)) ?? []);
          chunk.code = chunk.code
            .replace(list[0], `(m.f||(m.f=${JSON.stringify(files.filter((_, i) => renumbered.has(i)))}`)
            .replace(/__vite__mapDeps\(\[([\d,]*)\]\)/g, (_, ids: string) => `__vite__mapDeps([${kept(ids)}])`);
        }
      },
    },
  };
  return { plugins: [find, trimCss], loaded };
}

/**
 * `vite build --mode app` is what ships in the desktop app (`pnpm build`, Tauri's before-build
 * command): it leaves out the browser mock (scripted scenarios, stats fixtures, the widget
 * harness), which only the browser preview, the dev server and the UI tests use.
 */
const startup = startupChunks();

export default defineConfig(({ mode }) => ({
  plugins: [solid(), devAssets(), ...startup.plugins],
  define: { __MVP_MOCK__: JSON.stringify(mode !== "app") },
  clearScreen: false,
  css: { modules: { generateScopedName: scopedName } },
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 is evergreen Chromium: no legacy transpilation needed.
    target: "chrome120",
    sourcemap: false,
    // Lazy chunks preload what they import, except what the page has from the start (CSS files
    // aren't passed here: Vite adds them all). index.html (`html`) keeps its whole list.
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_file, deps, { hostType }) => (hostType === "js" ? deps.filter((dep) => !startup.loaded.has(dep)) : deps),
    },
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
