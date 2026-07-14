#!/usr/bin/env bash
# Manual DNS-01 cert issue for unsupported DNS providers.
# Uses goacme/lego in Docker. Prints TXT name+value; you create the record, then continue.
#
# Requires: docker, CADDY_APP_HOST, CADDY_MINIO_HOST, CADDY_ACME_EMAIL (or ACME_EMAIL)
# Optional: EDGE_ACME_SERVER=staging|production (default production; use staging for a dry run)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_HOST="${CADDY_APP_HOST:-${STUDIO_HOST:-}}"
MINIO_HOST="${CADDY_MINIO_HOST:-${MINIO_HOST:-}}"
EMAIL="${CADDY_ACME_EMAIL:-${ACME_EMAIL:-}}"
# Production by default so browsers trust the result. Use staging while testing installs.
SERVER_MODE="${EDGE_ACME_SERVER:-production}"

if [[ -z "$APP_HOST" || -z "$MINIO_HOST" || -z "$EMAIL" ]]; then
  echo "Set CADDY_APP_HOST, CADDY_MINIO_HOST, and CADDY_ACME_EMAIL in .env first." >&2
  echo "Example:" >&2
  echo "  CADDY_APP_HOST=studio.example.com" >&2
  echo "  CADDY_MINIO_HOST=s3.example.com" >&2
  echo "  CADDY_ACME_EMAIL=you@example.com" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for npm run issue:edge-certs" >&2
  exit 1
fi

LEGO_DIR="${ROOT}/.smoke/lego-manual"
CERTS_DIR="${ROOT}/reverse-proxy/certs"
mkdir -p "$LEGO_DIR" "$CERTS_DIR"
chmod 700 "$LEGO_DIR" 2>/dev/null || true

SERVER_FLAG=()
if [[ "$SERVER_MODE" == "staging" ]]; then
  SERVER_FLAG=(--server https://acme-staging-v02.api.letsencrypt.org/directory)
  echo "Using Let's Encrypt STAGING (browsers will warn; fine for practice)."
else
  echo "Using Let's Encrypt PRODUCTION (browser-trusted)."
  echo "Tip: Let's Encrypt limits ~5 identical certs per week; dry-run with EDGE_ACME_SERVER=staging first."
fi

echo ""
echo "What happens next (about 2 short pauses):"
echo "  1) The tool prints a TXT name and a long value."
echo "  2) You create that TXT in your DNS panel (same place as your A records)."
echo "  3) Wait ~1 minute, then press Enter here."
echo "  4) Repeat if it asks again (studio, then MinIO wildcard)."
echo ""
echo "Names you will see:"
echo "  _acme-challenge.${APP_HOST}"
echo "  _acme-challenge.${MINIO_HOST}   (this one unlocks *.${MINIO_HOST})"
echo ""

run_lego() {
  local out_label="$1"
  shift
  docker run --rm -it \
    -v "${LEGO_DIR}:/data" \
    -w /data \
    goacme/lego:v4.22.2 \
    --path /data \
    --accept-tos \
    --email "$EMAIL" \
    --dns manual \
    "${SERVER_FLAG[@]}" \
    "$@" \
    run
  echo "(issued ${out_label})"
}

# Studio host (single name)
run_lego "studio" --domains "$APP_HOST"

# MinIO base + wildcard (same TXT name _acme-challenge.<minio-host>)
run_lego "minio+wildcard" --domains "$MINIO_HOST" --domains "*.${MINIO_HOST}"

# lego stores under certificates/<domain>.crt ; wildcard uses _.domain.crt
studio_crt="${LEGO_DIR}/certificates/${APP_HOST}.crt"
studio_key="${LEGO_DIR}/certificates/${APP_HOST}.key"
minio_crt="${LEGO_DIR}/certificates/${MINIO_HOST}.crt"
minio_key="${LEGO_DIR}/certificates/${MINIO_HOST}.key"
# Prefer the wildcard bundle if lego named it that way
if [[ -f "${LEGO_DIR}/certificates/_.${MINIO_HOST}.crt" ]]; then
  minio_crt="${LEGO_DIR}/certificates/_.${MINIO_HOST}.crt"
  minio_key="${LEGO_DIR}/certificates/_.${MINIO_HOST}.key"
fi

for f in "$studio_crt" "$studio_key" "$minio_crt" "$minio_key"; do
  if [[ ! -f "$f" ]]; then
    echo "expected cert file missing: $f" >&2
    echo "Check ${LEGO_DIR}/certificates/" >&2
    ls -la "${LEGO_DIR}/certificates/" >&2 || true
    exit 1
  fi
done

umask 077
cp "$studio_crt" "${CERTS_DIR}/studio.pem"
cp "$studio_key" "${CERTS_DIR}/studio.key"
cp "$minio_crt" "${CERTS_DIR}/minio.pem"
cp "$minio_key" "${CERTS_DIR}/minio.key"
chmod 600 "${CERTS_DIR}/studio.key" "${CERTS_DIR}/minio.key"

echo ""
echo "Wrote:"
echo "  ${CERTS_DIR}/studio.pem"
echo "  ${CERTS_DIR}/studio.key"
echo "  ${CERTS_DIR}/minio.pem"
echo "  ${CERTS_DIR}/minio.key"
echo ""
echo "Next:"
echo "  CADDY_TLS_MODE=files npm run install:edge"
echo "  COMPOSE_PROFILES=edge npm run compose:up"
echo ""
echo "If you used staging, re-run with EDGE_ACME_SERVER=production when ready for browsers."
