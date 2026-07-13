#!/usr/bin/env bash
# Seed the local vivijure bucket with prod-parity top-level prefixes (MinIO / R2 layout).
# Idempotent: safe to run on every compose up via minio-init.
set -euo pipefail

ALIAS="${MINIO_ALIAS:-local}"
BUCKET="${S3_BUCKET:-vivijure}"
ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
USER="${MINIO_ROOT_USER:?MINIO_ROOT_USER required}"
PASS="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD required}"

until mc alias set "$ALIAS" "$ENDPOINT" "$USER" "$PASS" 2>/dev/null; do sleep 1; done
mc mb --ignore-existing "${ALIAS}/${BUCKET}"

README='vivijure object layout (prod R2 parity)
renders/<project>/keyframes/<shot_id>.png  -- keyframes (own-gpu / local-gpu i2v_clip reads these)
renders/<project>/clips/                 -- per-shot clips + finish outputs
renders/<project>/progress/                -- RunPod progress ndjson/json
renders/<film_id>/                         -- film job docs + assembled output
bundles/                                   -- storyboard bundle tarballs
audio/                                     -- uploaded / generated beds
uploads/                                   -- ad-hoc operator uploads (staged into renders/ by studio)
'

printf '%s' "$README" | mc pipe "${ALIAS}/${BUCKET}/README.txt" >/dev/null

for prefix in renders bundles audio uploads; do
  printf '' | mc pipe "${ALIAS}/${BUCKET}/${prefix}/.keep" >/dev/null
done

echo "minio layout: seeded ${BUCKET}/{renders,bundles,audio,uploads}/"
