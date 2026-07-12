#!/usr/bin/env bash
# Extract MANIFEST JSON from vivijure module workers into dev/manifests/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec npx tsx "$ROOT/scripts/sync-module-manifests.ts" "$@"
