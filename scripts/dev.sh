#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUST_TOOLCHAIN_VERSION="1.95.0"
PINNED_RUSTC="$(rustup which --toolchain "$RUST_TOOLCHAIN_VERSION" rustc)"
PINNED_RUST_TOOLCHAIN_BIN="$(dirname -- "$PINNED_RUSTC")"

PATH="$PINNED_RUST_TOOLCHAIN_BIN:$PATH" cargo tauri dev -- --locked
