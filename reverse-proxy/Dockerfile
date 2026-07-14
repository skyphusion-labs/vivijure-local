# Caddy built with the Cloudflare DNS module -- the reverse proxy for a self-hosted PUBLIC
# vivijure-local (COMPOSE_PROFILES=reverse-proxy). The DNS module is REQUIRED for the MinIO
# wildcard cert (*.<minio-host>), which can only be issued via the DNS-01 ACME challenge
# (boto3 addresses buckets virtual-hosted style; see docs/reverse-proxy-tls.md).
#
# Versions are pinned for reproducibility; bump deliberately. Verify the caddy-dns/cloudflare
# tag against https://github.com/caddy-dns/cloudflare/releases before bumping.
FROM caddy:2.10-builder AS build
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare@v0.2.1

FROM caddy:2.10
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY sites.caddyfile /etc/caddy/sites.caddyfile
