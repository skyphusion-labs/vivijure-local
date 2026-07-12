# cloudflared (vivijure-local app tunnel)

Outbound tunnel for **studio** and **MinIO** only. Runs as a **compose profile** beside the
vivijure-local stack so app ingress stays with the control plane.

SSH is **not** in this container. flatliners uses a **systemd** `cloudflared-ssh` unit
(`fleet-chezmoi/system/stacks/flatliners/cloudflared-ssh/`).

## IaC (locally-managed tunnel)

Two steps, no dashboard:

1. **Ingress** -- edit `cloudflared/config.yml`, then recreate the connector:

```bash
COMPOSE_PROFILES=tunnel docker compose up -d --force-recreate cloudflared
```

2. **DNS** -- proxied CNAME each ingress `hostname` to `<tunnel-id>.cfargotunnel.com`:

```bash
CLOUDFLARE_API_TOKEN=... npm run sync:tunnel-dns
```

`config.yml` does not create DNS records by itself (same discipline as fleet-chezmoi
`system/cloudflare/dns`). `sync-tunnel-dns.sh` reads the tunnel id + hostnames from
`config.yml` and upserts via the Cloudflare API.

## flatliners (compose profile `tunnel`)

```bash
# cloudflared/credentials.json -> flatliners-local tunnel (see fleet-chezmoi flatliners/cloudflared)
COMPOSE_PROFILES=tunnel npm run compose:up
CLOUDFLARE_API_TOKEN=... npm run sync:tunnel-dns
```

Set `.env` per [MINIO-TUNNEL.md](../docs/MINIO-TUNNEL.md). SSH on flatliners is **systemd**
(`fleet-chezmoi/system/stacks/flatliners/cloudflared-ssh/`), not this compose file.

## Laptop dev

Omit the `tunnel` profile; use loopback URLs only.
