# syntax=docker/dockerfile:1
# mvp-crawler image. Build from the repository root (the crawler uses workspace crates):
#   docker build -f apps/crawler/Dockerfile -t mvp-crawler .
#   docker run --rm -v mvp-crawl:/crawl -e RIOT_API_KEY=RGAPI-… mvp-crawler crawl --max-matches 2000
#   docker run --rm -v mvp-crawl:/crawl -v mvp-data:/data mvp-crawler publish --out /data/stats
# A scheduled deployment (systemd timer, optional R2 sync): apps/crawler/README.md.

FROM rust:1.94.1-slim-bookworm AS build
ENV RUSTUP_TOOLCHAIN=1.94.1 CARGO_TERM_COLOR=always
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p mvp-crawler \
 && cp target/release/mvp-crawler /mvp-crawler \
 && mkdir -p /crawl-skeleton

# glibc + CA certificates (TLS to Riot and Data Dragon), no shell, unprivileged.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /mvp-crawler /usr/local/bin/mvp-crawler
COPY --from=build --chown=65532:65532 /crawl-skeleton /crawl
ENV CRAWL_DATA_DIR=/crawl RUST_LOG=info
VOLUME /crawl
ENTRYPOINT ["/usr/local/bin/mvp-crawler"]
