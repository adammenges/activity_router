#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

status=0
RUST_TOOLCHAIN_VERSION="1.95.0"

check_command() {
  local command="$1"
  if command -v "$command" >/dev/null 2>&1; then
    printf 'ok    %-14s %s\n' "$command" "$(command -v "$command")"
  else
    printf 'miss  %-14s required\n' "$command"
    status=1
  fi
}

check_command cargo
check_command rustc
check_command rustup

if command -v rustup >/dev/null 2>&1 \
  && PINNED_RUSTC="$(rustup which --toolchain "$RUST_TOOLCHAIN_VERSION" rustc 2>/dev/null)"; then
  PINNED_RUST_TOOLCHAIN_BIN="$(dirname -- "$PINNED_RUSTC")"
  with_pinned_rust() {
    PATH="$PINNED_RUST_TOOLCHAIN_BIN:$PATH" "$@"
  }
  printf 'ok    %-14s %s\n' "pinned rust" "$("$PINNED_RUSTC" --version)"
else
  printf 'miss  %-14s run: ./scripts/setup.sh\n' "pinned rust"
  status=1
fi

if [[ "${OSTYPE:-}" == darwin* ]]; then
  check_command xcode-select
  if xcode-select -p >/dev/null 2>&1; then
    printf 'ok    %-14s %s\n' "xcode tools" "$(xcode-select -p)"
  else
    printf 'miss  %-14s run: xcode-select --install\n' "xcode tools"
    status=1
  fi
fi

if declare -f with_pinned_rust >/dev/null && with_pinned_rust cargo tauri --version >/dev/null 2>&1; then
  printf 'ok    %-14s %s\n' "tauri" "$(with_pinned_rust cargo tauri --version)"
else
  printf 'miss  %-14s run: ./scripts/setup.sh\n' "tauri"
  status=1
fi

if declare -f with_pinned_rust >/dev/null \
  && with_pinned_rust cargo metadata --locked --no-deps --format-version 1 >/dev/null 2>&1; then
  printf 'ok    %-14s valid and locked\n' "workspace"
else
  printf 'fail  %-14s metadata or Cargo.lock is stale\n' "workspace"
  status=1
fi

exit "$status"
