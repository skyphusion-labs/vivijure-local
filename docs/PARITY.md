# API parity checklist

Canonical spec: [vivijure/docs/CONTRACT.md](https://github.com/skyphusion-labs/vivijure/blob/main/docs/CONTRACT.md)

Mark each route when implemented **and** covered by a test. Status: `[ ]` pending, `[~]` partial, `[x]` done.

## System

- [x] `GET /health`
- [x] `GET /api/whoami` (token-gated in `AUTH_MODE=token`, same as upstream)
- [ ] `GET /api/modules`

## Projects

- [ ] `GET /api/storyboard/projects`
- [ ] `POST /api/storyboard/projects`
- [ ] `GET /api/storyboard/projects/:id`
- [ ] `PATCH /api/storyboard/projects/:id`
- [ ] `DELETE /api/storyboard/projects/:id`
- [ ] `PUT /api/storyboard/projects/:id/storyboard`

## Cast

- [ ] `GET /api/cast`
- [ ] `POST /api/cast`
- [ ] `GET /api/cast/:id`
- [ ] `PATCH /api/cast/:id`
- [ ] `DELETE /api/cast/:id`
- [ ] `POST /api/cast/:id/portrait`
- [ ] `POST /api/cast/:id/ref`
- [ ] `POST /api/cast/:id/source`
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

- [ ] `POST /api/storyboard/render`
- [ ] `GET /api/storyboard/render/:jobId`
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

- [ ] `POST /api/upload`
- [ ] `GET /api/artifact/*key` (incl. Range)

## Prefs

- [ ] `GET /api/prefs`
- [ ] `PATCH /api/prefs`

## Module admin (optional v1)

- [ ] `GET /api/modules/:name/config`
- [ ] `PATCH /api/modules/:name/config`

## Module contract (conformance)

- [ ] All hooks in `vivijure-module/2` pass `npm run conformance` against local sidecars
- [ ] `GET /api/modules` projection matches upstream shape (modules, hooks, catalog, render tiers)

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
