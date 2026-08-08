#!/usr/bin/env bash
# Fail when committed dev/manifests/*.json drift from vivijure-cf module MANIFESTs.
#
# Regenerates into a temp dir via scripts/sync-module-manifests.ts, then diffs against
# the committed fixtures.
#
# Local-only / synthetic fixtures are discovered from a MARKER IN THE FILE itself
# (local#313), not a hand list here that drifts from institutional memory:
#   "_local_divergence": "do-not-sync"
# plan-enhance.json (Ollama first-win, #265) and bare-planner.json (synthetic enum-less
# fixture) carry that marker. The regenerator refuses to overwrite them too.
#
#   bash scripts/check-module-manifest-drift.sh [vivijure-cf-clone]
#   VIVIJURE_SRC=/path/to/vivijure-cf bash scripts/check-module-manifest-drift.sh
#
# CI (manifest-drift.yml) checks out vivijure-cf at the SHA in dev/cf-manifest-pin
# (local#313). Do not float on cf main for PR CI.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${1:-${VIVIJURE_SRC:-$ROOT/../vivijure-cf}}"
PIN_FILE="$ROOT/dev/cf-manifest-pin"

if [[ ! -d "$UP/modules" ]]; then
  echo "check-module-manifest-drift: no vivijure-cf modules/ at: $UP" >&2
  echo "check-module-manifest-drift: clone skyphusion-labs/vivijure-cf beside this repo, or set VIVIJURE_SRC, or pass the path" >&2
  exit 2
fi

if [[ ! -d "$ROOT/dev/manifests" ]]; then
  echo "check-module-manifest-drift: missing $ROOT/dev/manifests" >&2
  exit 2
fi

# Surface which cf tree we are comparing against (pin or live clone), so a red
# names cf as the source rather than reading as "your branch is broken".
cf_ref="unknown"
if [[ -d "$UP/.git" ]] || git -C "$UP" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  cf_ref="$(git -C "$UP" rev-parse HEAD 2>/dev/null || echo unknown)"
fi
pin_sha=""
if [[ -f "$PIN_FILE" ]]; then
  pin_sha=$(grep -E '^SHA=' "$PIN_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
fi
echo "check-module-manifest-drift: comparing against vivijure-cf@$cf_ref"
if [[ -n "$pin_sha" ]]; then
  echo "check-module-manifest-drift: local pin (dev/cf-manifest-pin) SHA=$pin_sha"
  if [[ "$cf_ref" != "unknown" && "$cf_ref" != "$pin_sha" ]]; then
    echo "check-module-manifest-drift: NOTE -- checkout HEAD ($cf_ref) differs from pin ($pin_sha)." >&2
    echo "check-module-manifest-drift: CI uses the pin; local ad-hoc runs may use a sibling clone." >&2
  fi
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

# Discover deliberate divergences from markers in the committed fixtures (local#313).
# A file is excluded when it carries "_local_divergence": "do-not-sync" (string or true).
is_local_divergence() {
  local f="$ROOT/dev/manifests/$1"
  [[ -f "$f" ]] || return 1
  # Prefer node (always present in CI after setup-node); fall back to a tiny grep.
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      let j;
      try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
      catch { process.exit(1); }
      const v = j && j._local_divergence;
      process.exit(v === "do-not-sync" || v === true ? 0 : 1);
    ' "$f"
  else
    grep -qE '"_local_divergence"[[:space:]]*:[[:space:]]*("do-not-sync"|true)' "$f"
  fi
}

drift=()
excluded_list=()

# Committed fixtures (except deliberate local-only / test fixtures) must match regen.
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  if is_local_divergence "$base"; then
    excluded_list+=("$base")
    continue
  fi
  if [[ ! -f "$TMP/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT committed $base has no regenerated counterpart (module removed from sync list?)" >&2
    drift+=("$base (orphan)")
    continue
  fi
  if ! diff -q "$ROOT/dev/manifests/$base" "$TMP/$base" >/dev/null 2>&1; then
    echo "check-module-manifest-drift: DRIFT $base (committed vs vivijure-cf@$cf_ref)" >&2
    diff -u "$ROOT/dev/manifests/$base" "$TMP/$base" 2>&1 | head -80 >&2 || true
    drift+=("$base")
  fi
done < <(cd "$ROOT/dev/manifests" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

# Regenerated modules must be committed (except excluded local-only forks).
while IFS= read -r base; do
  [[ -z "$base" ]] && continue
  # If the committed file is a marked divergence, skip (regen may have produced a cf shape).
  if is_local_divergence "$base"; then
    continue
  fi
  if [[ ! -f "$ROOT/dev/manifests/$base" ]]; then
    echo "check-module-manifest-drift: DRIFT regenerated $base missing from committed dev/manifests/" >&2
    drift+=("$base (missing)")
  fi
done < <(cd "$TMP" && find . -maxdepth 1 -name '*.json' -type f | sed 's|^\./||' | sort)

if [[ ${#excluded_list[@]} -gt 0 ]]; then
  echo "check-module-manifest-drift: local-divergence (marker _local_divergence=do-not-sync): ${excluded_list[*]}"
fi

if [[ ${#drift[@]} -gt 0 ]]; then
  echo "check-module-manifest-drift: FAIL -- ${#drift[@]} drifting manifest(s): ${drift[*]}" >&2
  echo "check-module-manifest-drift: compared against vivijure-cf@$cf_ref (not your local PR diff alone)." >&2
  echo "check-module-manifest-drift: if this red appeared with no change on this repo, a cf pin bump or" >&2
  echo "check-module-manifest-drift: an out-of-date pin is the cause (local#313) -- not your feature branch." >&2
  echo "check-module-manifest-drift: refresh pin + regenerate:" >&2
  echo "check-module-manifest-drift:   1. set SHA=<cf-commit> in dev/cf-manifest-pin" >&2
  echo "check-module-manifest-drift:   2. VIVIJURE_SRC=/path/to/vivijure-cf@that-sha npm run module-manifests" >&2
  echo "check-module-manifest-drift:   3. git add dev/cf-manifest-pin dev/manifests && commit" >&2
  echo "check-module-manifest-drift: files with \"_local_divergence\": \"do-not-sync\" are never overwritten." >&2
  exit 1
fi

excl_msg="(none)"
if [[ ${#excluded_list[@]} -gt 0 ]]; then
  excl_msg="${excluded_list[*]}"
fi
echo "check-module-manifest-drift: PASS (dev/manifests match vivijure-cf@$cf_ref; local-divergence: $excl_msg)"
