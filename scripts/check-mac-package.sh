#!/usr/bin/env bash
# Run from a normal GUI session, outside an agent's restrictive tool sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-release/mac-arm64/Cutawan.app}"
OUT="${2:-.tmp/mac-package-check}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CUTAWAN_USER_DATA="$OUT/profile" CUTAWAN_PACKAGE_CHECK="$OUT/pipeline" \
  "$APP/Contents/MacOS/Cutawan"
CUTAWAN_USER_DATA="$OUT/wizard-profile" CUTAWAN_SMOKE="$OUT" CUTAWAN_SMOKE_WIZARD=1 \
  "$APP/Contents/MacOS/Cutawan"
CUTAWAN_USER_DATA="$OUT/update-profile" CUTAWAN_SMOKE="$OUT" \
  CUTAWAN_SMOKE_UPDATES=1 CUTAWAN_FAKE_LATEST=99.0.0 \
  "$APP/Contents/MacOS/Cutawan"
