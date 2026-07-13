# MinIO via cloudflared (remote GPU / RunPod access)

Inside compose, services talk to MinIO at `http://minio:9000`. **RunPod workers** and **homelab GPU
backends** (propagandhi door, vivijure-local-backend) are off-box: they need a **reachable HTTPS S3
endpoint** to GET keyframes and PUT clips.

The control plane never proxies artifact bytes; it presigns URLs (CPU containers) or hands storage keys
to backends that read/write with their own S3 credentials (RunPod `vivijure-backend`, local-gpu door).

## Pattern

```
cloudflared tunnel  -->  https://minio-<host>.skyphusion.org  -->  localhost:9000 (MinIO)
studio (compose)    -->  S3_ENDPOINT=http://minio:9000          (in-network SDK)
studio (compose)    -->  S3_PRESIGN_ENDPOINT=https://minio-...  (host in presigned URLs)
GPU / RunPod        -->  same HTTPS URL + S3 access key/secret
```

## flatliners (reference stack)

Fleet IaC: `fleet-chezmoi/system/stacks/flatliners/cloudflared/` (reference tunnel id only).

App tunnel runs in **vivijure-local** compose profile `tunnel` (`cloudflared/config.yml`).
SSH tunnel is **systemd** only: `fleet-chezmoi/system/stacks/flatliners/cloudflared-ssh/`.

| Hostname | Origin |
|----------|--------|
| `vivijure-local.skyphusion.org` | `http://localhost:8790` (studio) |
| `minio-flatliners.skyphusion.org` | `http://localhost:9000` (MinIO S3 API, path-style) |
| `vivijure.minio-flatliners.skyphusion.org` | `http://localhost:9000` (MinIO bucket vhost for RunPod boto3) |

After editing `cloudflared/config.yml`, apply ingress + DNS + cache rules (no dashboard):

```bash
COMPOSE_PROFILES=tunnel docker compose up -d --force-recreate cloudflared
CLOUDFLARE_API_TOKEN=... npm run sync:tunnel-dns
CLOUDFLARE_API_TOKEN=... npm run sync:minio-cache-rules
```

**Why cache bypass:** `vivijure-backend` calls `HeadObject` before download. Cloudflare's proxied
edge (`cache_level: aggressive` on `skyphusion.org`) can rewrite or cache S3 traffic so SigV4 HEAD
requests fail with `403 Forbidden` even when credentials are correct. Real R2 endpoints do not hit
this path; that is why other RunPod templates work with the same secret-store refs. See
[Stack Overflow: HeadObject 403 on MinIO behind Cloudflare](https://stackoverflow.com/questions/76608350).

On flatliners, in `vivijure-local/.env`:

```bash
PUBLIC_BASE_URL=https://vivijure-local.skyphusion.org
S3_PRESIGN_ENDPOINT=https://minio-flatliners.skyphusion.org
S3_FETCH_ALLOW_HOSTS=minio,minio-flatliners.skyphusion.org
S3_ALLOW_HTTP_FETCH=false
```

Restart compose after changing `.env`. CPU containers use `ALLOWED_FETCH_HOSTS` to accept presigned
URLs; set `S3_ALLOW_HTTP_FETCH=false` when presign uses HTTPS.

**`platform_secrets` overrides compose env at runtime.** On first boot, install seeds the DB from
`.env`; later `.env` edits alone do not change presigned URLs until you sync:

```bash
npm run sync:tunnel-secrets:compose
docker compose restart studio
```

Or update the same keys in Studio Settings. Symptom if stale: CPU containers reject presigned URLs
with `scheme not allowed (https only): http`, or studio S3 puts fail with `InvalidAccessKeyId` after
`rotate:minio-creds` (host `sync:tunnel-secrets` updates the wrong DB when studio uses the compose volume;
use `npm run sync:tunnel-secrets:compose`).

## Verify HTTPS S3 via tunnel

```bash
# Edge TLS + MinIO health (from laptop or RunPod)
curl -fsS https://minio-flatliners.skyphusion.org/minio/health/live

# After sync:tunnel-secrets:compose + studio restart
npm run smoke:exit
```

Presigned PUT/GET to `https://minio-flatliners.skyphusion.org/vivijure/...` must return 200 off-box.

## RunPod vivijure-backend

Configure the serverless endpoint environment (same bucket as the studio). The backend reads
**`R2_*` names**, not `S3_*` (copy from `~/runpod-minio-r2-creds.env` on flatliners):

| Variable | Example |
|----------|---------|
| `R2_ENDPOINT` | `https://minio-flatliners.skyphusion.org` |
| `R2_ACCESS_KEY_ID` | MinIO user (not `minioadmin` in production) |
| `R2_SECRET_ACCESS_KEY` | matching secret |
| `R2_BUCKET` | `vivijure` |

`vivijure-backend` boto3 uses virtual-hosted bucket URLs (`vivijure.minio-flatliners...`). Compose
sets `MINIO_DOMAIN` and adds the bucket vhost to `cloudflared/config.yml`. Run `npm run sync:tunnel-dns`
so the CNAME exists (IaC; not automatic from config alone). Studio presigns path-style URLs on the
apex hostname; both work once DNS is synced.

## Local GPU door (propagandhi)

The door stack (`door-propagandhi.skyphusion.org`) runs i2v; it still needs S3 access to the **same**
bucket. Point its S3 env at the tunnel URL (or a VLAN route if same estate). `LOCAL_BACKEND_URL` on
the studio is the door hostname, not MinIO.

## Laptop homelab (optional tunnel)

Copy `cloudflared/config.yml.example` and run a locally-managed tunnel on the host (not inside the
compose network). Bind MinIO on `127.0.0.1:9000` (default compose) and add an ingress hostname.

Do **not** commit `credentials.json`.

## Security

- MinIO on a public tunnel relies on **S3 access keys**, not Cloudflare Access (RunPod cannot complete
  Access SSO for SigV4).
- Rotate off default `minioadmin` before exposing the tunnel:

```bash
npm run rotate:minio-creds
npm run sync:tunnel-secrets:compose
docker compose up -d --force-recreate minio minio-init studio
```

- Presigned URLs remain short-lived; direct S3 keys on RunPod are long-lived -- scope per-function keys
  when possible.
