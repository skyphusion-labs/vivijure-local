-- Vivijure Studio -- platform_secrets (migration 0011).
--
-- Operator-editable connection credentials and API keys. Install / first boot seeds
-- platform_secrets from env (see platform-secrets-bootstrap.ts); Settings GUI may edit
-- catalog keys afterward. DB values override same-named process.env at runtime.
--
-- Additive (CREATE TABLE only).

CREATE TABLE IF NOT EXISTS platform_secrets (
  secret_key   TEXT    NOT NULL PRIMARY KEY,
  value_text   TEXT    NOT NULL,
  updated_at   INTEGER NOT NULL
);
