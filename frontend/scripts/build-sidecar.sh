#!/usr/bin/env bash
# Build the cortx TUI/CLI binary and copy it to the sidecar location
# with the correct target-triple naming convention required by Tauri.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Get the Rust target triple
TARGET_TRIPLE=$(rustc --print cfg | grep target | sed -e 's/target_//' -e 's/="/-/' -e 's/"$//' | sort | head -4 | paste -sd '-' -)

# Fallback: use rustc -vV which is more reliable
TARGET_TRIPLE=$(rustc -vV | grep host | cut -d' ' -f2)

echo "Building cortx TUI for target: $TARGET_TRIPLE"

# Build the TUI binary in release mode
cd "$FRONTEND_DIR"
cargo build --release -p cortx-tui

# Create the binaries directory
mkdir -p "$FRONTEND_DIR/src-tauri/binaries"

# Determine the binary extension
if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  EXT=".exe"
else
  EXT=""
fi

# Copy to sidecar location with target triple naming
SRC="$FRONTEND_DIR/target/release/cortx${EXT}"
DST="$FRONTEND_DIR/src-tauri/binaries/cortx-${TARGET_TRIPLE}${EXT}"

cp "$SRC" "$DST"
echo "Sidecar binary copied to: $DST"
