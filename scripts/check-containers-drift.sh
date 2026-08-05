#!/usr/bin/env bash
# Fail when containers/{video-finish,image-prep,audio-beat-sync,audio-mix,audio-master}
# drift from vivijure-cf without an intentional, documented delta (local#314).
#
# WHY. local#312 landed a Worker route that called POST /frames on video-finish while this
# repo's containers/video-finish/app.py had no such route. Every CI check was green because
# nothing read containers/. scripts/sync-containers.sh can repair the tree but nothing
# invoked it. This is the missing guard: a cf merge that adds a container route (or a dep,
# or a test) must red this door until the mirror is updated or the delta is pinned.
#
# INTENTIONAL DELTAS (exclude + pin-test). Everything else under the five dirs must match cf
# byte-for-byte (excluding __pycache__ / .pyc / .DS_Store).
#
#   containers/README.md
#     Local host docs (compose, no Workers VPC). cf documents GHCR/VPC publish.
#
#   containers/video-finish/Dockerfile
#     Local base is python:3.14 (unconstrained group in .github/dependabot.yml). cf pins
#     3.11 with the numba-frozen set. Cross-repo policy conflict; do not rsync either side.
#
#   containers/image-prep/Dockerfile
#   containers/audio-beat-sync/Dockerfile
#     Base must stay python:3.11 (numba). Local carries longer dependabot-ignore comments
#     after #254; content under the FROM line is free to match or diverge in comments only.
#     Pin-tested on the FROM line, not byte-identity.
#
#   bash scripts/check-containers-drift.sh [vivijure-cf-clone]
#   VIVIJURE_SRC=/path/to/vivijure-cf bash scripts/check-containers-drift.sh
#
# Runs in the containers-drift CI job, which checks out cf main for this script.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UP="${1:-${VIVIJURE_SRC:-$ROOT/../vivijure-cf}}"

DIRS=(video-finish image-prep audio-beat-sync audio-mix audio-master)

if [[ ! -d "$UP/containers/video-finish" ]]; then
  echo "check-containers-drift: no vivijure-cf containers/ at: $UP" >&2
  echo "check-containers-drift: clone skyphusion-labs/vivijure-cf beside this repo, or set VIVIJURE_SRC, or pass the path" >&2
  exit 2
fi

if [[ ! -d "$ROOT/containers" ]]; then
  echo "check-containers-drift: missing $ROOT/containers" >&2
  exit 2
fi

# Paths relative to containers/ that may differ. Exact basenames (files) or "dir/Dockerfile".
is_allowlisted() {
  local rel="$1"
  case "$rel" in
    README.md) return 0 ;;
    video-finish/Dockerfile) return 0 ;;
    image-prep/Dockerfile) return 0 ;;
    audio-beat-sync/Dockerfile) return 0 ;;
    *) return 1 ;;
  esac
}

# Pin tests for allowlisted Dockerfiles: a policy change must fail loudly, not silently.
pin_dockerfiles() {
  local fail=0
  local vf="$ROOT/containers/video-finish/Dockerfile"
  local ip="$ROOT/containers/image-prep/Dockerfile"
  local abs="$ROOT/containers/audio-beat-sync/Dockerfile"

  if ! grep -qE '^FROM python:3\.14' "$vf"; then
    echo "check-containers-drift: PIN FAIL video-finish/Dockerfile must FROM python:3.14 (local unconstrained policy)" >&2
    fail=1
  fi
  if ! grep -qE '^FROM python:3\.11' "$ip"; then
    echo "check-containers-drift: PIN FAIL image-prep/Dockerfile must FROM python:3.11 (numba pin)" >&2
    fail=1
  fi
  if ! grep -qE '^FROM python:3\.11' "$abs"; then
    echo "check-containers-drift: PIN FAIL audio-beat-sync/Dockerfile must FROM python:3.11 (numba pin)" >&2
    fail=1
  fi
  # audio-mix and audio-master are not allowlisted: they must match cf, including FROM.
  return "$fail"
}

drift=()

# Every tracked local path must exist on cf (or be allowlisted).
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  is_allowlisted "$rel" && continue
  if [[ ! -e "$UP/containers/$rel" ]]; then
    echo "check-containers-drift: DRIFT local containers/$rel has no cf counterpart (orphan?)" >&2
    drift+=("$rel (orphan)")
    continue
  fi
  if [[ -f "$ROOT/containers/$rel" && -f "$UP/containers/$rel" ]]; then
    if ! diff -q "$ROOT/containers/$rel" "$UP/containers/$rel" >/dev/null 2>&1; then
      echo "check-containers-drift: DRIFT containers/$rel" >&2
      diff -u "$ROOT/containers/$rel" "$UP/containers/$rel" 2>&1 | head -80 >&2 || true
      drift+=("$rel")
    fi
  fi
done < <(
  cd "$ROOT/containers" &&
  find "${DIRS[@]}" -type f \
    ! -name '*.pyc' ! -path '*/__pycache__/*' ! -name '.DS_Store' \
    | sed 's|^\./||' | sort
)

# Every cf path under the five dirs must be mirrored (or allowlisted).
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  is_allowlisted "$rel" && continue
  if [[ ! -e "$ROOT/containers/$rel" ]]; then
    echo "check-containers-drift: DRIFT cf containers/$rel missing from local (run: npm run sync-containers, then re-apply intentional Dockerfile pins)" >&2
    drift+=("$rel (missing)")
  fi
done < <(
  cd "$UP/containers" &&
  find "${DIRS[@]}" -type f \
    ! -name '*.pyc' ! -path '*/__pycache__/*' ! -name '.DS_Store' \
    | sed 's|^\./||' | sort
)

pin_fail=0
if ! pin_dockerfiles; then
  pin_fail=1
fi

if [[ ${#drift[@]} -gt 0 || "$pin_fail" -ne 0 ]]; then
  if [[ ${#drift[@]} -gt 0 ]]; then
    echo "check-containers-drift: FAIL -- ${#drift[@]} drifting path(s): ${drift[*]}" >&2
    echo "check-containers-drift: fix with: VIVIJURE_SRC=$UP npm run sync-containers" >&2
    echo "check-containers-drift: then restore intentional Dockerfile pins (video-finish 3.14; image-prep/audio-beat-sync 3.11 comments) and README.md" >&2
  fi
  exit 1
fi

echo "check-containers-drift: PASS (content matches vivijure-cf; allowlisted README + 3 Dockerfiles pin-tested)"
