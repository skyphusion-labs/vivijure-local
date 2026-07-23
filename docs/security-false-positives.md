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
| 2026-07-23 | K3 verify ~18:04 | Dockerfile COPY . . bakes .env | **Fixed** -- `.dockerignore` excludes `.env`, `.studio-token`, `*.db` (#195); install.ts secrets never enter image context |
| 2026-07-23 | K3 verify ~18:04 | Demo mode render history GET | Homelab demo threat model; demo caps enforced |
| 2026-07-23 | K3 verify ~18:04 | Demo mode GET on operator project/prefs | Homelab demo; bearer + demo caps |
