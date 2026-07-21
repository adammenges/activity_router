#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAURI_CLI_VERSION="${TAURI_CLI_VERSION:-2.11.4}"
RUST_TOOLCHAIN_VERSION="1.95.0"

if ! command -v rustup >/dev/null 2>&1; then
  echo "error: rustup is required. Install it from https://rustup.rs and rerun this script." >&2
  exit 1
fi

rustup toolchain install "$RUST_TOOLCHAIN_VERSION" --profile minimal --component rustfmt --component clippy

PINNED_RUSTC="$(rustup which --toolchain "$RUST_TOOLCHAIN_VERSION" rustc)"
PINNED_RUST_TOOLCHAIN_BIN="$(dirname -- "$PINNED_RUSTC")"

with_pinned_rust() {
  PATH="$PINNED_RUST_TOOLCHAIN_BIN:$PATH" "$@"
}

INSTALLED_TAURI_VERSION="$(with_pinned_rust cargo tauri --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$INSTALLED_TAURI_VERSION" != "$TAURI_CLI_VERSION" ]]; then
  echo "Installing Tauri CLI $TAURI_CLI_VERSION..."
  with_pinned_rust cargo install tauri-cli --version "$TAURI_CLI_VERSION" --locked
fi

if [[ "${OSTYPE:-}" == darwin* ]]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    echo "error: Xcode Command Line Tools are required. Run: xcode-select --install" >&2
    exit 1
  fi

  rustup target add aarch64-apple-darwin x86_64-apple-darwin --toolchain "$RUST_TOOLCHAIN_VERSION"
else
  echo "note: macOS packaging requires a macOS host."
fi

echo "Fetching locked dependencies..."
with_pinned_rust cargo fetch --locked
echo "Setup complete. Run ./scripts/dev.sh to launch the app."
