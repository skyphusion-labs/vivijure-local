#!/usr/bin/env bash
# Bypass Cloudflare edge cache for MinIO tunnel hostnames (SigV4 HeadObject breaks when CF
# rewrites HEAD or caches S3 API traffic). Idempotent; merges with existing cache rules.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... npm run sync:minio-cache-rules
#
# See docs/MINIO-TUNNEL.md and https://stackoverflow.com/questions/76608350
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-${ROOT}/cloudflared/config.yml}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (Zone > Cache Rules > Edit)}"

ZONE_ID="${CF_ZONE_ID_SKYPHUSION_ORG:-3b58b52bd324332fb56b3ab685588c76}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "$CONFIG" ]]; then
  echo "missing config: $CONFIG" >&2
  exit 1
fi

export CONFIG ZONE_ID DRY_RUN
python3 <<'PY'
import json, os, re, urllib.parse, urllib.request

config = os.environ["CONFIG"]
zid = os.environ["ZONE_ID"]
dry = os.environ.get("DRY_RUN") == "1"
tok = os.environ["CLOUDFLARE_API_TOKEN"]

hostnames = []
in_ingress = False
for raw in open(config, encoding="utf-8"):
    line = raw.split("#", 1)[0].rstrip()
    if not line.strip():
        continue
    if re.match(r"^ingress:\s*$", line):
        in_ingress = True
        continue
    if in_ingress:
        m = re.match(r"^\s+-\s+hostname:\s*(\S+)", line)
        if m:
            h = m.group(1)
            if "minio" in h:
                hostnames.append(h)
            continue
        if re.match(r"^\s+-\s+service:\s+http_status:", line):
            break

if not hostnames:
    raise SystemExit(f"no minio ingress hostnames in {config}")

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

entry_url = f"https://api.cloudflare.com/client/v4/zones/{zid}/rulesets/phases/http_request_cache_settings/entrypoint"
entry = req("GET", entry_url)
rules = list(entry.get("rules") or [])
ruleset_id = entry["id"]

desc = "vivijure-local MinIO tunnel bypass cache (SigV4 HeadObject)"
parts = " or ".join(f'(http.host eq "{h}")' for h in hostnames)
expr = f"({parts})"

existing = next((r for r in rules if r.get("description") == desc), None)
new_rule = {
    "action": "set_cache_settings",
    "action_parameters": {"browser_ttl": {"mode": "bypass"}, "cache": False},
    "description": desc,
    "enabled": True,
    "expression": expr,
}

if existing:
    same = (
        existing.get("expression") == expr
        and existing.get("action") == new_rule["action"]
        and (existing.get("action_parameters") or {}).get("cache") is False
    )
    if same:
        print(f"OK  cache rule unchanged for {', '.join(hostnames)}")
    else:
        print(f"== update cache rule for {', '.join(hostnames)}")
        rules = [new_rule if r.get("description") == desc else r for r in rules]
        if not dry:
            req("PUT", entry_url, {"rules": rules})
else:
    print(f"== add cache bypass for {', '.join(hostnames)}")
    rules.append(new_rule)
    if not dry:
        req("PUT", entry_url, {"rules": rules})

print("done")
PY
