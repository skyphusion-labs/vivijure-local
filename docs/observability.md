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
`{"ev": ...}` convention documented in `skyphusion-labs/vivijure-cf` (`docs/observability.md`)
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

## Render-row telemetry columns (what is measured, and by whom)

Not every observable is an `ev` line. Three duration columns on `renders` are separate
measurements with separate producers, and **NULL in any of them means NOT MEASURED, never
zero**. A reported zero is a real measurement (a sub-millisecond stage rounded down) and is
stored as `0`; only an absent measurement is NULL. Do not `COALESCE(..., 0)` in a report:
that turns "we never measured this" into "this took no time".

| column | producer | NULL means |
|---|---|---|
| `execution_time_ms` | the GPU job envelope, written by core on the render-view update | the lane never reported a GPU time |
| `output_ms` | the delivered film length (migration 0018) | no length was measured |
| `finish_elapsed_ms` | the CPU finish containers, SUMMED per job (migration 0019, cf#268) | no finish stage reported its wall clock |

`finish_elapsed_ms` is capacity planning for the CPU finish tier: **not** billing and **not**
GPU time. Each container measures its OWN stage with `time.monotonic` and returns `elapsedMs`
on its success body; the shared orchestrator sums those onto the job
(`accumulateFinishElapsed`) and writes the total once, at `markFinishDone`. The column is
exposed as `finish_elapsed_ms` on every `GET /api/storyboard/renders` and
`GET /api/storyboard/renders/:id` response.

The seven emitting stages, which are the whole producer set (local#401). The two async doors
(\`POST /async/film-titles\`, \`POST /async/subtitle\`) share the synchronous stage measurement,
because they run the same work function:

| container | stages that report their own wall clock |
|---|---|
| `video-finish` | `POST /finish` (assemble or audio remux), `POST /film-titles`, `POST /subtitle` |
| `image-prep` | `POST /portrait/prep` |
| `audio-beat-sync` | `POST /analyze` |
| `audio-mix` | `POST /mix` |
| `audio-master` | `POST /master` |

**A column whose producer can silently disappear is how local#401 happened**: migration 0019
landed here without the cf#268 emitters, so the column was permanently NULL while looking
like real telemetry. `tests/finish-elapsed-ms-401.test.ts` is the guard. It reads the shipped
container sources (not a fixture), counts the emission sites against the table above, checks
that the key the containers emit is the key the installed core consumes, and asserts the
three end states apart: measured -> non-NULL, absent -> NULL, reported zero -> `0`. Delete an
emitter and that file goes red.

## What this is NOT

- **History UI text logs** (`src/render-log.ts`) are artifact objects for the studio History
  tab, not stdout. They are written when the RunPod-style render bookkeeping path fires.
- **HTTP poll responses** (`GET /api/storyboard/render/:id`) remain the primary operator
  progress channel. Stdout events are for tailing, alerting, and smoke assertions.

## Optional: ship stdout to Loki

If you run Grafana/Loki on your homelab, point a log shipper at the `studio` container
stdout (Promtail, Alloy, Vector, etc.) and index on the `ev` field. vivijure-local does
not ship or configure that stack; see upstream observability docs for the reference pipeline.
