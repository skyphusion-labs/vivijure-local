#!/usr/bin/env bash
# Fail when copy surfaces drift from skyphusion-labs/vivijure main.
#
# Default (CI): public/ only -- the studio UI projection must not go stale while CF-native v1 ships.
# Optional --verbatim: also migrations/ and src/modules/types.ts (scripts/sync-from-vivijure.sh).
#
#   VIVIJURE_SRC=../vivijure npm run upstream:parity
#   VIVIJURE_SRC=../vivijure npm run upstream:parity:verbatim
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
  TRACKED+=(migrations src/modules/types.ts)
fi

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

if [[ $fail -ne 0 ]]; then
  echo "upstream-public-parity: FAIL -- run scripts/sync-from-vivijure.sh, merge, and commit" >&2
  exit 1
fi

if [[ $STRICT -eq 1 ]]; then
  echo "upstream-public-parity: PASS (public + verbatim surfaces match vivijure main)"
else
  echo "upstream-public-parity: PASS (public/ matches vivijure main)"
fi
