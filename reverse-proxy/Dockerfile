# Caddy with DNS-01 modules for the MinIO wildcard cert (*.<minio-host>).
# boto3 addresses buckets as <bucket>.<minio-host>; see docs/EDGE.md.
#
# Pin module tags deliberately. Bump after checking each caddy-dns release.
# 2.11+: required by caddy-dns/hetzner/v2
# cloudflare@v0.2.4+: accepts modern CF tokens (cfat_/cfut_ prefix); v0.2.1 only matched legacy 35-50 char tokens
FROM caddy:2.11-builder AS build
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --with github.com/caddy-dns/route53 \
    --with github.com/caddy-dns/digitalocean \
    --with github.com/caddy-dns/googleclouddns \
    --with github.com/caddy-dns/hetzner/v2 \
    --with github.com/caddy-dns/ovh

FROM caddy:2.11
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY sites.caddyfile /etc/caddy/sites.caddyfile
