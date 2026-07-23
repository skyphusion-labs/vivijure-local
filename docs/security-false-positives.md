# Security audit false positives

Documented dismissals for adversarial-audit (K2.7/K3) findings that are not actionable bugs in this repo's threat model.

## Homelab single-operator stack

Default MinIO creds, HTTP-only studio URL, and sibling-subdomain CSRF (`same-site`) reflect a **local operator** threat model. Production uses HTTPS, strong secrets, and Cloudflare Access on CF-hosted studios.

## Record

| Date | Audit | Finding | Rationale |
| --- | --- | --- | --- |
| 2026-07-23 | K3 repo | CSRF same-site on homelab | Local operator; documented homelab threat model |
| 2026-07-23 | K3 repo | Demo poll GET advances queue | Demo mode intentional; capped by demo caps |
| 2026-07-23 | K3 repo | Secure cookie on HTTP default | 127.0.0.1 dev default; homelab docs cover HTTPS |
| 2026-07-23 | K3 repo | MinIO root creds default | Internal compose network; operator overrides .env |
