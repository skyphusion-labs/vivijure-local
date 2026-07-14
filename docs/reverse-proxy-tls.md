# Public HTTPS (moved)

The reverse-proxy guide now lives in **[EDGE.md](EDGE.md)**.

Use compose profile `edge` (not `reverse-proxy` or `tunnel`):

```bash
npm run install:edge
COMPOSE_PROFILES=edge npm run compose:up
```
