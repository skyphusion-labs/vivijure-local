-- local#238 (cf#520 twin, vivijure-cf migrations/0020_api_token_scope.sql): per-route authorization.
-- api_tokens said WHO a credential belongs to and nothing about WHAT it may do, so every named token
-- was operator-equivalent. Same column, same CHECK, same default as cf. The number differs because
-- each door numbers its own sequence; the SCHEMA is what has to match.
--
-- EXISTING TOKENS BECOME `consumer`, AND THAT IS DELIBERATE. SQLite fills an added NOT NULL column
-- from its DEFAULT, so every row that predates this file takes 'consumer', the least privilege. That
-- is the safe direction and it is the direction cf took: a consumer token that needed more gets a
-- loud 403 `scope_denied` on the six operator routes (src/authz.ts) and nothing else changes; an
-- operator default would leave the hole open under a new name. An operator who wants a named token
-- back at operator re-scopes it WITHOUT rotating the secret:
--
--     scripts/mint-api-token.sh --set-scope <name> operator
--
-- STUDIO_API_TOKEN (the operator login) never touches this table and is unaffected.
--
-- NO NAME-MATCHING UPDATE BELONGS IN THIS FILE. Every install runs it, and token names are chosen by
-- each operator, so an UPDATE keyed on a name would promote some other install's token silently.
--
-- SAFE TO RUN TWICE. migrateDatabase (src/platform/sqlite.ts) records the file in _migrations and
-- never re-applies it. Executed a second time by hand, SQLite refuses the ALTER with "duplicate column
-- name: scope" and the runner's BEGIN/ROLLBACK leaves every row and every scope exactly as it was;
-- there is no data statement here that could re-downgrade a token re-scoped in between. Both halves
-- are asserted in tests/api-token-scope-238.test.ts.
--
-- The CHECK is not retroactive in SQLite, so src/auth-gate.ts re-validates every scope it reads and
-- fails CLOSED on anything outside the union.
ALTER TABLE api_tokens
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'consumer'
  CHECK (scope IN ('operator', 'consumer'));
