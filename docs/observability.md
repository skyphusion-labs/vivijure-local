# Observability (vivijure-local)

vivijure-local has **one** observability surface: **structured JSON lines on stdout**.
There is no Cloudflare tail consumer, no Loki, and no push channel. The studio process
logs events; Docker (or your process manager) captures them.

## How to read logs

```bash
# Follow the studio container
docker compose logs -f studio

# Grep render lifecycle on a homelab box
docker compose logs studio 2>&1 | grep '"ev":"film.phase"'
docker compose logs studio 2>&1 | grep '"ev":"film.render.terminal"'
```

For bare-metal `npm run dev`, the same JSON lines go to the terminal.

## Event shape

Every structured line is a single JSON object with an **`ev`** field (event name). Optional
fields carry context (`film_id`, `project`, `job_id`, `shot_id`, etc.). This matches the
`{"ev": ...}` convention documented in upstream vivijure (`docs/observability.md` in the `skyphusion-labs/vivijure` repo)
so greps and smoke tests can be ported later.

Implementation: `@skyphusion-labs/vivijure-core` (`emitStructuredEvent`).

## Event catalog (Phase 2)

| `ev` | When |
|------|------|
| `film.phase` | Film job phase changes (`from` / `to`) on persist |
| `film.render.terminal` | Film reaches `done` or `failed` |
| `film.finish_unavailable` | Assemble/mux degraded because video-finish tier unavailable |
| `film.keyframes_incomplete` | Keyframe stall recovery delivered a partial set |
| `clip.validate` | Layer-1 structural clip validation on a done shot |
| `clip.content_validate` | Layer-2 pixel/content validation on a done shot |
| `d1.retry` / `d1.exhausted` | Transient SQLite retry on the render-advance path |
| `render.bookkeeping_deferred` | D1 render row insert failed (non-fatal) |

## What this is NOT

- **History UI text logs** (`src/render-log.ts`) are artifact objects for the studio History
  tab, not stdout. They are written when the RunPod-style render bookkeeping path fires.
- **HTTP poll responses** (`GET /api/storyboard/render/:id`) remain the primary operator
  progress channel. Stdout events are for tailing, alerting, and smoke assertions.

## Optional: ship stdout to Loki

If you run Grafana/Loki on your homelab, point a log shipper at the `studio` container
stdout (Promtail, Alloy, Vector, etc.) and index on the `ev` field. vivijure-local does
not ship or configure that stack; see upstream observability docs for the reference pipeline.
