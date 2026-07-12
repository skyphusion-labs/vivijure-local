# CLAUDE.md -- vivijure-local

## What this is

**Vivijure Local:** provider-neutral host for the Vivijure Studio control plane. Same modular architecture and reference API as `skyphusion-labs/vivijure`; no Cloudflare runtime.

Upstream canon for the wire contract: `vivijure/docs/CONTRACT.md` and `vivijure/docs/module-api.md`.

## Strategy (locked)

1. **Option B (now):** fork-adapt vivijure `src/` into this repo behind `src/platform/` adapters. Prove CONTRACT parity to the crew.
2. **Option A (vivijure v2.0):** extract shared orchestration into a `vivijure-core` package; shrink both repos to hosts.

Design platform interfaces in `src/platform/types.ts` so v2 extraction is mechanical, not a rewrite.

## Rules

- **API parity is non-negotiable.** Every route, status code, and JSON shape in upstream `CONTRACT.md` must match. Track progress in `docs/PARITY.md`.
- **Do not change backend engines.** RunPod, `vivijure-local-12gb`, CPU containers keep their wire contracts.
- **Do not fork `public/` long-term.** Copy stays in sync with upstream until v2 shared UI packaging exists.
- **Module contract is sacred.** `src/modules/types.ts` must match upstream byte-for-byte unless the epoch bumps in both repos together.
- **Minimal runtime deps.** Node HTTP (Hono), built-in `node:sqlite`, optional MinIO client. No framework SPA build.
- **`npm run typecheck` is the gate** before push.

## Commands

```bash
npm run typecheck
npm test
npm run dev
docker compose up -d    # CPU media stack + optional MinIO
```

## Port map (local profile)

| Service | Port |
|---------|------|
| Studio API + UI | 8790 |
| video-finish | 8780 |
| image-prep | 8781 |
| audio-beat-sync | 8782 |
| audio-mix | 8783 |
| audio-master | 8784 |
| MinIO API | 9000 |
| Module sidecars | 9100+ (see `.env.example`) |

## Crew identity

Cursor/rancid work: commits as `Conrad Rockenhaus <conrad@skyphusion.org>`. Branch + PR workflow; never push to `main` unless Conrad says so.
