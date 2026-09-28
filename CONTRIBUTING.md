# Contributing to MVP

MVP is a free, ad-free and open-source League of Legends companion (AGPL-3.0). Contributions are
welcome: fixes, features, translations, design polish, tests.

## The short version

1. Fork the repository and create a branch from `main`.
2. Build and test with no key and no server (below).
3. Run `node scripts/check.mjs full`: every gate must pass, CI runs the same ones.
4. Open a pull request into `main` and explain what changes for the player.

The maintainer reviews every pull request before it is merged. Nothing reaches players or the
server without that review.

## Build and test without any key

You never need a Riot API key, the production server or the League client to work on MVP:

```sh
pnpm install
node scripts/fetch-dev-assets.mjs   # champion and item icons for dev and tests (not committed)
pnpm dev                            # the UI in a browser with mock data (http://127.0.0.1:1420)
pnpm mock-lcu                       # a fake League client for the desktop app (CLAUDE.md, Commands)
node scripts/check.mjs full         # every quality gate
```

Add `?scenario=<name>` to the dev URL to see other states (`ui/src/data/mock/scenarios.ts`). The
Rust tests run the backend and the crawler against fake Riot servers.

For real Riot data, get your own development key at developer.riotgames.com and run your own
backend (`apps/backend/README.md`). Keep the key in an environment variable, never in a file of
the repository.

## Never commit

- **Secrets**: API keys, tokens, passwords, private keys, `.env` files. `scripts/check-secrets.mjs`
  (part of every `check.mjs` run and of CI) blocks the known formats, Riot keys included.
- **Personal data**: fixtures are synthetic. Real captures stay in `.cache/`, which git ignores.
- **Riot assets** (icons, splash art): the app downloads them at run time.

Found a secret in a commit? Don't try to hide it with a new commit: tell the maintainer (see
`SECURITY.md`) so the key can be revoked.

## What the project holds itself to

- **Riot's rules.** Read `docs/policy.md` before touching champion select, other players or
  in-game information: no de-anonymising, no MMR estimates, no enemy timers, no scraping of other
  stat sites.
- **The UI.** Design tokens only (`ui/src/design/tokens.css`), self-contained blocks in
  `<Widget name>`, every word in `ui/src/i18n` in English and French, layouts that hold from
  400 to 2560 px, and no timers, polling or animations while nothing changes.
- **Rust.** No `unwrap()`, no `println!`, clippy pedantic clean.
- **Tests.** Never weaken a test or raise a budget to make a change pass. A budget change goes in
  its own commit with its reason.

`CLAUDE.md` and `docs/architecture.md` explain the layout and the reasons behind these rules.

## Reviews, releases and the server

- Every pull request needs the maintainer's review (`.github/CODEOWNERS`). For first-time
  contributors, CI starts once the maintainer allows it. Pull requests never run with secrets.
- Only the maintainer merges into `main` and tags releases (`vX.Y.Z`). The key that signs app
  updates is only available to the release workflow after the maintainer's approval.
- The server only runs tagged releases of `main` (`deploy/README.md`). Contributors never need
  access to it.

## Licence

By contributing, you agree that your contribution is released under the project's licence, the
GNU Affero General Public License v3.0 (`LICENSE`).

## Security problems

Please don't open a public issue: see `SECURITY.md`.
