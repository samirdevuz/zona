#!/usr/bin/env bash
# Install dependencies if missing, build if sources changed, start the ZONA server.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "[ZONA] Node.js not found. Install Node.js 22 LTS from https://nodejs.org" >&2
  exit 1
fi
if ! node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"; then
  echo "[ZONA] Node.js is too old. Install Node.js 22 LTS." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "[ZONA] First run: installing dependencies..."
  npm install
fi
if node scripts/needs-build.mjs; then
  echo "[ZONA] Building..."
  npm run build
fi
exec npm start
