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
# THE LIST LIVES IN scripts/containers-local-divergence.txt, AND scripts/sync-containers.sh READS
# THE SAME FILE (local#489). Before that, this script allowlisted the paths below while the sync
# rsync'd over them with --delete, and this script then reported PASS on the overwritten tree: the
# loop skipped the paths in both directions and the FROM-line pin matched cf's file too. Now the sync
# never writes a listed path, and a listed path that has become BYTE-IDENTICAL to cf is a FAIL here,
# because an intentional delta that no longer differs means either something overwrote it or the
# delta is gone and its line should be removed. Either way the list is no longer true.
#
#   containers/README.md
#     Local host docs (compose, no Workers VPC). cf documents GHCR/VPC publish.
#
#   containers/video-finish/Dockerfile
#     Base must stay python:3.11 on BOTH sides (cf parity, local#316 / PR #358). There is no
#     longer a python delta here. This path stays allowlisted only because local carries a
#     longer comment block recording that 3.14 was built cleanly twice and still rejected.
#     Content under the FROM line is free to diverge in comments only.
#
#   containers/image-prep/Dockerfile
#     Base must stay python:3.11 (numba). Local carries longer dependabot-ignore comments
#     after #254; content under the FROM line is free to match or diverge in comments only.
#     Pin-tested on the FROM line, not byte-identity.
#
#   containers/audio-beat-sync/Dockerfile
#     Not allowlisted. librosa 1.0 requires Python >=3.12 and numba still rejects 3.14,
#     so cf's Dockerfile is python:3.12. A local 3.11 pin cannot install that requirements
#     file. Byte-identity is the guard, including the FROM line.
#
#   bash scripts/check-containers-drift.sh [vivijure-cf-clone]
#   VIVIJURE_SRC=/path/to/vivijure-cf bash scripts/check-containers-drift.sh
#
# Runs in the containers-drift CI job, which checks out cf main for this script.
#
# THE CI JOB COMPARES AGAINST FLOATING cf main, AND THAT IS THE DESIGN (local#403).
# This is a parity guard. If it reds with no change on this side, cf moved and the
# drift is REAL: absorb it with a deliberate sync PR. Do NOT pin cf to a sha to green
# it -- local#362 proposed exactly that for the sibling manifest guard and it was
# refused, because a pin selects a reference point at which the gap is invisible and
# the guard stops being able to go red on the thing it exists for.
#
# WHAT local#482 CHANGED was the SCOPE, not the ref: the workflow runs this on every
# push to main and daily on a schedule, and on a pull request ONLY when that PR edits
# one of the five DIRS below or this script. A parity fact is a property of main and of
# cf, so asserting it against every PR made unrelated authors hostage to cf merges.
#
# That scoping lives INSIDE the job, in a WATCHED regex, not in an on.pull_request.paths
# filter. A paths filter reports no status at all, which strands a required check on
# "Expected -- waiting for status". Deciding in-job always reports a status, and the
# skip is printed loudly because a green that compared nothing must say so.
#
# DIRS BELOW AND THAT WATCHED REGEX MUST STAY IN STEP. It lists these five directories,
# not containers/**, because containers/ holds unguarded dirs too (cast-image), and a
# containers/** filter would re-run this on PRs it cannot speak to.

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

# Paths relative to containers/ that may differ, from the ONE list both tools read (local#489).
LIST="$ROOT/scripts/containers-local-divergence.txt"
if [[ ! -f "$LIST" ]]; then
  # Fail closed: with no list nothing is allowlisted, and saying why beats a wall of drift.
  echo "check-containers-drift: missing $LIST (the divergence list sync-containers.sh also reads)" >&2
  exit 2
fi
ALLOWLIST=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(printf '%s' "$line" | tr -d '[:space:]')"
  [[ -n "$line" ]] && ALLOWLIST+=("$line")
done < "$LIST"
if [[ ${#ALLOWLIST[@]} -eq 0 ]]; then
  echo "check-containers-drift: $LIST lists no paths; refusing to read that as a deliberate choice" >&2
  exit 2
fi

is_allowlisted() {
  local rel="$1" a
  for a in "${ALLOWLIST[@]}"; do
    [[ "$rel" == "$a" ]] && return 0
  done
  return 1
}

# Pin tests for allowlisted Dockerfiles: a policy change must fail loudly, not silently.
pin_dockerfiles() {
  local fail=0
  local vf="$ROOT/containers/video-finish/Dockerfile"
  local ip="$ROOT/containers/image-prep/Dockerfile"

  if ! grep -qE '^FROM python:3\.11' "$vf"; then
    echo "check-containers-drift: PIN FAIL video-finish/Dockerfile must FROM python:3.11 (cf parity, local#316)" >&2
    fail=1
  fi
  if ! grep -qE '^FROM python:3\.11' "$ip"; then
    echo "check-containers-drift: PIN FAIL image-prep/Dockerfile must FROM python:3.11 (numba pin)" >&2
    fail=1
  fi
  # audio-beat-sync, audio-mix, and audio-master are not allowlisted: they must match cf, including FROM.
  return "$fail"
}

drift=()

# A listed path must exist here AND still differ from cf. Identical means the delta is gone: an
# overwrite (the local#489 shape) or a real convergence. Both make the list false, so both fail.
for rel in "${ALLOWLIST[@]}"; do
  if [[ ! -f "$ROOT/containers/$rel" ]]; then
    echo "check-containers-drift: DRIFT listed local delta containers/$rel does not exist here (stale line in $LIST)" >&2
    drift+=("$rel (listed, absent)")
    continue
  fi
  if [[ -f "$UP/containers/$rel" ]] && cmp -s "$ROOT/containers/$rel" "$UP/containers/$rel"; then
    echo "check-containers-drift: DRIFT listed local delta containers/$rel is BYTE-IDENTICAL to cf: something overwrote the local content, or the delta is gone and its line in $LIST should go" >&2
    drift+=("$rel (listed, identical to cf)")
  fi
done

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
    echo "check-containers-drift: DRIFT cf containers/$rel missing from local (run: npm run sync-containers)" >&2
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
    echo "check-containers-drift: the sync does not touch paths in $LIST; a listed path reported identical to cf must be restored from git (git checkout -- containers/<path>)" >&2
  fi
  exit 1
fi

echo "check-containers-drift: PASS (content matches vivijure-cf; ${#ALLOWLIST[@]} listed local deltas present and still differing, Dockerfiles pin-tested)"
