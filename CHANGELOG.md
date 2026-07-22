# Changelog


**Dual-panel release gate:** every studio feature ships to vivijure-cf and vivijure-local in the
same release wave ([[vivijure-hosted-parity-absolute]] in fleet memory:
`fleet-chezmoi/claude-memory/projects/-home-conrad-dev-vivijure/memory/vivijure-hosted-parity-absolute.md`).

## Unreleased

- **feat(ui):** Stages + planner render panels sort hooks by `catalog[].order` from core 1.2.6
  (core#54); drop hardcoded HOOK_ORDER / PANEL_ORDER (dual-panel with cf).
- **chore:** bump `@skyphusion-labs/vivijure-core` to `^1.2.6` (cf#110 + core#54).
- **docs:** `.env.example` + `DEPLOYMENT.md` document local panel `RUNPOD_WORKERS_MAX=3` and the
  12GB↔16GB door switch sequence (`sync:secrets:compose` + force-recreate; `platform_secrets` wins
  over compose env). Links local#153, fleet#962.
- **fix(e2e):** cast-page smoke asserts the list pane + empty-state status on a fresh DB instead of
  `toBeVisible()` on an empty `#cast-list` (local#113).

## v1.1.9 -- 2026-07-22

PATCH: dual-panel parity with vivijure-cf **v1.7.8** -- re-list `alibaba-wan-lora` on the default
compose stack (drop `profiles: [wan-lora]`), wire `MODULE_ALIBABA_WAN_LORA_URL` + `depends_on` on
studio. Matches the CF IaC re-list after the 2x2 Wan LoRA sign-off (cf#29 follow-up).

## v1.1.8 -- 2026-07-22

PATCH: pre-submit RunPod idle workersMax reconcile parity (cf#61). Bumps `@skyphusion-labs/vivijure-core`
to `^1.2.4`. RunPod module sidecars and `speech-upscale` chain handler reconcile before `/run` when
`RUNPOD_WORKERS_MAX` is configured (compose defaults: backend 3, satellites 2).

## v1.1.7 -- 2026-07-21

PATCH: bump `@skyphusion-labs/vivijure-core` to `^1.2.3` (#53 advanceFilmJob wedge fix, local#99
`output_key` honesty). Ships core#64 + core#65. Roll propagandhi after GHCR `:1.1.7` publish is green.

## v1.1.6 -- 2026-07-21

PATCH: security hardening + CI GPU allowlist sync (#144, #145, #146).

- **ci(build-image):** inline GPU allowlist sync on tag push (public repo cannot
  `workflow_call` internal fleet-chezmoi; #144).
- **fix(security):** bump `sharp` to 0.35.3; clear Dependabot + CodeQL alerts (#146).
- **fix(security):** SSRF `url_guard` on finish sidecars (audio-beat-sync, audio-master,
  audio-mix, image-prep, video-finish); Pillow 12.3.0 in image-prep/audio-beat-sync.
- **chore:** ignore `.wrangler` local dev state (#145).

No vivijure-cf bump required (local-only security + CI). Roll propagandhi after GHCR
`:1.1.6` publish is green.

## v1.1.5 -- 2026-07-21

PATCH: dual-panel parity with vivijure-cf v1.7.4 + core 1.2.2 (cf#29).

- Bumps `@skyphusion-labs/vivijure-core` to `^1.2.2` (legacy dialogue finish order default:
  RIFE -> lipsync -> upscale; #584 reorder opt-in).
- **Real Aura-1 TTS (#141):** dialogue-gen calls `@cf/deepgram/aura-1` via `aiRun` when gateway
  env is set; silent fallback only when unset.
- **TTS path fix:** `ai-run.ts` uses gateway path endpoint + binary `arrayBuffer` parse (unified
  JSON envelope returned empty `result:{}` for Aura-1).
- **Compose:** `module-dialogue-gen` inherits `ai-gateway-env` so TTS creds reach the sidecar.
- **`finish-stack:verify`:** `FINISH_VERIFY_FILM_ID` voiced bar (reject `lipsync:v15` at <= -60 dB).

Paired release with cf#179 / v1.7.4. Do not roll propagandhi until GHCR `:1.1.5` publish is green.

## v1.1.3 -- 2026-07-21

PATCH: Wan LoRA UI + planner preflight + test parity with vivijure-cf v1.7.3 (cf#29 follow-up).
Cast page trains Wan via `POST /train-wan-lora`; planner preflight checks `wan_lora_key_*` when
motion backend is `alibaba-wan-lora`. Ports `wan-lora-projection.test.ts`, `cast-lora-reconciler.test.ts`,
and `lora-preflight.test.ts`. Paired release; Laura test blocked until both hosts merge + ops CR apply.

## v1.1.2 -- 2026-07-20

PATCH: fix `compose.yaml` YAML indent on `RUNPOD_WAN_TRAIN_ENDPOINT_ID` under `module-speech-upscale`
and `studio` so `docker compose config` validates without on-box sed (propagandhi deploy hotfix).

## v1.1.1 -- 2026-07-20

PATCH: Wan cast LoRA train + harvest writeback parity with vivijure-cf v1.7.1 (cf#29). Bumps
`@skyphusion-labs/vivijure-core` to ^1.2.1 so `/api/cast/:id/lora-status` polls the dedicated Wan train
endpoint (`RUNPOD_WAN_TRAIN_ENDPOINT_ID`) before the render endpoint, harvesting dual expert keys on
COMPLETED. Adds `POST /api/cast/:id/train-wan-lora`, migration `0013` Wan key columns, Wan LoRA render
projection (storyboard render, scatter, film), and Settings secret `RUNPOD_WAN_TRAIN_ENDPOINT_ID`.

Dual-panel release rule: do not ship vivijure-cf v1.7.1 without this local PR merge-ready.

## v1.1.0 -- 2026-07-18

MINOR: the chat/image surface becomes module territory (vivijure-cf#129; full record on that
issue's completion contract). Carries one BREAKING response-shape change, below.

### Added
- **A first-party local `image.generate` module** (`src/modules/chain/image-generate-core.ts`,
  chain-module family, compose port 9145): real image generation through the same AI-gateway path
  the other chain modules use, declaring the same 11 models as the cf module (asserted identical by
  test). This restores chat image generation on local, which the projection change alone had left
  honestly unavailable, and needs no new secrets beyond the existing AI-gateway env.
- **Dev module fleet registration completed:** `image-generate` and `plan-enhance` are both
  standing-uppable from the documented fleet (manifest sync + ports), committed manifests
  regenerated from source, and the deliberately enum-less `dev/manifests/bare-planner.json` fixture
  keeps the degenerate projection shape exercisable. The gate suite (`tests/e2e/gate-parity.spec.ts`,
  runs only with `GATE_HOST=1`) encodes the live parity gate reproducibly.

### Changed
- **The model catalog is now fully projected from installed modules.** `GET /api/models` builds both
  its planning rows (from `plan.enhance` modules) and its image rows (from the new `image.generate`
  modules) by asking what each installed module declares. The studio hardcodes no model names at
  all. `src/image-models.ts` is deleted; `POST /api/chat` dispatches image generation to the module
  that declared the chosen model. (cf#129 phase 2)

### Fixed
- **Chat image previews 404'd when a separate chat bucket was configured** (vivijure-cf#140). Chat
  artifacts were written to `chatBucket` while `GET /api/artifact` only ever served the main bucket,
  so a successful generation produced an unservable artifact with no error anywhere. Artifacts are
  now written to the store that serves them, and the write/serve split can no longer be expressed.

### Removed
- **BREAKING (response shape): `GET /api/models` rows no longer carry a `provider` field.** Shipped
  in v1.0.x, removed here. The field named which provider the studio would dispatch a model to --
  true only while the studio did its own dispatch. Image generation is now served by an installed
  `image.generate` module that owns provider routing entirely, so the studio has no such knowledge
  to report. It is removed rather than synthesised from the model id prefix, because guessing it
  would re-hardcode the provider knowledge this change exists to delete, and would look like data.
  The remaining row fields (`id`, `label`, `group`, `type`, `capabilities`) are unchanged, and the
  `{models:[...]}` envelope is unchanged. If you consume `provider` from this route, the model's
  declaring module is the source of truth now (`GET /api/modules`).
- **`S3_CHAT_BUCKET` is retired and ignored.** Its only observable effect was breaking chat image
  previews (above). If it is still set, the studio logs a warning naming it at startup and continues
  using `S3_BUCKET`; nothing fails to boot. Remove it from your env.

