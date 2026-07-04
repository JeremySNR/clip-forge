#!/usr/bin/env bash
# Builds the app, seeds a demo project, launches under Xvfb and captures
# screenshots of the home, clips and editor screens.
# Usage: scripts/smoke-test.sh [output-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-.tmp/smoke}"
mkdir -p "$OUT"
npm run build >/dev/null
npx tsx --tsconfig tsconfig.node.json scripts/seed-demo.ts
CLIPFORGE_SMOKE="$(realpath "$OUT")" xvfb-run -a --server-args="-screen 0 1600x1000x24" \
  npx electron . --no-sandbox --disable-gpu
echo "Screenshots written to $OUT"
