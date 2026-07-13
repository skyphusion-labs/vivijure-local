# API parity checklist

Canonical spec: [vivijure/docs/CONTRACT.md](https://github.com/skyphusion-labs/vivijure/blob/main/docs/CONTRACT.md)

Mark each route when implemented **and** covered by a test. Status: `[ ]` pending, `[~]` partial, `[x]` done.

## System

- [x] `GET /health`
- [x] `GET /api/whoami` (token-gated in `AUTH_MODE=token`, same as upstream)
- [x] `GET /api/modules`

## Projects

- [x] `GET /api/storyboard/projects`
- [x] `POST /api/storyboard/projects`
- [x] `GET /api/storyboard/projects/:id`
- [x] `PATCH /api/storyboard/projects/:id`
- [x] `DELETE /api/storyboard/projects/:id`
- [x] `PUT /api/storyboard/projects/:id/storyboard` (implemented as `POST`, same as upstream)

## Cast

- [x] `GET /api/cast`
- [x] `POST /api/cast`
- [x] `GET /api/cast/:id`
- [x] `PATCH /api/cast/:id`
- [x] `DELETE /api/cast/:id`
- [x] `POST /api/cast/:id/portrait`
- [x] `POST /api/cast/:id/ref`
- [x] `POST /api/cast/:id/source`
- [x] `POST /api/cast/:id/generate-refs`
- [x] `GET /api/cast/:id/refs-job/:jobId`
- [x] `POST /api/cast/:id/train-lora`
- [x] `GET /api/cast/:id/lora-status`
- [x] `GET /api/cast/export/:id`
- [x] `POST /api/cast/export/:id`
- [x] `POST /api/cast/import`

## Planner

- [x] `GET /api/storyboard/models` (derived from installed `plan.enhance` modules, not a hardcoded catalog)
- [x] `POST /api/storyboard/plan` (scaffold → `plan.enhance` module `mode: plan`)
- [x] `POST /api/storyboard/refine` (scaffold → `plan.enhance` module `mode: refine`)
- [x] `POST /api/chat` text path (scaffold → `plan.enhance` module `mode: chat`)
- [x] `POST /api/storyboard/preflight`
- [x] `POST /api/audio/analyze`
- [x] `POST /api/storyboard/enhance`
- [x] `POST /api/storyboard/bundle`

## Chat

- [x] `POST /api/chat` (text via plan.enhance; image models via Workers AI / gateway)
- [x] `GET /api/models` (image-gen catalog for cast portrait UI)

## Render (storyboard aliases)

- [x] `POST /api/storyboard/render`
- [x] `GET /api/storyboard/render/:jobId` (film-* and scatter-*)
- [x] `POST /api/storyboard/render/scatter`

## Render (explicit)

- [x] `POST /api/render/film`
- [x] `GET /api/render/film/:id`
- [x] `POST /api/render/clips`
- [x] `GET /api/render/clips/:id`

## Library

- [x] `GET /api/storyboard/renders`
- [x] `PATCH /api/storyboard/renders/:id`
- [x] `DELETE /api/storyboard/renders/:id`

## Artifacts

- [x] `POST /api/upload`
- [x] `GET /api/artifact/*key` (incl. Range)

## Prefs

- [x] `GET /api/prefs`
- [x] `PATCH /api/prefs`

## Module admin (optional v1)

- [x] `GET /api/modules/:name/config`
- [x] `PATCH /api/modules/:name/config`
- [x] `GET /api/settings/secrets`
- [x] `PATCH /api/settings/secrets`

## Module contract (conformance)

- [x] All hooks in `vivijure-module/2` pass `npm run conformance` against local sidecars (`npm run conformance:compose` with stack up)
- [x] `GET /api/modules` projection matches upstream shape (modules, hooks, catalog, render tiers)
- [x] Module conformance unit suite (`tests/conformance.test.ts`) green

## Auth modes

- [x] `AUTH_MODE=token` (v1 target)
- [x] `AUTH_MODE=demo` (seed data + `/api/demo/*`; run `npm run migrate:demo`)
- [ ] CF Access (non-goal for local)

## Film poll phases

Verify poll responses advance through phases identically to upstream (`tests/film-poll-phases.test.ts`):

- [x] keyframe
- [x] clips (poll `phase: i2v`)
- [x] dialogue
- [x] speech
- [x] finish
- [x] assemble
- [x] master
- [x] mux
- [ ] score (folded into chain; no separate `FilmJob.phase`)
- [ ] film.finish (same)
- [ ] notify (folded into chain; no separate `FilmJob.phase`)
- [x] done

## Chain module sidecars (compose)

- [x] `plan.enhance` (`MODULE_PLANENHANCE_URL`, model choice in module; Opus via gateway or local llama fallback)
- [x] `cast.image` (`MODULE_CAST_IMAGE_URL`)
- [x] `dialogue` (`MODULE_DIALOGUE_URL` -> dialogue-gen sidecar)
- [x] `speech` (`MODULE_SPEECH_UPSCALE_URL`)
- [x] `notify` (`MODULE_NOTIFY_EMAIL_URL`)

## UI smoke (manual)

- [x] `/planner` loads module panels from registry (`GET /api/modules` + static UI)
- [x] `/cast` CRUD works (`tests/m3` + host parity cast routes)
- [x] `/settings` module config renders
- [x] `/settings` connection & API keys panel (GUI secrets store; studio token excluded)
- [x] Render submit -> history -> artifact playback (`npm run smoke:exit`)

## Core dependency

- [x] `@skyphusion-labs/vivijure-core` `^0.9.2` (mux hasAudio guard; orchestration parity)

## Ops hardening (compose / flatliners)

- [x] MinIO root creds from `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (not hardcoded `minioadmin`)
- [x] `npm run rotate:minio-creds` helper + docs
- [x] CPU module sidecar healthchecks on module ports (`9120`–`9131`, not studio `:8790`)
- [x] Background `render-sweep` cron in studio host (`server.ts`, every 60s; disable with `RENDER_SWEEP_ENABLED=false`)
- [x] `cloud-keyframe` sidecar (AI Gateway image gen, not RunPod stub)
