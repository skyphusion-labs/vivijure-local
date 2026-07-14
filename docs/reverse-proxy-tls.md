# Public HTTPS with the built-in reverse proxy (Caddy + Let's Encrypt)

Want to reach vivijure-local from the public internet with real HTTPS, and drive it from scripts
or agents (Slate, MCP) without a WAF getting in the way? Turn on the built-in **reverse-proxy**
profile. It runs **Caddy** in front of the studio and MinIO, gets and auto-renews Let's Encrypt
certificates, and needs no extra software.

```bash
COMPOSE_PROFILES=reverse-proxy docker compose up -d
```

That is the whole deployment. The rest of this page explains what to set and why one of the
certificates has to be a wildcard.

> **Single-operator reminder.** vivijure-local trusts any caller that holds the studio token
> (see [SECURITY.md](SECURITY.md)). Only expose it on a network you control, and use a long
> random `STUDIO_API_TOKEN`. HTTPS protects the token in transit; it does not add multi-user
> authorization.

---

## You are serving TWO things, and they need different certificates

| What | Hostname example | Certificate |
|------|------------------|-------------|
| The **studio** (control panel + API) | `studio.example.com` | a normal, single-host cert |
| **MinIO** (S3 object storage) | `s3.example.com` | a **wildcard** cert: `*.s3.example.com` |

### Why MinIO needs a *wildcard* cert (the important part)

Your GPU render backends (RunPod, or a remote GPU box) read and write objects in MinIO using
Amazon's S3 SDK (**boto3**). By default, boto3 addresses a bucket by putting the **bucket name in
front of the hostname** ("virtual-hosted style"):

```
bucket "vivijure"  ->  https://vivijure.s3.example.com/<object>
bucket "renders"   ->  https://renders.s3.example.com/<object>
```

Every bucket becomes its own subdomain, and the backend assumes this (it is not changing). A
normal cert for `s3.example.com` does **not** cover `vivijure.s3.example.com`, so the SDK would
reject the connection. A **wildcard** cert `*.s3.example.com` covers all of those subdomains at
once. That is the whole reason for the wildcard.

### A wildcard forces the "DNS-01" challenge

Let's Encrypt will only issue a wildcard cert if you prove you control the **whole domain** by
creating a special DNS record (the **DNS-01** challenge). The simpler challenges cannot issue
wildcards. So the reverse-proxy image is **Caddy built with the Cloudflare DNS module**, and you
give it a **DNS API token** for your zone. Caddy creates the challenge record, gets the wildcard,
and removes the record, automatically, for the life of the deployment.

- The studio cert uses normal issuance (no token needed).
- The MinIO wildcard cert uses DNS-01, so it needs the Cloudflare token in `CF_DNS_TOKEN`.

> **Shortcut: you can avoid the wildcard.** If you set your GPU backend's S3 client to
> **path-style** addressing, the bucket goes in the *path* instead of the hostname
> (`https://s3.example.com/vivijure/<object>`), so a single-host cert for `s3.example.com` is
> enough (no wildcard, no DNS token). In boto3:
> ```python
> import boto3
> from botocore.config import Config
> s3 = boto3.client("s3", endpoint_url="https://s3.example.com",
>                   config=Config(s3={"addressing_style": "path"}))
> ```
> vivijure-local's own studio already uses path-style (`S3_FORCE_PATH_STYLE=true`), so this only
> matters for whatever *external* backend talks straight to MinIO. If you can set path-style
> there, you can skip the wildcard. If you cannot (some tools hard-code virtual-hosted style),
> use the wildcard as described above.

---

## Step 1: get a Cloudflare DNS API token

In the Cloudflare dashboard, create an API token scoped to **Zone -> DNS -> Edit** on **just your
zone**. Keep it secret; it goes in `.env` (which is git-ignored) or a Docker secret, never in a
commit.

## Step 2: DNS records

Point these at your server's public IP (A and, if you have it, AAAA):

```
studio.example.com        ->  <your server IP>
s3.example.com            ->  <your server IP>
*.s3.example.com          ->  <your server IP>     # the bucket subdomains
```

If your DNS is on Cloudflare, set these records **DNS-only (grey cloud)**, not proxied: the
Cloudflare proxy's bot-fight can block non-browser clients (error 1010), which defeats the point
of running the reverse proxy.

## Step 3: fill in `.env`

```bash
# The reverse proxy
CADDY_BIND_IP=0.0.0.0                 # this box faces the internet; use a LAN IP if it is behind a router
CADDY_APP_HOST=studio.example.com
CADDY_MINIO_HOST=s3.example.com       # wildcard *.s3.example.com is covered automatically
CADDY_ACME_EMAIL=you@example.com
CF_DNS_TOKEN=your-cloudflare-dns-token   # the token from step 1; keep it out of git

# Tell the studio its public names so presigned URLs come out right
PUBLIC_BASE_URL=https://studio.example.com
S3_PRESIGN_ENDPOINT=https://s3.example.com
MINIO_PUBLIC_DOMAIN=s3.example.com    # MinIO routes <bucket>.s3.example.com from the Host header
S3_FETCH_ALLOW_HOSTS=minio,s3.example.com

# And a strong studio token + strong MinIO credentials (never the dev defaults on a public box)
STUDIO_API_TOKEN=...                  # or run `npm run install:studio`
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

## Step 4: start it

```bash
COMPOSE_PROFILES=reverse-proxy docker compose up -d      # builds the Caddy image on first run
```

Caddy fetches both certificates (the studio cert immediately, the MinIO wildcard via the DNS
challenge), renews them before expiry, and forwards the real client IP to the apps.

---

## Check it works

```bash
curl -fsS https://studio.example.com/health          # -> ok
curl -fsS https://s3.example.com/minio/health/live   # -> 200
curl -fsSI https://vivijure.s3.example.com/          # TLS valid on a bucket subdomain (wildcard)
```

If the last one fails with a certificate error, your MinIO cert is not a wildcard (check
`CF_DNS_TOKEN` and that `*.s3.example.com` resolves), or switch the backend to path-style (see
the shortcut above).

---

## Behind an external load balancer (advanced)

If Caddy sits behind an L4 (TCP-passthrough) load balancer, the LB masks the client IP. Add the
`proxy_protocol` listener wrapper so Caddy recovers it, and make the LB send PROXY protocol. This
is how the reference fleet deployment runs it (a Hetzner LB in front); the LB carries no certs,
Caddy still does all TLS exactly as above. You supply your own Caddyfile with the wrapper and
import the shipped `sites.caddyfile`; the fleet IaC is in `fleet-chezmoi`.

---

Related: [MINIO-TUNNEL.md](MINIO-TUNNEL.md) (the Cloudflare-tunnel alternative),
[SECURITY.md](SECURITY.md) (token model), [DEPLOYMENT.md](DEPLOYMENT.md) (env reference).
