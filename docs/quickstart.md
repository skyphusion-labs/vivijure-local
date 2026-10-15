# Quick start: homelab stack

This is the short path to a **local** Vivijure Studio: one `docker compose` command, no
Cloudflare account, no Workers bindings, and **no RunPod modules** in the default stack. When you
finish this page you will have the studio API, the planner UI, MinIO, Ollama (plan.enhance), CPU
media containers, and the CPU media stack (add COMPOSE_PROFILES=localgpu + a door URL for local-gpu).

> **Homelab / hobbyist host.** `vivijure-local` ships **full parity** with
> [`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf) on the same module contract.
> Default path: **Ollama plan.enhance → unload → local-gpu keyframe (16GB door first) → CPU finish**.
> RunPod is opt-in only ([local#265](https://github.com/skyphusion-labs/vivijure-local/issues/265),
> [local#200](https://github.com/skyphusion-labs/vivijure-local/issues/200)). For production
> workloads, use [`vivijure-cf`](https://github.com/skyphusion-labs/vivijure-cf).

New here? The one-page picture of how the parts fit together is in [constellation.md](constellation.md).
You are standing up the **vivijure-local** box on that map.

## Before you start

You need:

- **Docker** with Compose v2 (Linux, macOS, or WSL).
- **Node 22 or newer** on your computer (for `npm test`, smoke scripts, and optional host-native dev).
- About **4 GB free disk** for images, MinIO data, and render artifacts.

You do **not** need:

- A Cloudflare account or AI Gateway (planning defaults to local Ollama).
- A RunPod account (RunPod modules are `COMPOSE_PROFILES=cloud` only).
- A GPU to bring the stack **up** (Ollama can run on CPU). You do need one to **render**: without a
  door the `local-gpu` module is not in the stack at all, and the host reports `keyframe` /
  `motion.backend` unavailable rather than producing placeholder frames (local#229, local#280).

## The three steps

```bash
git clone https://github.com/skyphusion-labs/vivijure-local
cd vivijure-local
npm run install:studio      # mint token, seed platform_secrets, write .studio-token
npm run compose:up          # docker compose pull && up -d
curl -fsS http://127.0.0.1:8790/health
```

Open **http://127.0.0.1:8790** in a browser. Paste the token from `.studio-token` when the UI asks.

| Service | URL |
|---------|-----|
| Studio API + UI | http://127.0.0.1:8790 |
| MinIO API | http://127.0.0.1:9000 |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |
| Ollama (plan.enhance) | http://127.0.0.1:11434 (default model **`qwen3:14b`**, ~9.3GB; 16GB door) |
| CPU media health | http://127.0.0.1:8780-8784 (`/health`) |

Stop the stack: `npm run compose:down`

## Your login: the studio API token

`npm run install:studio` mints a random token, writes it to `.studio-token` (mode `0600`), updates
`.env`, and seeds `platform_secrets` in the studio database. The running studio also bootstraps any
missing secret rows from env on startup (compose defaults for storage and module URLs land in the DB
the first time the container starts).

Compose still passes `STUDIO_API_TOKEN` through env for bootstrap; after seeding, the DB value wins.

The studio **fails closed**: every `/api/*` request needs `Authorization: Bearer <token>`. The UI
stores the token in your browser only. API callers send the same header.

Mint a new token any time:

```bash
npm run install:studio   # mint + seed DB; re-run only rotates .env when still on the placeholder
# or rotate manually:
openssl rand -hex 32
# paste into .env as STUDIO_API_TOKEN, run npm run bootstrap:secrets, then: docker compose up -d studio
```

## What compose starts

One `compose.yaml` brings up:

1. **studio** -- Node control plane (API + static UI from the shared `public/`).
2. **minio** -- S3-compatible object store for renders, bundles, and job state.
3. **ollama** + **ollama-pull** -- open-weight `plan.enhance` (default **`qwen3:14b`**, ~9.3GB Q4;
   fits a 16GB door with headroom). `npm run compose:up` waits for the pull on first boot.
   Unloaded after plan and before keyframe (never concurrent with the door on the same card).
4. **CPU media** -- `video-finish`, `image-prep`, `audio-beat-sync`, `audio-mix`, `audio-master`.
5. **Module sidecars** -- plan-enhance, beat-sync, audio-master, film-titles, subtitle, and the other
   CPU/chain modules. `local-gpu` (keyframe + motion) joins only with the `localgpu` profile, i.e. once
   you have a GPU door.

Compose defaults `PLANNER_AI_MOCK=false` and points plan.enhance at Ollama. For offline CI without
pulling a model, set `PLANNER_AI_MOCK=true`. On NVIDIA hosts sharing the door GPU, add
`compose.ollama-nvidia.yaml` (see [DEPLOYMENT.md](DEPLOYMENT.md)). AI Gateway remains an opt-in
overlay.

## Prove the pipeline (smoke test)

With the stack running:

```bash
npm run smoke:exit
```

This runs **bundle -> render -> poll -> artifact HEAD** against the live stack. A passing run means
the homelab exit criterion is green (see [ROADMAP.md](ROADMAP.md)).

Module contract checks:

```bash
npm run conformance:compose
```

## Growing later

- **A complete film without RunPod (the default path):** Ollama for planning, then
  `LOCAL_BACKEND_URL=http://vivijure-local-16gb:8000` (16GB door first) for keyframes + motion, CPU
  `video-finish` to assemble. Optional CF AI Gateway only for dialogue/music/narration overlays.
  See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Real GPU (16GB door first):** run [`vivijure-local-16gb`](https://github.com/skyphusion-labs/vivijure-local-16gb)
  (or the 12GB alternate) on your host; set `LOCAL_BACKEND_URL`, run `npm run install:studio` (it
  enables the `localgpu` profile for you), then `docker compose up -d`.
  See [DEPLOYMENT.md](DEPLOYMENT.md) and [install-profiles.md](install-profiles.md).
- **Local finish sidecars:** `FINISH_BACKEND` already defaults to `local`; add `LOCAL_FINISH_*_URL`
  ([FINISH_BACKEND.md](FINISH_BACKEND.md)).
- **Public HTTPS** (studio + MinIO for remote GPU fetch): [EDGE.md](EDGE.md)
  (`npm run install:edge`, then `COMPOSE_PROFILES=edge npm run compose:up`).
- **Install profiles** (satellites, own GPU, filesystem storage): [install-profiles.md](install-profiles.md).
- **Structured logs** (`docker compose logs studio`, `ev` JSON lines): [observability.md](observability.md).
- **RunPod escape hatch:** `FINISH_BACKEND=runpod` or cloud `MODULE_*_URL` overrides when you want
  `vivijure-backend` instead of on-box GPU. Not the homelab default.
- **Production / Cloudflare:** [vivijure-cf](https://github.com/skyphusion-labs/vivijure-cf)
  ([quickstart](https://github.com/skyphusion-labs/vivijure-cf/blob/main/docs/quickstart.md)).
- **Full operator reference:** [DEPLOYMENT.md](DEPLOYMENT.md).

## If something goes wrong

- `curl :8790/health` fails: `docker compose ps` and `docker compose logs studio`.
- Render fails with "no keyframe module", or the panel says keyframe/motion are unavailable: you have
  no GPU door installed. Set `LOCAL_BACKEND_URL`, run `npm run install:studio`, and check
  `docker compose ps` shows `module-local-gpu` healthy. If it is missing entirely, the `localgpu`
  profile is off -- that is the no-door state, not a crash.
- Smoke times out: `docker compose logs -f studio` while polling; CPU containers must be healthy.
- Re-running `npm run compose:up` after pulling git is safe (re-pulls GHCR :latest).

For the full variable list and security model, use [DEPLOYMENT.md](DEPLOYMENT.md) and
[SECURITY.md](SECURITY.md).
