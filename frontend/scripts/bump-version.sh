#!/usr/bin/env bash
# Bump the version across all config files in the project.
#
# Usage:
#   ./scripts/bump-version.sh <new-version>
#   ./scripts/bump-version.sh 0.5.0
#
# Files updated:
#   - Cargo.toml                 (workspace.package.version) — all crates inherit this
#   - src-tauri/tauri.conf.json  (root "version" field)
#   - package.json               (root "version" field)

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 0.5.0"
  exit 1
fi

NEW_VERSION="$1"

# Validate semver format (x.y.z with optional pre-release)
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
  echo "Error: Invalid version format '$NEW_VERSION'. Expected semver (e.g. 0.5.0, 1.0.0-beta.1)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- 1. Cargo.toml (workspace) ---
CARGO_TOML="$FRONTEND_DIR/Cargo.toml"
if [ ! -f "$CARGO_TOML" ]; then
  echo "Error: $CARGO_TOML not found"
  exit 1
fi

# Use awk to only replace version inside [workspace.package] section
awk -v new_ver="$NEW_VERSION" '
  /^\[workspace\.package\]/ { in_section=1 }
  /^\[/ && !/^\[workspace\.package\]/ { in_section=0 }
  in_section && /^version[[:space:]]*=/ {
    print "version = \"" new_ver "\""
    next
  }
  { print }
' "$CARGO_TOML" > "$CARGO_TOML.tmp" && mv "$CARGO_TOML.tmp" "$CARGO_TOML"

echo "Updated Cargo.toml (workspace)"

# --- 2. tauri.conf.json + package.json via Node.js ---
# Use node with relative paths from FRONTEND_DIR to avoid Windows/Unix path issues
cd "$FRONTEND_DIR"

node -e "
  const fs = require('fs');
  const path = require('path');
  const version = process.argv[1];

  const files = ['src-tauri/tauri.conf.json', 'package.json'];

  for (const file of files) {
    const filePath = path.resolve(file);
    const content = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(content);
    json.version = version;
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
    console.log('Updated ' + file);
  }
" "$NEW_VERSION"

echo ""
echo "Version bumped to $NEW_VERSION in all config files."
echo "Cargo workspace crates (cortx-core, cortx-tui, cortx-app) inherit this version automatically."
