#!/usr/bin/env node
// Local preview of the website: `pnpm --filter @scout/site preview` → http://127.0.0.1:4290
// Serves site/public like Caddy's file_server does in production (README.md, "Deploy"): the same
// security headers, gzip, `index.html` for folders (and the trailing-slash redirect), and the
// 404 page in the visitor's language. Development only: no caching, loopback only.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "public");
const portArg = process.argv.indexOf("--port");
const port = Number(portArg > 0 ? process.argv[portArg + 1] : (process.env.PORT ?? 4290));

/** The headers of the Caddy site block (README.md): keep both in step. */
export const HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".svg", ".txt", ".xml", ".json"]);

/** The file for a URL path, or null; folders answer with their index.html. */
function locate(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = normalize(join(root, decoded));
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (!existsSync(file)) return null;
  const stats = statSync(file);
  if (stats.isDirectory()) {
    const index = join(file, "index.html");
    return existsSync(index) ? { file: index, folder: true } : null;
  }
  return { file, folder: false };
}

function send(request, response, status, file) {
  const type = extname(file);
  const headers = { ...HEADERS, "Content-Type": TYPES[type] ?? "application/octet-stream", "Cache-Control": "no-store" };
  if (COMPRESSIBLE.has(type) && /\bgzip\b/.test(request.headers["accept-encoding"] ?? "")) {
    const body = gzipSync(readFileSync(file));
    response.writeHead(status, { ...headers, "Content-Encoding": "gzip", "Content-Length": body.length, Vary: "Accept-Encoding" });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }
  response.writeHead(status, { ...headers, "Content-Length": statSync(file).size });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const found = locate(url.pathname);
  if (found?.folder && !url.pathname.endsWith("/")) {
    // Caddy's file_server canonicalizes folder URLs the same way.
    response.writeHead(308, { Location: `${url.pathname}/${url.search}` }).end();
    return;
  }
  if (found) {
    send(request, response, 200, found.file);
    return;
  }
  const french = url.pathname === "/fr" || url.pathname.startsWith("/fr/");
  send(request, response, 404, join(root, french ? "fr/404.html" : "404.html"));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`MVP website preview: http://127.0.0.1:${port}/\n`);
});
