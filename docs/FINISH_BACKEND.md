# Finish backend routing (homelab vs RunPod)

Tracking: [local#180](https://github.com/skyphusion-labs/vivijure-local/issues/180) (post-musetalk cutover).
Related: [local#153](https://github.com/skyphusion-labs/vivijure-local/issues/153) (local keyframe coupling; separate lane).

## Ruling (Conrad, 2026-07-22)

**No local RIFE.** RIFE is a separate RunPod worker (`vivijure-backend` finish path). Homelab users
are unlikely to need it; vivijure-local does not ship a `finish-rife` module sidecar or
`LOCAL_FINISH_RIFE_URL` wiring.

**Local panel default:** motion (local-gpu door) → raw clips → CPU `video-finish` assemble. No
per-clip finish GPU chain unless explicitly opted in for **lipsync and upscale only**.

**Modular architecture:** finish GPU modules are opt-in. Absent from the registry (no `MODULE_*_URL`)
= not in the per-clip finish chain; CPU `video-finish` assembles after motion. Present but
misconfigured (missing RunPod creds, unset `LOCAL_FINISH_*_URL` in local mode) = **fail the shot**,
never passthrough fake output.

| Panel | Finish GPU default | RIFE |
|-------|-------------------|------|
| **vivijure-local** (propagandhi / homelab) | **None** (CPU assemble only); optional local lipsync/upscale via `satellites` profile | **Not supported** (no module, no local serve) |
| **vivijure-cf** (production) | RunPod finish satellites (canonical testbed) | RunPod `finish-rife` on backend worker |

Homelab default stack: **door + CPU assemble only** (no finish GPU module URLs, no `satellites`
profile). Opt into lipsync/upscale sidecars with `COMPOSE_PROFILES=satellites` plus
`MODULE_LIPSYNC_URL` / `MODULE_UPSCALE_URL` in `.env`. CF panel keeps exercising the full RunPod
finish chain (RIFE, MuseTalk, upscale, audio-upscale) for regression and promotion.

Closed paths (do not revive): PR #185 (local finish-rife-serve overlay), fleet-chezmoi #1009
(propagandhi finish-rife image pin).

## Current behavior (pre-cutover)

Two-layer model today on propagandhi (legacy, being trimmed):

1. **Studio → module sidecar** (local HTTP): `MODULE_LIPSYNC_URL`, `MODULE_UPSCALE_URL` (and
   historically `MODULE_FINISH_RIFE_URL`) point at `module-finish-*` containers.
2. **Module sidecar → GPU** (RunPod today): each sidecar runs `scripts/finish-module-server.ts` and
   submits to RunPod or proxies to `LOCAL_FINISH_*_URL`.

On propagandhi, GPU finish work has used **local-panel RunPod endpoints** for lipsync/upscale (and
historically RIFE):

| Module | RunPod EP (local panel) | Image |
|--------|-------------------------|-------|
| `finish-lipsync` | `odz1x4bduwlqws` | `vivijure-musetalk` |
| `finish-upscale` | `dp3ofo30qcb988` | `vivijure-upscale` |
| `speech-upscale` | `hc9xccajqidda4` | `vivijure-audio-upscale` |
| `finish-rife` | `uf4iwoen5r48zx` (backend) | `vivijure-backend` — **CF/production only; not local panel** |

CPU assemble (`video-finish`, `audio-*`, `image-prep`) runs locally in compose. Motion i2v defaults
to **`LOCAL_BACKEND_URL`** (16gb door on propagandhi).

Canonical endpoint map: `fleet-chezmoi/docs/runbooks/vivijure-runpod-endpoints.md`.

## Target behavior

Mirror the **`local-gpu` module pattern** for finish (lipsync/upscale only):

| Layer | Today | Target (default `FINISH_BACKEND=local`) |
|-------|-------|----------------------------------------|
| Studio discovery | `MODULE_*_URL` → thin module sidecars | Unchanged (no `MODULE_FINISH_RIFE_URL`) |
| Sidecar GPU dispatch | RunPod API | HTTP proxy to **local finish service URLs** |
| Escape hatch | (implicit: only path) | `FINISH_BACKEND=runpod` or per-module `FINISH_<MODULE>_BACKEND=runpod` |

### Env vars (homelab, lipsync/upscale only)

| Variable | Purpose |
|----------|---------|
| `FINISH_BACKEND` | `local` (default after cutover) or `runpod` |
| `LOCAL_FINISH_LIPSYNC_URL` | HTTP base for MuseTalk / `lipsync_clip` |
| `LOCAL_FINISH_UPSCALE_URL` | HTTP base for video upscale / `upscale_clip` |
| `LOCAL_FINISH_TOKEN` | Optional bearer (same pattern as `LOCAL_BACKEND_TOKEN`) |
| `FINISH_LIPSYNC_BACKEND` | Optional per-module override (`local` \| `runpod`) |
| `FINISH_UPSCALE_BACKEND` | Optional per-module override |

**Not supported on vivijure-local:** `LOCAL_FINISH_RIFE_URL`, `MODULE_FINISH_RIFE_URL`,
`finish-rife-serve`, or any on-box RIFE HTTP service. RIFE stays on the RunPod backend worker for
vivijure-cf only.

When `FINISH_BACKEND=local` and a `LOCAL_FINISH_*_URL` is unset, the sidecar **fail-loud**
(`ok: false`, not silent RunPod fallback or passthrough). Homelabbers who want RunPod finish set
`FINISH_BACKEND=runpod`, enable the `satellites` profile, set `MODULE_LIPSYNC_URL` /
`MODULE_UPSCALE_URL`, and the existing `*_RUNPOD_ENDPOINT_ID` vars.

## Propagandhi live (2026-07-22 audit)

Verified on propagandhi (`10.1.1.7`):

| Container | Status | Action after #186 merge |
|-----------|--------|-------------------------|
| `vivijure-finish-gpu-finish-rife-1` | Running (healthy) | **Tear down** — no local RIFE path |
| `vivijure-local-module-finish-rife-1` | Running (legacy sidecar) | **Stop/remove** — not in default compose |
| `vivijure-finish-gpu-finish-{lipsync,upscale}-*` | Running | Keep if pursuing local lipsync/upscale; else tear down with finish-gpu stack |
| `vivijure-local-video-finish-1` | Running | **Keep** — CPU assemble path |

Minimal homelab bar after cutover: clips from local-gpu door → `video-finish` CPU assemble. No
finish GPU sidecars required.

```bash
# On propagandhi — remove RIFE (safe after studio env drops MODULE_FINISH_RIFE_URL)
cd /opt/fleet-chezmoi/system/stacks/propagandhi/vivijure-finish-gpu
sudo docker compose stop finish-rife && sudo docker compose rm -f finish-rife
```

## Minimal code change set (implementation PR, post-musetalk)

### vivijure-local

| File | Change |
|------|--------|
| `src/modules/local-finish/` | HTTP proxy handlers for lipsync/upscale only |
| `scripts/local-finish-module-server.ts` (new) | Sidecar entrypoint (like `local-gpu-module-server.ts`) |
| `scripts/runpod-module-server.ts` | Gate behind `resolveFinishBackend()`; keep RunPod path for `runpod` mode |
| `compose.yaml` | No `module-finish-rife`; lipsync/upscale gated behind `profiles: [satellites]` |
| `src/platform-secrets-catalog.ts` | Catalog entries (no local RIFE keys as supported paths) |
| `.env.example`, `docs/DEPLOYMENT.md`, `docs/install-profiles.md` | Operator docs |
| `scripts/smoke-exhaustive.ts` | Homelab smoke: local-gpu + CPU assemble; no RIFE step |

### fleet-chezmoi (separate PR, after code lands)

| File | Change |
|------|--------|
| `system/stacks/propagandhi/vivijure-local/.env.propagandhi.example` | Drop `LOCAL_FINISH_RIFE_URL`; `FINISH_BACKEND=local` for lipsync/upscale only |
| `system/stacks/propagandhi/vivijure-finish-gpu/` | Remove `finish-rife` service; lipsync/upscale only |
| `system/stacks/propagandhi/RUNBOOK-vivijure-local-topology.md` | §10: CPU assemble default; no local RIFE |

## Smoke / verify matrix trim

Post-cutover **propagandhi homelab bar**:

| Path | Motion | Keyframe | Finish GPU | RIFE | RunPod required |
|------|--------|----------|------------|------|-----------------|
| Default homelab smoke | `local-gpu` → door | local keyframe module (#153) | None (CPU assemble) | No | **No** |
| Optional local finish smoke | any | any | lipsync/upscale `FINISH_BACKEND=local` | No | No |
| Optional RunPod finish smoke | any | any | `SMOKE_FINISH_BACKEND=runpod` | No (local panel) | Yes (lipsync/upscale EPs) |
| CF production regression | own-gpu / cloud | RunPod SDXL | RunPod finish chain | Yes (RunPod) | Yes (prod EPs) |

## RunPod worker quota benefit

Local panel currently holds **idle workers** on finish endpoints for propagandhi traffic:

| Endpoint | Typical `workersMax` | Freed when local finish is default |
|----------|---------------------|-------------------------------------|
| Backend (`uf4iwoen5r48zx`) | 3 (keyframe + own-gpu pressure) | RIFE already off local path; keyframe off local path after #153 |
| MuseTalk (`odz1x4bduwlqws`) | 2 | Full endpoint idle for local panel |
| Video upscale (`dp3ofo30qcb988`) | 2 | Full endpoint idle for local panel |
| Audio upscale (`hc9xccajqidda4`) | 2 | Optional: move to local or keep for speech-upscale only |

Conservative estimate: **4–7 fewer warm RunPod workers** reserved for propagandhi finish traffic.

Wan cast LoRA train is **CF prod only** (Conrad ruling 2026-07-23). Homelab does not wire
`RUNPOD_WAN_TRAIN_ENDPOINT_ID`; local `/train-lora` defaults to SDXL on the render endpoint.

## Rollout order (post-musetalk smoke)

**Do not apply propagandhi live until Conrad signs off after musetalk jitter test.**

1. **Land vivijure-local #186** (compose trim, no RIFE sidecar, docs). Merge only after CI green.
2. **Tear down propagandhi `finish-rife`** (finish-gpu stack + stop `module-finish-rife` sidecar).
3. **Optional:** provision local lipsync/upscale HTTP on propagandhi (finish-gpu stack minus RIFE).
4. **Cut propagandhi `.env`**: no `MODULE_FINISH_RIFE_URL`; `FINISH_BACKEND=local` for lipsync/upscale if enabled.
5. **`npm run sync:secrets:compose`** + compose roll (`VJ_IMAGE_TAG` bump).
6. **Verify**: one full `local-gpu` film with CPU assemble (no finish GPU chain).
7. **Idle local-panel RunPod finish endpoints**; CF prod EPs unchanged.

## Non-goals

- Local RIFE (any form: serve overlay, on-box GPU, RunPod escape hatch on local panel).
- Changing **vivijure-cf** default finish routing (stays RunPod, including RIFE).
- Live propagandhi cutover before musetalk jitter smoke completes.
- MuseTalk handler jitter fixes (owned by agent `582d5f29`; do not touch those files in this lane).
