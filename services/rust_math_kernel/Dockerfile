# Stage 1: Native Rust Release Builder
FROM rust:slim-bookworm AS builder

WORKDIR /app

# Cache crate dependencies first
COPY Cargo.toml ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

# Copy actual Rust kernel source and build optimized binary
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Minimal Debian Bookworm Runtime Image
FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/target/release/swrt-rust-kernel /usr/local/bin/swrt-rust-kernel

ENV PORT=4001
ENV RUST_BACKTRACE=1

EXPOSE 4001

CMD ["/usr/local/bin/swrt-rust-kernel"]
