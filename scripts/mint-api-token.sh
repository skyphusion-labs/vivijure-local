#!/usr/bin/env bash
# Mint or re-scope a named per-consumer API token (parity with vivijure-cf
# scripts/studio-consumer-token.sh).
#
#   scripts/mint-api-token.sh <name> <operator|consumer>
#   scripts/mint-api-token.sh --set-scope <name> <operator|consumer>
#
# SCOPE IS REQUIRED AND HAS NO DEFAULT (local#238, cf#520). It decides which routes the token may
# call: `operator` for configuration, secrets and studio-wide state (the six routes listed in
# src/authz.ts OPERATOR_ROUTES), `consumer` for everything else, however destructive. THE AXIS IS
# WHOSE DATA, NOT HOW VIOLENT THE VERB. A default would be a guess about privilege. Derive the scope
# from what the consumer actually CALLS, never from its name.
#
# --set-scope changes the scope of an existing live token WITHOUT rotating its secret. Use it after
# migration 0023, which sets every pre-existing named token to `consumer`.
#
# Revoke by setting revoked_at. STUDIO_API_TOKEN is the operator login and is not in this table.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
usage="usage: $0 <name> <operator|consumer> | $0 --set-scope <name> <operator|consumer>"

# The name and scope travel into a script string below: keep them boring, refuse anything else.
check_name() {
  [[ "${1:-}" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]] || die "name must match [a-z0-9][a-z0-9_-]{0,63}"
}
check_scope() {
  case "${1:-}" in
    operator|consumer) : ;;
    "") die "scope is required: operator|consumer. $usage" ;;
    *) die "scope must be operator or consumer (got ${1})" ;;
  esac
}

MODE=mint
if [[ "${1:-}" == "--set-scope" ]]; then MODE=set-scope; shift; fi
NAME="${1:-}"
SCOPE="${2:-}"
[[ -n "$NAME" ]] || die "$usage"
check_name "$NAME"
check_scope "$SCOPE"

export DATABASE_PATH="${DATABASE_PATH:-$ROOT/data/studio.db}"
# VALUES TRAVEL BY ENVIRONMENT, NEVER BY SOURCE TEXT. The old form interpolated the plaintext token
# into the -e program, so any compile or runtime error echoed the secret in the error's source line.
# It also used top-level await, which `tsx -e` (CJS output) refuses, so the old script could not run
# at all. Both are fixed by the async wrapper below plus process.env.
MINT_TOKEN=""
if [[ "$MODE" == "mint" ]]; then MINT_TOKEN="$(openssl rand -hex 32)"; fi
cd "$ROOT"
MINT_ROOT="$ROOT" MINT_MODE="$MODE" MINT_NAME="$NAME" MINT_SCOPE="$SCOPE" MINT_TOKEN="$MINT_TOKEN" npx tsx -e "
import { migrateDatabase, openDatabase } from './src/platform/sqlite.ts';
import { sha256Hex } from './src/auth-gate.ts';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

(async () => {
  const { MINT_ROOT, MINT_MODE, MINT_NAME, MINT_SCOPE, MINT_TOKEN } = process.env as Record<string, string>;
  const dbPath = process.env.DATABASE_PATH!;
  mkdirSync(dirname(dbPath), { recursive: true });
  migrateDatabase(dbPath, join(MINT_ROOT, 'migrations'));
  const db = openDatabase(dbPath);
  if (MINT_MODE === 'set-scope') {
    const r = await db.prepare('UPDATE api_tokens SET scope = ?1 WHERE name = ?2 AND revoked_at IS NULL')
      .bind(MINT_SCOPE, MINT_NAME).run();
    if ((r.meta?.changes ?? 0) === 0) {
      console.error('error: no live token named ' + MINT_NAME);
      process.exit(1);
    }
    console.log('consumer:', MINT_NAME, 'scope:', MINT_SCOPE, '(secret unchanged)');
  } else {
    const hash = await sha256Hex(MINT_TOKEN);
    await db.prepare('INSERT OR REPLACE INTO api_tokens (name, token_hash, scope, revoked_at) VALUES (?1, ?2, ?3, NULL)')
      .bind(MINT_NAME, hash, MINT_SCOPE).run();
    console.log('consumer:', MINT_NAME, 'scope:', MINT_SCOPE);
    console.log('token:', MINT_TOKEN);
    console.log('(store securely; shown once)');
  }
})().catch((e) => {
  console.error('error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
"
