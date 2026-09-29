# mvpgg.com

MVP's public website: what the app does, the Windows download, every version and what it adds,
the source and licence, the privacy policy and the terms. English and French. Static files, no
framework and no build step: what is in `public/` is what visitors get.

The look is paper and ink: cream paper with a grain, aubergine ink (the logo's `#29253f`), the
app's lavender as watercolour and gold for crowns; at night, charcoal paper and chalk. Strokes
are drawn by hand in SVG and roughened with `feTurbulence` + `feDisplacementMap`; MVP's penguin
(an emperor, a *manchot*) stands on the logo's ripple.

## What's here

```text
site/
├── public/                         the web root (served as is)
│   ├── index.html, fr/index.html   home: what MVP does, download, latest version
│   ├── versions/, fr/versions/     every release and its notes, from GitHub
│   ├── privacy/, fr/confidentialite/   privacy policy (DRAFT, see the comment at the top)
│   ├── terms/, fr/conditions/      terms of service (DRAFT)
│   ├── 404.html, fr/404.html       "lost on the ice"
│   ├── assets/site.css             the whole look; colour tokens at the top (day, then night)
│   ├── assets/noscript.css         without JavaScript: links to GitHub instead of sketches
│   ├── assets/site.js              fills the download and the notes from GitHub's releases
│   ├── assets/releases.js          GitHub's API, cached for the tab (sessionStorage)
│   ├── assets/markdown.js          release notes → DOM nodes (never innerHTML)
│   ├── assets/ink/*.svg            paper grain and brush strokes, used as CSS masks
│   ├── assets/fonts/               Fraunces and Caveat (OFL 1.1, subsets) with their licences
│   └── favicon.svg, robots.txt, sitemap.xml
├── serve.mjs                       local preview with the production headers
├── tests/site.spec.ts              smoke suite (Playwright)
├── tests/shots.spec.ts             screenshots for design review
└── tools/subset_fonts.py           how the two font files were made
```

## Preview and test

```sh
pnpm install
pnpm --filter @scout/site preview   # http://127.0.0.1:4290/  (--port or PORT to move it)
pnpm --filter @scout/site test      # the smoke suite, ~15 s
pnpm --filter @scout/site shots     # reports/site/<lang>-<page>-<width>-<scheme>.png + weights.json
node scripts/check.mjs site         # the same suite as a gate (also part of `ui` and `full`)
```

The preview asks GitHub's real API from your browser; the tests never do (`tests/github.ts`
mocks a release list, an empty list, a pre-release alone and a rate limit). `MVP_SITE_PORT`
moves the test server off 4290.

