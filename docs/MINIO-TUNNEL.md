# MinIO public access (moved)

Cloudflare Tunnel is no longer the shipping edge for vivijure-local.

Expose MinIO (and the studio) with **Caddy** and real DNS. See **[EDGE.md](EDGE.md)**.

```bash
npm run install:edge
COMPOSE_PROFILES=edge npm run compose:up
```

Set `S3_PRESIGN_ENDPOINT` to your public MinIO HTTPS URL (install:edge does this for you).
