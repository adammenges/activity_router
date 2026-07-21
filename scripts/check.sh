#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUST_TOOLCHAIN_VERSION="1.95.0"
PINNED_RUSTC="$(rustup which --toolchain "$RUST_TOOLCHAIN_VERSION" rustc)"
PINNED_RUST_TOOLCHAIN_BIN="$(dirname -- "$PINNED_RUSTC")"

with_pinned_rust() {
  PATH="$PINNED_RUST_TOOLCHAIN_BIN:$PATH" "$@"
}

echo "==> Checking shell syntax"
for script in scripts/*.sh; do
  bash -n "$script"
done

if command -v node >/dev/null 2>&1; then
  echo "==> Checking JavaScript syntax"
  node --check ui/main.js
fi

echo "==> Checking Rust formatting"
with_pinned_rust cargo fmt --all -- --check

echo "==> Running Clippy"
with_pinned_rust cargo clippy --workspace --all-targets --all-features --locked -- -D warnings

echo "==> Running tests"
with_pinned_rust cargo test --workspace --all-features --locked