The smoke suite covers: every page in both languages at 360 and 1280 px (status, `lang`, one
`h1`, Riot's line word for word from the app's catalogues, the language switch, no horizontal
scroll, no console error, no request to any other site than GitHub's API), every link, the
download (the newest non-pre-release's `_x64-setup.exe`, never the `.sig` or another CPU), the
notes' markdown (and that HTML in them stays text), the first-release-soon, pre-release-only and
rate-limited states, one GitHub request per visit, no layout shift when GitHub answers late,
French typography, no JavaScript, reduced motion, nothing animating at rest, and the home page
under 300 KB.

## Languages

- English at `/`, French at `/fr/` (`/fr/confidentialite/`, `/fr/conditions/`). Every page links
  to its twin (`hreflang`, and the EN/FR switch): plain links, so it works without JavaScript.
  There is no automatic redirect; when the browser prefers the other language, a pencil loop
  circles its link.
- Each page exists twice with the same structure: **change both together**.
- French typography: a no-break space (`&nbsp;`) before `:` and inside « », a narrow one
  (`&#8239;`) before `;`, `!` and `?`. The smoke suite checks every French page.
- The Riot line in the footer is the app's, word for word (`ui/src/i18n/en-views.ts` and
  `fr-views.ts`, `about.legal`); the suite compares them.

## How releases appear

1. A tag `vX.Y.Z` runs `.github/workflows/release.yml`, which publishes a GitHub release with
   `MVP_X.Y.Z_x64-setup.exe`, its `.sig` and `latest.json`.
2. Pages read `https://api.github.com/repos/Filmoo/MVP/releases?per_page=30` from the visitor's
   browser (GitHub allows 60 unauthenticated requests an hour per IP address) and keep the answer
   10 minutes in `sessionStorage`, shared by the pages of the tab.
3. **Home**: the newest release that isn't a pre-release, with its asset ending in
   `_x64-setup.exe` → the big button, with the version, date, size (binary MB, `Mo` in French)
   and the SHA-256 GitHub computed, when it has one. A tag with a `-` (`v0.3.0-beta.1`) is a
   pre-release: listed on Versions with a rose stamp, never the home page's download.
4. **Notes**: the release's description on GitHub, as markdown: headings, paragraphs (a newline
   is a line break, as on GitHub), nested lists, bold, italic, strikethrough, code, links,
   autolinks and bare URLs (this repository's `pull/12` → `#12`, `compare/a...b` → `a...b`),
   `@mentions`, `#123`, quotes and rules. Raw HTML shows as text; HTML comments are dropped;
   links keep `https`, `http` and `mailto` only; images become links. The home page shows the
   first eight lines, Versions all of it. The same notes show on the French pages: write them in
   English, or in both languages under two headings.
5. No release yet: "First release soon" and the waiting penguin (a pre-release alone adds a
   pointer to Versions). GitHub unreachable or rate-limited: a link to GitHub's releases. No
   JavaScript: links to GitHub.

## Deploy

The simplest home is the server that already runs `api.mvpgg.com` (OVHcloud VPS, Caddy,
Cloudflare; `deploy/README.md` on the `claude/backend-url` branch): its checkout `/opt/mvp`
already contains `site/public`, so each `mvp-deploy vX.Y.Z` updates the website with the app.
Add this to `/etc/caddy/Caddyfile`, check it with `caddy validate --config
/etc/caddy/Caddyfile`, then `systemctl reload caddy` (not tried against a real Caddy yet;
`handle_errors 404` needs Caddy 2.8 or newer: Caddy's own apt repository has it, Ubuntu 24.04's
package is older):

```caddyfile
mvpgg.com {
	tls /etc/caddy/origin.pem /etc/caddy/origin.key
	root * /opt/mvp/site/public
	encode zstd gzip
	# No `log` directive: no access log for the website (the privacy policy says so).

	header {
		Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), browsing-topics=()"
		Cross-Origin-Opener-Policy "same-origin"
		Cross-Origin-Resource-Policy "same-origin"
		-Server
	}

	# Pages are revalidated every time (ETag), so a deploy shows at once.
	@pages path / *.html */
	header @pages Cache-Control "no-cache"
	# Font files never change under the same name.
	@fonts path /assets/fonts/*
	header @fonts Cache-Control "public, max-age=31536000, immutable"
	# Styles, scripts and drawings: an hour, then revalidated.
	@assets {
		path /assets/* /favicon.svg /robots.txt /sitemap.xml
		not path /assets/fonts/*
	}
	header @assets Cache-Control "public, max-age=3600"

	file_server

	handle_errors 404 {
		@french path /fr /fr/*
		handle @french {
			rewrite * /fr/404.html
			file_server
		}
		handle {
			rewrite * /404.html
			file_server
		}
	}
}

www.mvpgg.com {
	tls /etc/caddy/origin.pem /etc/caddy/origin.key
	redir https://mvpgg.com{uri} permanent
}
```

`serve.mjs` sends the same security headers (keep both in step), and every page also carries the
CSP in a `<meta>` tag, so the rules hold on any host. They forbid inline scripts and styles: keep
everything in `assets/`.

**Cloudflare** (the owner's side, nothing here touches it):
- DNS: proxied (orange cloud) records `@` and `www` to the server, like `api`.
- The origin certificate must cover `mvpgg.com` and `www.mvpgg.com` (Cloudflare's default
  `*.mvpgg.com, mvpgg.com` does; check the one in `/etc/caddy/origin.pem`).
- Leave off everything that rewrites pages or injects scripts: **Email Address Obfuscation**,
  **Rocket Loader**, **Web Analytics** (automatic setup) and **Zaraz**. The CSP would block
  their scripts (console errors), and they would contradict the privacy policy.

Other hosts work too (Cloudflare Pages, any static host): serve `site/public` with the headers
above and the two 404 pages. GitHub Pages can't send headers (the `<meta>` CSP still applies,
without `frame-ancestors`).

## riot.txt

Riot verifies the domain when the product is registered on developer.riotgames.com (research E,
§1.13 and §5.4): the portal gives the text of a file to serve at the site's root. Save it as
`site/public/riot.txt` exactly as given, commit and deploy: Caddy serves it at
`https://mvpgg.com/riot.txt` as `text/plain`. It isn't secret. Riot's review also asks for the
Terms of Service and Privacy Policy, which are here: finish the drafts first (below).

## Before launch

- **Legal drafts**: `privacy/`, `terms/` and their French twins start with an HTML comment
  listing what to fill in (the maintainer's name and country, a contact e-mail, the governing
  law) and what to check. The placeholders show highlighted in brackets. Remove the comment once
  the text is approved.
- The app's own server must match what the policy says (no access logs in Caddy for the site,
  request logs without IP addresses in the backend, reports kept 30 days).

## Fonts

Fraunces (text and titles, variable weight and optical size, soft) and Caveat (notes in the
margins), both SIL Open Font License 1.1, from github.com/google/fonts, cut down to English and
French by `tools/subset_fonts.py` (its docstring has the sources and the command): about 90 KB
together. Their licences sit next to them. Metric-matched local fallbacks (Georgia, Ink Free)
keep the text from moving while they load. No font or anything else comes from another site.
