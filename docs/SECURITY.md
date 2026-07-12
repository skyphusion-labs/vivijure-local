# Security model (vivijure-local)

This document describes how the **alpha** homelab host authenticates callers and what it does
**not** protect against. Upstream Vivijure documents the full product model in
[vivijure/docs/SECURITY.md](https://github.com/skyphusion-labs/vivijure/blob/main/docs/SECURITY.md).
This file covers only what differs or applies directly on the Node host.

> **Alpha software.** Do not expose this stack to untrusted networks without understanding the
> limits below. This is demonstration scaffolding, not a hardened production deployment.

---

## Single-operator studio

`vivijure-local` performs **no per-user authorization**. Resource ids are opaque UUIDs, but any
caller who holds a valid studio token and knows an id can read or mutate that resource. Routes such
as `GET /api/cast/export/:id` return full character bundles (portrait, LoRA, bible) by id.

This design is safe **only** when:

- Exactly one operator uses the studio, and
- Only that operator can reach the API (localhost, private VLAN, or VPN you control).

It is **not** safe for multi-tenant hosting, shared homelab LANs without segmentation, or public
internet exposure without additional front-door controls you operate.

---

## Auth mode: token only (v1)

| Mode | Supported locally | Behavior |
|------|-------------------|----------|
| `token` | **Yes** (default) | `Authorization: Bearer <STUDIO_API_TOKEN>` on every `/api/*` request |
| `access` | No | Cloudflare Access JWT verification (cloud host only) |
| `demo` | No | Read-only public demo deploy (cloud only) |

Implementation: `src/auth-gate.ts` (ported from upstream). The gate **fails closed**: unknown mode,
missing token, or wrong token denies the request.

### Minting and rotating the operator token

```bash
openssl rand -hex 32
```

Put the value in `.env` as `STUDIO_API_TOKEN` (or run `npm run install:studio`, which mints it and seeds `platform_secrets`), then restart the studio container:

```bash
docker compose up -d studio
```

The UI asks for the token on first load and keeps it in browser storage only. Treat the token like
a root password.

Unlike upstream `deploy.sh`, the local install writes the operator token to `.studio-token` (mode `0600`) and seeds the SQLite secrets table; it is not printed to the terminal. The Settings page does **not** expose or rotate this token (first-visit GUI setup would let anyone who reaches the URL mint GPU spend before auth is locked down).

---

## Network exposure

Default compose binds the studio to `127.0.0.1:8790`. That is appropriate for a single operator on
the same machine.

If you bind `0.0.0.0` or publish through a reverse proxy:

- Use a long random `STUDIO_API_TOKEN`.
- Terminate TLS at the proxy.
- Restrict source IPs or require VPN.
- Do not rely on "security through obscurity" of UUID ids.

MinIO defaults to localhost ports as well. Object data includes renders, cast portraits, and job
metadata.

---

## Secrets handling

| Secret | Where it lives |
|--------|----------------|
| `STUDIO_API_TOKEN` | `.studio-token` + `platform_secrets` (install seeds; not in Settings GUI) |
| `S3_*` / R2 credentials | Settings GUI and/or `.env`; MinIO defaults are dev-only |
| `CF_AIG_TOKEN`, `GATEWAY_ID`, `ANTHROPIC_API_KEY` | Settings GUI when live planner enabled |
| `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` | Settings GUI when RunPod modules bound |
| RunPod / module secrets | Module sidecar env or upstream module deploy |

Never commit `.env`. Never paste live secrets into issues or public chats.

CPU containers receive **presigned** GET/PUT URLs only; they do not hold R2/MinIO root credentials.
SSRF guards in `containers/*/url_guard.py` restrict outbound fetch hosts (MinIO allowlist in compose).

---

## What this alpha build does not include

- Per-consumer API tokens (`scripts/studio-consumer-token.sh` upstream pattern) -- not ported in v1.
- Cloudflare Access / SSO / device posture.
- Rate limiting across operators (in-memory limiter only where ported).
- Audit log shipping (stdout only).
- Automated secret rotation.

These may arrive in later phases; track [ROADMAP.md](ROADMAP.md).

---

## Reporting issues

Security-sensitive defects in this repo: open a **private** GitHub security advisory on
`skyphusion-labs/vivijure-local`, or contact `conrad@skyphusion.org` for coordinated disclosure.

Contract and module-boundary issues shared with upstream should be reported against
`skyphusion-labs/vivijure` when they affect both hosts.
