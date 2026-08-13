#!/usr/bin/env bash
# Mint a named per-consumer API token (parity with vivijure scripts/studio-consumer-token.sh).
#
# HONESTY (local#238): the token is attributed as api-token:<name> but is NOT scoped. It can do
# everything STUDIO_API_TOKEN can (submit renders, mutate settings, all /api routes). Revoke by
# setting revoked_at; do not mint a "read-only" name expecting read-only reach.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: $0 <consumer-name>   # full operator-equivalent reach; name is attribution only" >&2
  exit 1
fi
export DATABASE_PATH="${DATABASE_PATH:-$ROOT/data/studio.db}"
TOKEN="$(openssl rand -hex 32)"
npx tsx -e "
import { migrateDatabase, openDatabase } from './src/platform/sqlite.ts';
import { sha256Hex } from './src/auth-gate.ts';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = '$ROOT';
const dbPath = process.env.DATABASE_PATH!;
mkdirSync(dirname(dbPath), { recursive: true });
migrateDatabase(dbPath, join(root, 'migrations'));
const db = openDatabase(dbPath);
const hash = await sha256Hex('$TOKEN');
await db.prepare('INSERT OR REPLACE INTO api_tokens (name, token_hash, revoked_at) VALUES (?1, ?2, NULL)')
  .bind('$NAME', hash).run();
console.log('consumer:', '$NAME');
console.log('token:', '$TOKEN');
console.log('(store securely; shown once)');
"
