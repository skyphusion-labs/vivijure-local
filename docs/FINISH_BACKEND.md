# Finish backend routing (homelab vs RunPod)

Tracking: [local#180](https://github.com/skyphusion-labs/vivijure-local/issues/180) (post-musetalk cutover).
Related: [local#153](https://github.com/skyphusion-labs/vivijure-local/issues/153) (local keyframe coupling; separate lane).

## Ruling (Conrad, 2026-07-22)

After musetalk jitter smoke lands, **drop RunPod as the default finish path on vivijure-local homelab**.

**Modular architecture:** finish GPU modules are opt-in. Absent from the registry (no `MODULE_*_URL`)
= not in the per-clip finish chain; CPU `video-finish` assembles after motion. Present but
misconfigured (missing RunPod creds, unset `LOCAL_FINISH_*_URL` in local mode) = **fail the shot**,
never passthrough fake output.

| Panel | Finish GPU default | RunPod role |
|-------|-------------------|-------------|
| **vivijure-local** (propagandhi / homelab) | Local GPU door + **local finish sidecars** (HTTP on-box or VLAN) | Optional escape hatch (`FINISH_BACKEND=runpod`) |
| **vivijure-cf** (production) | RunPod finish satellites (canonical testbed) | Unchanged |

Homelab default stack: **door + CPU assemble only** (no finish GPU module URLs, no `satellites`
profile). Opt into finish sidecars with `COMPOSE_PROFILES=satellites` plus `MODULE_FINISH_*_URL`
in `.env`, or the local RIFE overlay in PR #185. CF panel keeps exercising RunPod finish (RIFE,
MuseTalk, upscale, audio-upscale) for regression and promotion.

## Current behavior (pre-cutover)

Two-layer model today:

1. **Studio → module sidecar** (always local HTTP): `MODULE_FINISH_RIFE_URL`, `MODULE_LIPSYNC_URL`, `MODULE_UPSCALE_URL` point at `module-finish-*` containers on the compose network.
2. **Module sidecar → GPU** (RunPod today): each sidecar runs `scripts/runpod-module-server.ts` and submits to `https://api.runpod.ai/v2/{endpointId}/run`.

On propagandhi, GPU finish work runs on **four local-panel RunPod endpoints** (not on-box GPU containers):

| Module | RunPod EP (local panel) | Image |
|--------|-------------------------|-------|
| `finish-rife` | `uf4iwoen5r48zx` (backend) | `vivijure-backend` |
| `finish-lipsync` | `odz1x4bduwlqws` | `vivijure-musetalk` |
| `finish-upscale` | `dp3ofo30qcb988` | `vivijure-upscale` |
| `speech-upscale` | `hc9xccajqidda4` | `vivijure-audio-upscale` |

CPU assemble (`video-finish`, `audio-*`, `image-prep`) already runs locally in compose. Motion i2v already defaults to **`LOCAL_BACKEND_URL`** (16gb door on propagandhi).

Canonical endpoint map: `fleet-chezmoi/docs/runbooks/vivijure-runpod-endpoints.md`.

## Target behavior

Mirror the **`local-gpu` module pattern** for finish:

| Layer | Today | Target (default `FINISH_BACKEND=local`) |
|-------|-------|----------------------------------------|
| Studio discovery | `MODULE_*_URL` → thin module sidecars | Unchanged |
| Sidecar GPU dispatch | RunPod API | HTTP proxy to **local finish service URLs** |
| Escape hatch | (implicit: only path) | `FINISH_BACKEND=runpod` or per-module `FINISH_<MODULE>_BACKEND=runpod` |

### New env vars (homelab)

| Variable | Purpose |
|----------|---------|
| `FINISH_BACKEND` | `local` (default after cutover) or `runpod` |
| `LOCAL_FINISH_RIFE_URL` | HTTP base for RIFE / `finish_clip` (e.g. backend handler on GPU box) |
| `LOCAL_FINISH_LIPSYNC_URL` | HTTP base for MuseTalk / `lipsync_clip` |
| `LOCAL_FINISH_UPSCALE_URL` | HTTP base for video upscale / `upscale_clip` |
| `LOCAL_FINISH_TOKEN` | Optional bearer (same pattern as `LOCAL_BACKEND_TOKEN`) |
| `FINISH_RIFE_BACKEND` | Optional per-module override (`local` \| `runpod`) |
| `FINISH_LIPSYNC_BACKEND` | Optional per-module override |
| `FINISH_UPSCALE_BACKEND` | Optional per-module override |

When `FINISH_BACKEND=local` and a `LOCAL_FINISH_*_URL` is unset, the sidecar **fail-loud**
(`ok: false`, not silent RunPod fallback or passthrough). Homelabbers who want RunPod set
`FINISH_BACKEND=runpod`, enable the `satellites` profile, set `MODULE_FINISH_*_URL`, and the
existing `*_RUNPOD_ENDPOINT_ID` vars.

## Minimal code change set (implementation PR, post-musetalk)

### vivijure-local

| File | Change |
|------|--------|
| `src/modules/local-finish/` (new) | HTTP proxy handlers mirroring `local-gpu/handlers.ts`; map module invoke/poll to local finish `/run` + `/status/{id}` |
| `scripts/local-finish-module-server.ts` (new) | Sidecar entrypoint (like `local-gpu-module-server.ts`) |
| `scripts/runpod-module-server.ts` | Gate behind `resolveFinishBackend()`; keep RunPod path for `runpod` mode |
| `src/modules/runpod/env.ts` | Add `resolveFinishBackend()`, `localFinishUrlFor(moduleName)` |
| `compose.yaml` | `module-finish-*` command switches on `FINISH_BACKEND`; pass `LOCAL_FINISH_*` env |
| `src/platform-secrets-catalog.ts` | Catalog entries (this prep PR) |
| `.env.example`, `docs/DEPLOYMENT.md`, `docs/install-profiles.md` | Operator docs |
| `scripts/smoke-exhaustive.ts` | Trim matrix: homelab full-film smoke uses `local-gpu` + local finish; skip RunPod finish unless `SMOKE_FINISH_BACKEND=runpod` |
| `scripts/finish-stack-verify.ts` | Assert `FINISH_BACKEND=local` + sidecar health when verifying propagandhi |

### fleet-chezmoi (separate PR, after code lands)

| File | Change |
|------|--------|
| `system/stacks/propagandhi/vivijure-local/.env.propagandhi.example` | `FINISH_BACKEND=local`, `LOCAL_FINISH_*` URLs; comment out local-panel RunPod finish EP IDs |
| `system/stacks/propagandhi/RUNBOOK-vivijure-local-topology.md` | §10: local finish sidecars, not RunPod chain |
| New stack dir (TBD) | Compose for on-box GPU finish services (musetalk, upscale, rife) on propagandhi GEX44 |

### Satellite repos (may be needed)

RunPod handler images (`vivijure-musetalk`, `vivijure-upscale`, `vivijure-backend` finish path) may need a **long-running HTTP server mode** for homelab sidecars (today they are RunPod-only). Scope that in the implementation PR after musetalk smoke; do not block doc prep.

## Smoke / verify matrix trim

Post-cutover **propagandhi homelab bar**:

| Path | Motion | Keyframe | Finish GPU | RunPod required |
|------|--------|----------|------------|-----------------|
| Default homelab smoke | `local-gpu` → door | local keyframe module (#153) | `FINISH_BACKEND=local` | **No** |
| Optional RunPod finish smoke | any | any | `SMOKE_FINISH_BACKEND=runpod` | Yes (local-panel EPs) |
| CF production regression | own-gpu / cloud | RunPod SDXL | RunPod finish chain | Yes (prod EPs) |

`npm run smoke:exhaustive` on propagandhi should not consume local-panel RunPod quota for finish unless explicitly opted in.

## RunPod worker quota benefit

Local panel currently holds **idle workers** on finish endpoints for propagandhi traffic:

| Endpoint | Typical `workersMax` | Freed when local finish is default |
|----------|---------------------|-------------------------------------|
| Backend (`uf4iwoen5r48zx`) | 3 (RIFE + keyframe + own-gpu pressure) | RIFE + keyframe off local path |
| MuseTalk (`odz1x4bduwlqws`) | 2 | Full endpoint idle for local panel |
| Video upscale (`dp3ofo30qcb988`) | 2 | Full endpoint idle for local panel |
| Audio upscale (`hc9xccajqidda4`) | 2 | Optional: move to local or keep for speech-upscale only |

Conservative estimate: **4–7 fewer warm RunPod workers** reserved for propagandhi finish traffic, returning quota headroom to the **CF panel** (canonical RunPod finish testbed) and reducing `workersMax restore failed … quota 30` class failures on the local panel.

Wan LoRA train (`8kjcn5sz6k8p1n`) stays RunPod-only on local panel until a local train path exists.

## Rollout order (post-musetalk smoke)

**Do not apply propagandhi live until Conrad signs off after musetalk jitter test (agent `582d5f29`).**

1. **Land vivijure-local implementation PR** (`FINISH_BACKEND`, local-finish sidecar proxy, tests). Merge only after CI green; do not pin propagandhi yet.
2. **Provision local finish GPU services on propagandhi** (fleet-chezmoi stack: musetalk + upscale + rife HTTP on GEX44; join `vivijure-local_studio` network). Verify each `/health` from studio network.
3. **Cut propagandhi `.env`**: `FINISH_BACKEND=local`, set `LOCAL_FINISH_*_URL`, unset local-panel `MUSETALK_RUNPOD_ENDPOINT_ID`, `VIDEO_UPSCALE_RUNPOD_ENDPOINT_ID`, and backend EP for RIFE-only use (keep EP if keyframe/own-gpu still need it until #153 lands).
4. **`npm run sync:secrets:compose`** + full compose roll (`VJ_IMAGE_TAG` bump, all services same tag).
5. **Verify**: `npm run finish-stack:verify` with `FINISH_VERIFY_FILM_ID` (voiced bar); one full `local-gpu` film with finish chain.
6. **Idle local-panel RunPod finish endpoints** (scale `workersMax` to 0 or delete EPs per runbook); CF prod EPs unchanged.
7. **Trim smoke matrix** in CI/docs; optional periodic `SMOKE_FINISH_BACKEND=runpod` job for escape-hatch regression.

## Non-goals

- Changing **vivijure-cf** default finish routing (stays RunPod).
- Live propagandhi cutover before musetalk jitter smoke completes.
- MuseTalk handler jitter fixes (owned by agent `582d5f29`; do not touch those files in this lane).
