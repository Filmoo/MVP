# syntax=docker/dockerfile:1
# mvp-roadmap image (dev.mvpgg.com). Build from the repository root (it uses the workspace and the
# app's design tokens):
#   docker build -f apps/roadmap/Dockerfile -t mvp-roadmap .
# Run it with the systemd unit in apps/roadmap/deploy (README.md, "Deploy").

# 1. The web UI (Vite), with the app's tokens from ui/src/design.
FROM node:22-bookworm-slim AS web
ENV PNPM_HOME=/pnpm CI=1
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ui/package.json ui/
COPY site/package.json site/
COPY apps/roadmap/web/package.json apps/roadmap/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @scout/roadmap
COPY ui/tsconfig.base.json ui/
COPY ui/src/design/tokens.css ui/src/design/glass.css ui/src/design/
COPY apps/roadmap/web apps/roadmap/web
RUN pnpm --filter @scout/roadmap build

# 2. The service, with the UI inside (release builds embed web/dist).
FROM rust:1.94.1-slim-bookworm AS build
# Use the image's toolchain as is (rust-toolchain.toml would also fetch clippy/rustfmt).
ENV RUSTUP_TOOLCHAIN=1.94.1 CARGO_TERM_COLOR=always
WORKDIR /src
COPY . .
COPY --from=web /src/apps/roadmap/web/dist apps/roadmap/web/dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p mvp-roadmap \
 && cp target/release/mvp-roadmap /mvp-roadmap \
 && mkdir -p /data-skeleton/backups

# 3. glibc + CA certificates (TLS to GitHub), no shell, an unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /mvp-roadmap /usr/local/bin/mvp-roadmap
# The data dir (roadmap.db, backups/) belongs to the nonroot user, so a fresh named volume mounted
# on /data inherits a writable owner.
COPY --from=build --chown=65532:65532 /data-skeleton /data
ENV ROADMAP_BIND=0.0.0.0:8790 ROADMAP_DB=/data/roadmap.db ROADMAP_TRUST_PROXY=1 RUST_LOG=info LOG_FORMAT=json
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/mvp-roadmap", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/mvp-roadmap"]
CMD ["serve"]
