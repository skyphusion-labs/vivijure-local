#!/usr/bin/env bash
# Fail when committed dev/manifests/*.json drift from vivijure-cf module MANIFESTs.
#
# Regenerates into a temp dir via scripts/sync-module-manifests.ts, then diffs against
# the committed fixtures. Excludes:
#   - bare-planner.json — deliberate enum-less fixture for gate / e2e (not from sync)
#   - plan-enhance.json — local-only Ollama first-win catalog (Conrad 2026-07-28 / #265);
#     cf keeps the Anthropic/AI Gateway MANIFEST; do not re-sync this file from cf.
#
#   bash scripts/check-module-manifest-drift.sh [vivijure-cf-clone]
#   VIVIJURE_SRC=/path/to/vivijure-cf bash scripts/check-module-manifest-drift.sh
#
# Ride the upstream-parity CI job (already checks out cf main).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${1:-${VIVIJURE_SRC:-$ROOT/../vivijure-cf}}"

if [[ ! -d "$UP/modules" ]]; then
  echo "check-module-manifest-drift: no vivijure-cf modules/ at: $UP" >&2
  echo "check-module-manifest-drift: clone skyphusion-labs/vivijure-cf beside this repo, or set VIVIJURE_SRC, or pass the path" >&2
  exit 2
fi

if [[ ! -d "$ROOT/dev/manifests" ]]; then
  echo "check-module-manifest-drift: missing $ROOT/dev/manifests" >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "check-module-manifest-drift: regenerating from $UP -> $TMP"
# Prefer repo-local tsx when node_modules is present; else npx.
if [[ -x "$ROOT/node_modules/.bin/tsx" ]]; then
  MANIFESTS_OUT="$TMP" VIVIJURE_SRC="$UP" "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/sync-module-manifests.ts"
else
  MANIFESTS_OUT="$TMP" VIVIJURE_SRC="$UP" npx --yes tsx "$ROOT/scripts/sync-module-manifests.ts"
fi

# Space-separated basenames excluded from both directions of the diff.
EXCLUDE_RE='^(bare-planner\.json|plan-enhance\.json)$'
drift=()

excluded() {
  [[ "$1" =~ $EXCLUDE_RE ]]
}

# Committed fixtures (except deliberate local-only / test fixtures) must match regen.
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  excluded "$base" && continue
  if [[ ! -f "$TMP/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT committed $base has no regenerated counterpart (module removed from sync list?)" >&2
    drift+=("$base (orphan)")
    continue
  fi
  if ! diff -q "$ROOT/dev/manifests/$base" "$TMP/$base" >/dev/null 2>&1; then
    echo "check-module-manifest-drift: DRIFT $base" >&2
    diff -u "$ROOT/dev/manifests/$base" "$TMP/$base" 2>&1 | head -80 >&2 || true
    drift+=("$base")
  fi
done < <(cd "$ROOT/dev/manifests" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

# Regenerated modules must be committed (except excluded local-only forks).
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  excluded "$base" && continue
  if [[ ! -f "$ROOT/dev/manifests/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT regenerated $base missing from committed dev/manifests/" >&2
    drift+=("$base (missing)")
  fi
done < <(cd "$TMP" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

if [[ ${#drift[@]} -gt 0 ]]; then
  echo "check-module-manifest-drift: FAIL -- ${#drift[@]} drifting manifest(s): ${drift[*]}" >&2
  echo "check-module-manifest-drift: fix with: VIVIJURE_SRC=$UP npm run module-manifests && git add dev/manifests && commit" >&2
  echo "check-module-manifest-drift: note: plan-enhance.json is local-only (Ollama); do not overwrite from cf" >&2
  exit 1
fi

echo "check-module-manifest-drift: PASS (dev/manifests match vivijure-cf; excluded bare-planner.json plan-enhance.json)"
