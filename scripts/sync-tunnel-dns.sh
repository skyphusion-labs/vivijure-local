#!/usr/bin/env bash
# Upsert proxied CNAME records for every ingress hostname in cloudflared/config.yml.
#
# Locally-managed tunnels: config.yml is ingress SoT; DNS is a separate idempotent step
# (same pattern as fleet-chezmoi system/cloudflare/dns). Does not use the dashboard.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... npm run sync:tunnel-dns
#   CLOUDFLARE_API_TOKEN=... npm run sync:tunnel-dns -- cloudflared/config.yml
#
# Token needs Zone > DNS > Edit on the target zone (skyphusion.org by default).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-${ROOT}/cloudflared/config.yml}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (Zone > DNS > Edit)}"

ZONE_NAME="${CF_TUNNEL_DNS_ZONE:-skyphusion.org}"
ZONE_ID="${CF_ZONE_ID_SKYPHUSION_ORG:-3b58b52bd324332fb56b3ab685588c76}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "$CONFIG" ]]; then
  echo "missing config: $CONFIG" >&2
  exit 1
fi

export CONFIG ZONE_ID ZONE_NAME DRY_RUN
python3 <<'PY'
import json, os, re, urllib.parse, urllib.request

config = os.environ["CONFIG"]
zid = os.environ["ZONE_ID"]
zone_name = os.environ["ZONE_NAME"]
dry = os.environ.get("DRY_RUN") == "1"
tok = os.environ["CLOUDFLARE_API_TOKEN"]

tunnel_id = None
hostnames = []
in_ingress = False
for raw in open(config, encoding="utf-8"):
    line = raw.split("#", 1)[0].rstrip()
    if not line.strip():
        continue
    m = re.match(r"^tunnel:\s*(\S+)", line)
    if m:
        tunnel_id = m.group(1)
        continue
    if re.match(r"^ingress:\s*$", line):
        in_ingress = True
        continue
    if in_ingress:
        m = re.match(r"^\s+-\s+hostname:\s*(\S+)", line)
        if m:
            hostnames.append(m.group(1))
            continue
        if re.match(r"^\s+-\s+service:\s+http_status:", line):
            break
        if re.match(r"^\S", line) and not line.startswith(" "):
            in_ingress = False

if not tunnel_id:
    raise SystemExit(f"no tunnel id in {config}")
if not hostnames:
    raise SystemExit(f"no ingress hostnames in {config}")

target = f"{tunnel_id}.cfargotunnel.com"
print(f"zone: {zone_name} ({zid})")
print(f"tunnel DNS target: {target}")
print()

def req(method, url, body=None):
    r = urllib.request.Request(
        url,
        method=method,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(r, timeout=60) as f:
        out = json.load(f)
    if not out.get("success"):
        raise SystemExit(f"API error {method} {url}: {out.get('errors')}")
    return out.get("result")

for name in hostnames:
    q = urllib.parse.urlencode({"type": "CNAME", "name": name, "per_page": 100})
    existing = req("GET", f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records?{q}")
    match = next((e for e in existing if e.get("content") == target), None)
    body = {
        "type": "CNAME",
        "name": name,
        "content": target,
        "ttl": 1,
        "proxied": True,
        "comment": "vivijure-local cloudflared ingress (sync-tunnel-dns)",
    }
    if match:
        rid = match["id"]
        same = match.get("proxied") is True and (match.get("comment") or "") == body["comment"]
        if same:
            print(f"OK  CNAME {name} (unchanged)")
            continue
        print(f"== update CNAME {name} -> {target}")
        if not dry:
            req("PUT", f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records/{rid}", body)
    else:
        print(f"== create CNAME {name} -> {target}")
        if not dry:
            req("POST", f"https://api.cloudflare.com/client/v4/zones/{zid}/dns_records", body)

print()
print("done; restart cloudflared after config.yml ingress edits:")
print("  COMPOSE_PROFILES=tunnel docker compose up -d --force-recreate cloudflared")
PY
