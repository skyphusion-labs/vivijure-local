# Quick start: homelab demo stack

This is the short path to a **local** Vivijure Studio: one `docker compose` command, no
Cloudflare account, no Workers bindings. When you finish this page you will have the studio API,
the planner UI, MinIO object storage, CPU media containers, and module sidecars (including GPU
mocks) on your machine.

> **Alpha software.** `vivijure-local` is demonstration scaffolding for a future homelab edition
> of the Vivijure Control Panel. It is **not production-ready**. APIs, compose layout, and
> platform adapters will change dramatically as we move toward `vivijure-core` and vivijure v2.0.
> Use it to explore the architecture and run the parity smoke tests; use upstream
> [`vivijure`](https://github.com/skyphusion-labs/vivijure) for a production studio today.

New here? The one-page picture of how the parts fit together is in [constellation.md](constellation.md).
You are standing up the **vivijure-local** box on that map.

## Before you start

You need:

- **Docker** with Compose v2 (Linux, macOS, or WSL).
- **Node 22 or newer** on your computer (for `npm test`, smoke scripts, and optional host-native dev).
- About **4 GB free disk** for images, MinIO data, and render artifacts.

You do **not** need:

- A Cloudflare account (unless you want live planner calls through AI Gateway).
- A GPU in Docker (compose ships mock keyframe + `local-gpu` sidecars for the demo render path).

## The three steps

```bash
git clone https://github.com/skyphusion-labs/vivijure-local
cd vivijure-local
cp .env.example .env          # set STUDIO_API_TOKEN to something you will remember
npm run compose:up              # docker compose up -d --build
curl -fsS http://127.0.0.1:8790/health
```

Open **http://127.0.0.1:8790** in a browser. Paste your `STUDIO_API_TOKEN` when the UI asks.

| Service | URL |
|---------|-----|
| Studio API + UI | http://127.0.0.1:8790 |
| MinIO API | http://127.0.0.1:9000 |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |
| CPU media health | http://127.0.0.1:8780-8784 (`/health`) |

Stop the stack: `npm run compose:down`

## Your login: the studio API token

Compose defaults `STUDIO_API_TOKEN=change-me-local-dev-only`. Change that in `.env` before you
expose the stack beyond localhost.

The studio **fails closed**: every `/api/*` request needs `Authorization: Bearer <token>`. The UI
stores the token in your browser only. API callers send the same header.

Mint a new token any time:

```bash
openssl rand -hex 32
# paste the value into .env as STUDIO_API_TOKEN, then: docker compose up -d studio
```

## What compose starts

One `compose.yaml` brings up:

1. **studio** -- Node control plane (API + static UI from upstream `public/`).
2. **minio** -- S3-compatible object store for renders, bundles, and job state.
3. **CPU media** -- `video-finish`, `image-prep`, `audio-beat-sync`, `audio-mix`, `audio-master`.
4. **Module sidecars** -- HTTP servers for `keyframe`, `local-gpu` (mocks by default), `beat-sync`,
   `audio-master`, `film-titles`, `subtitle`.

Compose sets `PLANNER_AI_MOCK=true` so `/planner` works without API keys. Set
`PLANNER_AI_MOCK=false` and add gateway or BYOK keys when you want live storyboard generation (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

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

- **Install profiles** (satellites, own GPU, filesystem storage): [install-profiles.md](install-profiles.md).
- **Structured logs** (`docker compose logs studio`, `ev` JSON lines): [observability.md](observability.md).
- **Real GPU motion:** point `MODULE_LOCAL_GPU_URL` at `vivijure-local-12gb` / `-16gb` on your host,
  or at `vivijure-backend` on RunPod. See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Production studio on Cloudflare:** follow upstream
  [docs/quickstart.md](https://github.com/skyphusion-labs/vivijure/blob/main/docs/quickstart.md).
- **Full operator reference:** [DEPLOYMENT.md](DEPLOYMENT.md).

## If something goes wrong

- `curl :8790/health` fails: `docker compose ps` and `docker compose logs studio`.
- Render fails with "no keyframe module": ensure `module-keyframe` and `module-local-gpu` are
  healthy (`docker compose ps`).
- Smoke times out: `docker compose logs -f studio` while polling; CPU containers must be healthy.
- Re-running `npm run compose:up --build` after pulling is safe.

For the full variable list and security model, use [DEPLOYMENT.md](DEPLOYMENT.md) and
[SECURITY.md](SECURITY.md).
