# Security policy

MVP runs on players' PCs and updates itself, so security reports matter a lot to us.

## Reporting a vulnerability

Report it privately on GitHub: this repository's **Security** tab → **Report a vulnerability**.
Please don't open a public issue or pull request for a security problem.

Tell us what you found, how to reproduce it, the version or commit it affects, and the impact you
expect. MVP is a volunteer project: we aim to answer within a week, fix serious problems first,
and publish the details together once a fix is out. We credit reporters who want to be credited.

## Scope

- The desktop app: `apps/desktop`, `crates/`, `ui/`.
- The backend and the crawler (`apps/backend`, `apps/crawler`) and how they are deployed (`deploy/`).
- The release and update pipeline: `.github/workflows`, update signing.

Out of scope: Riot Games' services and the League client (report those to Riot), our hosting
providers' infrastructure, social engineering and denial of service. Never test against the
production server (`api.mvpgg.com`) with scanners or load tests: run your own backend instead
(`apps/backend/README.md`).

## Guarantees by design

- The Riot API key lives only on the server. The app and this repository never contain it.
- App updates are signed. Installed apps refuse any update not signed with the project's key,
  which only the release workflow can use, after the maintainer's approval.
- Pull requests never run with secrets. Only the maintainer merges, tags releases and deploys.
- The server accepts web traffic from Cloudflare only and SSH logins with keys only.
