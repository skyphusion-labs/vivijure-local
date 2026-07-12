#!/usr/bin/env bash
# House style: no Unicode en-dash (U+2013) or em-dash (U+2014). Use -- in prose.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - <<'PY'
import re
import subprocess
import sys

pat = re.compile("[\u2013\u2014]")
proc = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True)
files = [f for f in proc.stdout.splitlines() if f.strip()]
hits = []
for path in files:
    try:
        with open(path, encoding="utf-8") as fh:
            for i, line in enumerate(fh, 1):
                if pat.search(line):
                    hits.append(f"{path}:{i}:{line.rstrip()}")
    except (OSError, UnicodeDecodeError):
        continue
if hits:
    for h in hits:
        print(h, file=sys.stderr)
    print(
        "house-style: replace en/em dashes with -- (double hyphen) or commas/parentheses",
        file=sys.stderr,
    )
    sys.exit(1)
print("house-style: no Unicode en/em dashes in tracked sources")
PY
