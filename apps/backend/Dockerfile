# syntax=docker/dockerfile:1
# mvp-backend image. Build from the repository root (the service uses workspace crates):
#   docker build -f apps/backend/Dockerfile -t mvp-backend .
#   docker run -p 127.0.0.1:8787:8787 -v mvp-data:/data -e RIOT_API_KEY=RGAPI-… mvp-backend

FROM rust:1.94.1-slim-bookworm AS build
# Use the image's toolchain as is (rust-toolchain.toml would also fetch clippy/rustfmt).
ENV RUSTUP_TOOLCHAIN=1.94.1 CARGO_TERM_COLOR=always
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p mvp-backend \
 && cp target/release/mvp-backend /mvp-backend \
 && mkdir -p /data-skeleton/reports /data-skeleton/cache

# glibc + CA certificates (for TLS to Riot), no shell, runs as an unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /mvp-backend /usr/local/bin/mvp-backend
# The data dir (releases.json, config.json, reports/, cache/) belongs to the nonroot user, so
# a fresh named volume mounted on /data inherits a writable owner.
COPY --from=build --chown=65532:65532 /data-skeleton /data
ENV BIND=0.0.0.0:8787 DATA_DIR=/data RUST_LOG=info LOG_FORMAT=json TRUST_PROXY=1
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/mvp-backend", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/mvp-backend"]
