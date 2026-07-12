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
- [ ] `POST /api/cast/:id/generate-refs`
- [ ] `POST /api/cast/:id/train-lora`
- [ ] `GET /api/cast/export`
- [ ] `POST /api/cast/import`

## Planner

- [ ] `POST /api/storyboard/plan`
- [ ] `POST /api/storyboard/refine`
- [ ] `POST /api/storyboard/preflight`
- [ ] `POST /api/storyboard/enhance`
- [ ] `POST /api/storyboard/bundle`

## Chat

- [ ] `POST /api/chat`

## Render (storyboard aliases)

- [x] `POST /api/storyboard/render`
- [x] `GET /api/storyboard/render/:jobId`
- [ ] `POST /api/storyboard/render/scatter`
- [ ] `GET /api/storyboard/render/scatter/:jobId`

## Render (explicit)

- [ ] `POST /api/render/film`
- [ ] `GET /api/render/film/:id`
- [ ] `POST /api/render/clips`
- [ ] `GET /api/render/clips/:id`

## Library

- [ ] `GET /api/storyboard/renders`
- [ ] `PATCH /api/storyboard/renders/:id`
- [ ] `DELETE /api/storyboard/renders/:id`

## Artifacts

- [x] `POST /api/upload`
- [x] `GET /api/artifact/*key` (incl. Range)

## Prefs

- [x] `GET /api/prefs`
- [x] `PATCH /api/prefs`

## Module admin (optional v1)

- [ ] `GET /api/modules/:name/config`
- [ ] `PATCH /api/modules/:name/config`

## Module contract (conformance)

- [ ] All hooks in `vivijure-module/2` pass `npm run conformance` against local sidecars
- [x] `GET /api/modules` projection matches upstream shape (modules, hooks, catalog, render tiers)

## Auth modes

- [x] `AUTH_MODE=token` (v1 target)
- [ ] `AUTH_MODE=demo` (optional; seed data)
- [ ] CF Access (non-goal for local)

## Film poll phases

Verify poll responses advance through phases identically to upstream:

- [ ] keyframe
- [ ] clips
- [ ] dialogue
- [ ] speech
- [ ] finish
- [ ] assemble
- [ ] score
- [ ] master
- [ ] mux
- [ ] film.finish
- [ ] notify
- [ ] done

## UI smoke (manual)

- [ ] `/planner` loads module panels from registry
- [ ] `/cast` CRUD works
- [ ] `/settings` module config renders
- [ ] Render submit -> history -> artifact playback
