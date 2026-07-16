#!/usr/bin/env bash
# Fail when copy surfaces drift from skyphusion-labs/vivijure-cf main (the CF studio host; the old
# monolith skyphusion-labs/vivijure was retired into a constellation hub and no longer carries public/).
#
# Default (CI): public/ only -- the studio UI projection must not go stale while CF-native v1 ships.
# Optional --verbatim: also migrations/ and ../vivijure-core/src/modules/types.ts.
#
#   VIVIJURE_SRC=../vivijure-cf npm run upstream:parity
#   VIVIJURE_SRC=../vivijure-cf npm run upstream:parity:verbatim
#   bash scripts/upstream-public-parity.sh /path/to/vivijure [--verbatim]

set -euo pipefail

UP=""
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --verbatim) STRICT=1 ;;
    -h|--help)
      echo "usage: upstream-public-parity.sh <vivijure-clone> [--verbatim]" >&2
      exit 0
      ;;
    *)
      if [[ -z "$UP" ]]; then UP="$arg"; else
        echo "unexpected arg: $arg" >&2
        exit 2
      fi
      ;;
  esac
done

UP="${UP:-${VIVIJURE_SRC:-}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "$UP" || ! -d "$UP/public" ]]; then
  echo "upstream-public-parity: set VIVIJURE_SRC or pass path to vivijure clone" >&2
  exit 2
fi

TRACKED=(public)
if [[ $STRICT -eq 1 ]]; then
  TRACKED+=(migrations)
fi

# Files that are local-only end to end: the platform-secrets Settings UI, which vivijure-cf
# does not have (it uses Workers secrets). Everything else in public/ is shared and is checked
# verbatim -- including styles.css, whose local rules were split out into settings-secrets.css
# precisely so the shared stylesheet has nothing local left to protect (#92).
#
# Only add a file here if it is local-only END TO END. A file that mixes shared and local content
# must be split instead: skipping it exempts the shared part and the gate goes quietly blind (#90).
# settings.html / settings.js still need a hand-merge when upstream touches their shared shell.
LOCAL_PUBLIC_SKIP=(
  public/settings.html
  public/settings.js
  public/settings-secrets.css
)

fail=0
for rel in "${TRACKED[@]}"; do
  if [[ ! -e "$UP/$rel" ]]; then
    echo "upstream-public-parity: missing upstream: $rel" >&2
    fail=1
    continue
  fi
  if [[ ! -e "$ROOT/$rel" ]]; then
    echo "upstream-public-parity: missing local: $rel" >&2
    fail=1
    continue
  fi
  if [[ "$rel" == "public" ]]; then
    drift_files=()
    while IFS= read -r base; do
      [[ -z "$base" ]] && continue
      local_rel="public/$base"
      skip=0
      for s in "${LOCAL_PUBLIC_SKIP[@]}"; do
        [[ "$local_rel" == "$s" ]] && skip=1 && break
      done
      if [[ $skip -eq 1 ]]; then
        echo "upstream-public-parity: SKIP (local overlay) $local_rel"
        continue
      fi
      if [[ ! -f "$UP/public/$base" ]]; then
        echo "upstream-public-parity: DRIFT missing upstream public/$base" >&2
        drift_files+=("$base")
        continue
      fi
      if ! diff -q "$UP/public/$base" "$ROOT/public/$base" >/dev/null 2>&1; then
        drift_files+=("$base")
      fi
    done < <(cd "$ROOT/public" && find . -type f | sed 's|^\./||' | sort)
    if [[ ${#drift_files[@]} -gt 0 ]]; then
      echo "upstream-public-parity: DRIFT public (vivijure-cf main vs this repo)" >&2
      for base in "${drift_files[@]}"; do
        echo "Files $UP/public/$base and $ROOT/public/$base differ" >&2
      done
      echo "--- unified diff (first 120 lines) ---" >&2
      for base in "${drift_files[@]}"; do
        if [[ -f "$UP/public/$base" ]]; then
          diff -u "$UP/public/$base" "$ROOT/public/$base" 2>&1 | head -120 >&2 || true
        fi
      done
      fail=1
    else
      echo "upstream-public-parity: OK public (excluding ${#LOCAL_PUBLIC_SKIP[@]} local-only files: ${LOCAL_PUBLIC_SKIP[*]#public/})"
    fi
    continue
  fi
  if diff -rq "$UP/$rel" "$ROOT/$rel" >/dev/null 2>&1; then
    echo "upstream-public-parity: OK $rel"
    continue
  fi
  echo "upstream-public-parity: DRIFT $rel (vivijure main vs this repo)" >&2
  diff -rq "$UP/$rel" "$ROOT/$rel" >&2 || true
  echo "--- unified diff (first 120 lines) ---" >&2
  diff -ru "$UP/$rel" "$ROOT/$rel" 2>&1 | head -120 >&2 || true
  fail=1
done

if [[ $STRICT -eq 1 ]]; then
  up_types="src/modules/types.ts"
  local_types="../vivijure-core/src/modules/types.ts"
  label="module contract (vivijure $up_types vs vivijure-core $local_types)"
  core_abs="$(cd "$ROOT/.." && pwd)/vivijure-core/src/modules/types.ts"
  if [[ ! -e "$UP/$up_types" ]]; then
    echo "upstream-public-parity: missing upstream: $up_types" >&2
    fail=1
  elif [[ ! -e "$core_abs" ]]; then
    echo "upstream-public-parity: missing local: $core_abs" >&2
    fail=1
  elif diff -q "$UP/$up_types" "$core_abs" >/dev/null 2>&1; then
    echo "upstream-public-parity: OK $label"
  else
    echo "upstream-public-parity: DRIFT $label" >&2
    diff -ru "$UP/$up_types" "$core_abs" 2>&1 | head -120 >&2 || true
    fail=1
  fi
fi

if [[ $fail -ne 0 ]]; then
  echo "upstream-public-parity: FAIL -- run scripts/sync-from-vivijure.sh, merge, and commit" >&2
  exit 1
fi

if [[ $STRICT -eq 1 ]]; then
  echo "upstream-public-parity: PASS (public/ + verbatim surfaces match vivijure-cf main; not compared: ${LOCAL_PUBLIC_SKIP[*]#public/})"
else
  echo "upstream-public-parity: PASS (public/ matches vivijure-cf main; not compared: ${LOCAL_PUBLIC_SKIP[*]#public/})"
fi
