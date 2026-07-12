# cloudflared (vivijure-local app tunnel)

Outbound tunnel for **studio** and **MinIO** only. Runs as a **compose profile** beside the
vivijure-local stack so app ingress stays with the control plane.

SSH is **not** in this container. flatliners uses a **systemd** `cloudflared-ssh` unit
(`fleet-chezmoi/system/stacks/flatliners/cloudflared-ssh/`).

## flatliners (compose profile `tunnel`)

```bash
# cloudflared/credentials.json -> flatliners-local tunnel (see fleet-chezmoi flatliners/cloudflared)
COMPOSE_PROFILES=tunnel docker compose up -d --build
```

Set `.env` per [MINIO-TUNNEL.md](../docs/MINIO-TUNNEL.md). SSH on flatliners is **systemd**
(`fleet-chezmoi/system/stacks/flatliners/cloudflared-ssh/`), not this compose file.

## Laptop dev

Omit the `tunnel` profile; use loopback URLs only.
