#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDS="$ROOT/dev/module-fleet.pids"
if [[ -f "$PIDS" ]]; then
  while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done <"$PIDS"
  rm -f "$PIDS"
fi
echo "module fleet stopped"
