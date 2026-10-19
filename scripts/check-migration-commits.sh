#!/usr/bin/env bash
#
# Migration commit guard (local#392).
#
# Inspects commits reachable from <head> and not from <base>: the pull-request
# commits that are not already on main, or the commits a push just introduced.
# History already reachable from <base> is out of scope. 341598e is on main and
# is not judged again; there is no sha allowlist.
#
#   1. A commit that touches migrations/ must not have a subject starting with
#      ci:, docs:, or chore:. A conventional scope and a breaking-change bang
#      are the same type: ci(db): and chore(deps)!: count.
#   2. A commit must not change a path under migrations/ that already exists on
#      <base>. A new file is allowed. A correction belongs in a new forward
#      migration.
#
# Merge commits use the combined diff (--cc). A clean merge of main would
# otherwise look like the merge commit added main's new migration, and that
# file exists on the base, so the guard would fail an ordinary update.
# Combined diff is empty for a clean merge and shows a path only when the
# merge result differs from both parents.
#
# Usage: bash scripts/check-migration-commits.sh <base> <head>

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: check-migration-commits.sh <base> <head>" >&2
  exit 2
fi

base=$(git rev-parse --verify "${1}^{commit}")
head=$(git rev-parse --verify "${2}^{commit}")

fail=0

note() {
  printf '%s\n' "$1" >&2
  fail=1
}

# ci:, docs:, chore:, plus optional (scope) and an optional ! before the colon.
forbidden_subject() {
  printf '%s\n' "$1" | grep -Eqi '^(ci|docs|chore)(\([^)]*\))?!?:'
}

is_migration_path() {
  case "$1" in
    migrations | migrations/*) return 0 ;;
    *) return 1 ;;
  esac
}

on_base() {
  git cat-file -e "${base}:${1}" 2>/dev/null
}

# NUL-delimited name-status. Rename/copy records carry two paths.
# Printed to stdout for the caller to parse. Merge commits: combined diff.
name_status() {
  local commit="$1"
  local parents first count
  parents=$(git show -s --format=%P "$commit")
  count=$(printf '%s\n' "$parents" | wc -w | tr -d '[:space:]')
  if [ "$count" -gt 1 ]; then
    git diff-tree --cc --name-status --no-commit-id -r -z "$commit"
  elif [ "$count" -eq 1 ]; then
    first=${parents%% *}
    # git diff exits 1 when there is a diff. That is data, not a failed instrument.
    git diff --name-status --find-renames -z "$first" "$commit" || test $? -eq 1
  else
    git diff-tree --root --name-status --find-renames --no-commit-id -r -z "$commit"
  fi
}

check_commit() {
  local commit="$1"
  local subject short status path
  local touched=0
  subject=$(git show -s --format=%s "$commit")
  short=$(git rev-parse --short "$commit")

  while IFS= read -r -d '' status; do
    case "$status" in
      R* | C*)
        IFS= read -r -d '' path || {
          note "migration-commits: FAIL could not parse rename record in ${short}"
          return 0
        }
        consider "$short" "$subject" "$path"
        IFS= read -r -d '' path || {
          note "migration-commits: FAIL could not parse rename record in ${short}"
          return 0
        }
        consider "$short" "$subject" "$path"
        ;;
      *)
        IFS= read -r -d '' path || {
          note "migration-commits: FAIL could not parse name-status record in ${short}"
          return 0
        }
        consider "$short" "$subject" "$path"
        ;;
    esac
  done < <(name_status "$commit")

  if [ "$touched" -eq 1 ] && forbidden_subject "$subject"; then
    note "migration-commits: FAIL ${short} touches migrations/ and its subject starts with ci:, docs:, or chore:."
    note "  subject: ${subject}"
    note "  The subject is the index into the history. Use feat(db): or fix(db): so a schema change is findable."
  fi
}

# `touched` is local to check_commit. Bash locals are visible to a callee
# that does not redeclare them, and the name-status read loop is a process
# substitution, not a pipeline, so this assignment is not discarded.
consider() {
  local short="$1" subject="$2" path="$3"
  if ! is_migration_path "$path"; then
    return 0
  fi
  touched=1
  if on_base "$path"; then
    note "migration-commits: FAIL ${short} changes ${path} which already exists on ${base}."
    note "  subject: ${subject}"
    note "  That file is applied history. Add a new forward migration; do not edit this one."
  fi
}

count=0
while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  count=$((count + 1))
  check_commit "$commit"
done < <(git rev-list --reverse "${base}..${head}")

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "migration-commits: PASS (${count} commit(s) not already on the base)"
exit 0
