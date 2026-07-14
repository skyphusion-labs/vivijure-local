# Public HTTPS for vivijure-local (Caddy)

Get the studio and MinIO on the internet with real HTTPS. Written for a home lab or one
cloud box. You do **not** need Cloudflare Tunnel.

Goal: as few steps as we can. Prefer a DNS host we can talk to (API), so certificates
renew themselves. Cloudflare DNS is optional and free for that; Cloudflare is only
*required* if you already use **Workers AI / AI Gateway** for models.

---

## Easiest path (about three commands)

1. Put hostnames and your public IP in `.env`:

```bash
CADDY_APP_HOST=studio.example.com
CADDY_MINIO_HOST=s3.example.com
EDGE_PUBLIC_IP=<your public IP or load balancer VIP>
CADDY_ACME_EMAIL=you@example.com
```

2. Run:

```bash
npm run install:studio   # once, for the API token
npm run install:edge     # prints DNS + detects your DNS host
```

3. Do what it asks (usually: create three A/AAAA records, paste one DNS API token), then:

```bash
COMPOSE_PROFILES=edge npm run compose:up
curl -fsS https://studio.example.com/health
```

If `install:edge` recognizes your DNS host (Cloudflare, Route 53, DigitalOcean, Google
Cloud DNS, Hetzner, OVH), Caddy creates the temporary TXT records for the MinIO
**wildcard** certificate. You should not paste TXT values by hand.

---

## Why a wildcard?

GPU tools (like RunPod / boto3) often call MinIO as `vivijure.s3.example.com` (bucket
name in front of the host). A normal cert for `s3.example.com` does not cover that. You
need `*.s3.example.com`. Wildcards need a DNS proof (TXT) or certificate files you bring.

---

## Before you start

1. A domain you control.
2. A server that can receive port **80** and **443** from the internet (or a load
   balancer that passes those ports through without doing TLS itself).
3. Docker Compose working locally (`npm run compose:up` without the edge profile).
4. A strong studio token (`npm run install:studio`). Rotate off default MinIO passwords
   before going public.

HTTPS protects the token on the wire. It does not add multi-user logins. See
[SECURITY.md](SECURITY.md).

---

## What `install:edge` does

- Prints the A/AAAA records to create (studio, MinIO, `*.minio-host`).
- Looks up your nameservers and picks a DNS API when it can.
- Writes Caddy's site config and fills public URL env vars.
- If your DNS host is **not** supported: explains the easy fix (move DNS to a supported
  host) **or** stays with you and offers to issue certificates in the same command,
  showing each TXT value when Let's Encrypt asks for it.

Optional: if Caddy should bind only a private NIC (VLAN behind a load balancer):

```
EDGE_BIND_IP=10.1.1.7
```

Omit it to listen on all interfaces.

---

## DNS API tokens (automatic HTTPS)

| If your nameservers look like | Set in `.env` |
|-------------------------------|---------------|
| `*.ns.cloudflare.com` | `CADDY_DNS_PROVIDER=cloudflare` and `CF_DNS_TOKEN` |
| `*.awsdns-*` | `CADDY_DNS_PROVIDER=route53` plus AWS key, secret, hosted zone id |
| `ns*.digitalocean.com` | `CADDY_DNS_PROVIDER=digitalocean` and `DO_AUTH_TOKEN` |
| Google Cloud DNS | `CADDY_DNS_PROVIDER=googleclouddns`, `GCP_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` |
| `*.ns.hetzner.com` | `CADDY_DNS_PROVIDER=hetzner` and `HETZNER_API_TOKEN` |
| OVH | `CADDY_DNS_PROVIDER=ovh` and the four `OVH_*` keys |

Cloudflare tip: keep the studio/MinIO A records **DNS only** (grey cloud). An orange proxy
can break GPU and script clients.

---

## If your DNS host is not on that list

`install:edge` will say so in plain language. Two choices:

1. **Easiest:** move the domain's DNS to a supported host (Cloudflare free is enough),
   re-run `npm run install:edge`, paste one API token, done.
2. **Stay put:** create the A/AAAA records it lists, accept the prompt to finish HTTPS
   now, and paste the TXT values it shows (usually two pauses: studio, then MinIO
   wildcard). Same command: `npm run install:edge`.  
   (`npm run issue:edge-certs` is the same helper if you want to run only that step.)

Production Let's Encrypt is the default for that helper. For a practice run:

```bash
EDGE_ACME_SERVER=staging npm run issue:edge-certs
```

---

## Check it works

```bash
curl -fsS https://studio.example.com/health
curl -fsS https://s3.example.com/minio/health/live
curl -fsSI https://vivijure.s3.example.com/
```

Point RunPod (or other GPU backends) at `https://s3.example.com` with your MinIO keys.

---

## AI Gateway (optional)

Planning modules may still need Cloudflare **AI Gateway** vars. That is separate from this
edge. You can use Caddy + any DNS host and still use the gateway for models.

---

## Related

- [DEPLOYMENT.md](DEPLOYMENT.md) -- full env reference
- [SECURITY.md](SECURITY.md) -- token model
- [quickstart.md](quickstart.md) -- local compose without public HTTPS
