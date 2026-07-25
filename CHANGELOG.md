# Changelog


**Dual-panel release gate:** every studio feature ships to vivijure-cf and vivijure-local in the
same release wave ([[vivijure-hosted-parity-absolute]] in fleet memory:
`fleet-chezmoi/claude-memory/projects/-home-conrad-dev-vivijure/memory/vivijure-hosted-parity-absolute.md`).

## v1.2.2 -- 2026-07-25

### fix(planner): the host reports hooks it cannot serve (vivijure-cf#98 parity)

- `GET /api/modules` emits `host.hooks_unavailable` (core 1.2.14) naming any hook this studio cannot
  serve. First entry: `plan.enhance`, when the AI Gateway is not configured. Absent key means
  available; the block is omitted when everything is serviceable.
- **Parity is the feature with an honest answer per host, not identical bytes.** BOTH halves of the
  reason string differ from vivijure-cf's, for the same reason: the reader is a different person. The
  knobs are this host's (`CLOUDFLARE_ACCOUNT_ID`, `GATEWAY_ID`, `CF_AIG_TOKEN`), and the ACTION is
  given directly ("Set ... to enable it") because on a self-host door the reader IS the operator --
  cf's "ask whoever operates this studio" is right for a hosted tenant and would tell a homelabber to
  go ask themselves.
- A PARTIAL gateway config reports unavailable too -- two of three is not configured.
- Core pin `^1.2.14`.

### fix(modules): the keyframe module hides itself when RunPod is unconfigured (local#223)

- A bare no-RunPod homelab was offered **"GPU Keyframe (SDXL on RunPod)"** and silently served dev
  MOCK output. It did not fail, which is worse than the broken button local#201 removed: a silent
  substitution reads as a successful render.
- Root cause was the COMPOSITION, not either app. The keyframe sidecar routed every path
  (`app.all("*")`) to the mock when RunPod was unconfigured, including `/module.json`; the mock
  serves the raw manifest, so `configured` was ABSENT, and absent means "always keep" at the
  registry choke point. The one module that falls back to a mock was the one module the
  configured-filter could not see.
- Fix (cf#224 gate 3, HIDE -- no relabel, no mock output to users): `/module.json` is now always
  served by the RunPod app, so `configured` is honest and an uncredentialed keyframe module is
  dropped exactly like every other RunPod module. Only non-manifest paths still fall back to the
  mock, so it stays reachable as a direct dev affordance and unreachable through the panel.
- The composition moved out of `scripts/runpod-module-server.ts` into
  `src/modules/runpod/keyframe-sidecar.ts` so the tests drive the SHIPPED app rather than a
  re-implementation of its routing; both branches now read `configured` through the same predicate,
  so manifest honesty and routing cannot drift apart. Sidecar boot log says both halves.
- **Parity note (asymmetric by fact, not by exception):** vivijure-cf has no keyframe mock and no
  configured-filter -- its keyframe module is RunPod-backed and configured, so there is nothing to
  hide there. This is a local-panel change with no cf counterpart.
- Keyframes on a no-RunPod homelab remain available through `local-gpu` (your own card) and the
  cloud keyframe door; `keyframeLabel()` already projects from the registry, so the planner copy
  follows whichever provider is actually serving.

## v1.2.1 -- 2026-07-25

PATCH (CI/release class, no runtime change): completes the v1.2.0 image set.

- **fix(ci):** `finish-rife-serve` bake `timeout-minutes` 45 -> 90 (cf#215). The uncached first
  bake of the RIFE CUDA overlay ran 45.3 and ~46 minutes into the v1.2.0 tag run's 45-minute
  budget and was killed by the job's own timeout both times; GitHub reports that as "cancelled",
  which read as a runner defect until the timeout was checked. The
  `vivijure-local-finish-rife-serve` GHCR package therefore did not exist through v1.2.0; this
  tag's bake publishes it for the first time.

## v1.2.0 -- 2026-07-24

MINOR: **epic #200 -- vivijure-local runs without RunPod** lands as the primary path. RunPod
becomes fully opt-in: an uncredentialed RunPod module no longer renders as a broken button,
narration gets a creds-free default engine wired into the default compose stack, and the README
documents the no-RunPod recipe as the default rendering path.

- **fix(modules):** hide uncredentialed RunPod modules behind a `configured` flag + registry
  filter, so a launched-but-unwired module never shows up as a broken button (#201)
- **feat(score):** creds-free narration via Deepgram Aura-1 on Cloudflare AI; RunPod MiniMax
  stays opt-in (#202)
- **docs:** no-RunPod is the documented default rendering path; RunPod moves to an opt-in wiring
  section (#203)
- **feat(compose):** `narration-gen` joins the default stack now that its default engine is
  creds-free, dropping the stale `cloud`-profile gate (#209)
- **feat(homelab):** adopt the finish-rife serve overlay (RIFE on a homelab GPU via HTTP, opt-in,
  off by default) + reconcile the finish-story docs (#204, epic #200). Original work by **Conrad
  Rockenhaus** on `feat/finish-rife-serve-homelab`, re-authored to Rollins per house doctrine
  (crew-box commits author as the crew member), carried via `Co-authored-by:` on both commits (#212)
- **docs(cast):** honest Wan LoRA train-time copy; first corrected to the measured pre-fix
  ~1h45m-2h (#213), then to ~35-45 min once a worker-side fix shipped and was output-verified on
  the prod endpoint (#214)
- **chore(deps):** pin `@skyphusion-labs/vivijure-core` to `^1.2.13`, picking up core#92 (the
  stuck-training reconciler observability split): an OBSERVED-running train gets a 3h ceiling
  covering the RunPod 2h endpoint timeout, instead of the SDXL-era 1h backstop (#210)
- **fix(secrets):** homelab does not wire Wan cast LoRA train (Conrad ruling 2026-07-23); carried
  over from Unreleased. Removes `RUNPOD_WAN_TRAIN_ENDPOINT_ID` from compose, Settings catalog, and
  `.env.example`; sync purges stale DB rows. Local `/train-lora` falls back to SDXL on the render
  endpoint; Wan train stays CF prod only (#193)

Roll propagandhi/fatmike with the updated compose after GHCR publish.

## v1.1.16 -- 2026-07-23

PATCH: security-day K3 hardening. **Ledger-gap backfill (cf#215 Lane D, 2026-07-25):** this tag was
cut ad-hoc mid security-day with no `package.json` bump and no CHANGELOG heading of its own (the
commits landed under `## Unreleased`, which is why v1.2.0's changelog separately notes one of them,
#193, as "carried over from Unreleased" -- that entry is not duplicated here). `package.json`
stayed at `1.1.15` for this tag; not retroactively edited now that it is already tagged and
published. GHCR confirms `vivijure-local-studio:1.1.16` was built and published (build-image run
2026-07-23T19:36:02Z, tag push, conclusion success). Cross-ref: fleet-chezmoi
`docs/runlog/2026-07-23-vivijure-security-day-index.md` (canonical security-day index),
`2026-07-23-vivijure-k3-hardening-closeout.md`, `2026-07-23-vivijure-k3-med-low-closeout.md`.

- **chore(deps):** pin `@skyphusion-labs/vivijure-core` to `^1.2.10` (#194), then `^1.2.11` (#196)
- **fix(docker):** exclude local secrets from the studio image build context (K3) (#195)
- **docs(security):** K3 med/low false-positive runlog for homelab/operator findings (#197)
- **docs(security):** K3 verify high-severity false-positive evidence (#198)
- **fix(security):** cast import cap + safe URI decode (K3 verify) (#199)

## v1.1.15 -- 2026-07-23

PATCH: Wan cast train default (cf#29 Phase E). Bumps `@skyphusion-labs/vivijure-core` to `^1.2.8`.
Cast UI parity with cf: Wan via `/train-lora`; SDXL escape hatch sends `model_family:"sdxl"`.

## v1.1.14 -- 2026-07-23

PATCH: homelab panel closeout (#180). Default compose is CPU + local-gpu only; finish GPU and
cloud modules are profile-gated; `platform_secrets` sync purges stale cloud URLs without wiping
homelab defaults.

- **fix(secrets):** purge unset `MODULE_*` URLs from `platform_secrets` (#187)
- **feat(compose):** trim default homelab stack to 12 CPU modules + local-gpu (#188)
- **fix(compose):** gate speech-upscale behind `cloud` profile (#189)
- **fix(secrets):** never purge homelab local-gpu module URLs (#190)
- **feat(compose):** unload finish modules by default; fail-loud RunPod when unset (#186)

Roll propagandhi with `panel-minimal` overlay + `sync:secrets:compose` after GHCR publish.

## v1.1.13 -- 2026-07-22

PATCH: **FINISH_BACKEND** local sidecar routing (#180 / #182). Homelab finish modules can call
local GPU HTTP (`LOCAL_FINISH_*_URL`) instead of RunPod; default remains `runpod` until env cutover.

- **feat(finish):** `finish-module-server.ts`, `resolveFinishBackend()`, local-finish handlers;
  fail-loud when `FINISH_BACKEND=local` and URLs unset (#182)
- **docs:** `docs/FINISH_BACKEND.md`, env catalog + compose wiring prep (#181)

Phase 2 (propagandhi `FINISH_BACKEND=local`) blocked until GEX44 finish HTTP stack lands; do not
roll propagandhi on this tag alone.

## v1.1.12 -- 2026-07-22

PATCH: dual-panel with vivijure-cf **v1.7.11** -- local-GPU film keyframes (#153). Pins
`@skyphusion-labs/vivijure-core` to `^1.2.7`.

- **feat(local-gpu):** dual-hook `local-gpu` v0.2.0 (`motion.backend` + `keyframe`) so local-motion
  films render keyframes on the door (`action: preview`) instead of RunPod (#176)
- **fix(security):** validate `LOCAL_BACKEND_URL` / poll `jobId`s; scope motion vs keyframe poll tokens
- Pair with door images `vivijure-local-{12,16}gb:1.0.3`

## v1.1.11 -- 2026-07-22

PATCH: security grind (dual-panel with vivijure-cf **v1.7.10**). Core pin unchanged (`^1.2.5`).

- **fix(security):** reject placeholder `STUDIO_API_TOKEN`; fail-closed CSRF on cookie advances (#164/#165)
- **fix(security):** pass `project` into speech-upscale RunPod body (#167)
- **fix(security):** mint MinIO S3_* on `install:edge`; refuse edge profile with `minioadmin` (#168/#170)
- **fix(security):** demo gate denies state-advancing GETs, cast export, and non-`demo/` artifacts (#169/#171/#172)
- **fix(security):** validate cast image MIME + artifact serve hardening (#173)
- **ci:** adversarial security audit workflow

## v1.1.10 -- 2026-07-22

PATCH: dual-panel parity with vivijure-cf **v1.7.9** -- pin `@skyphusion-labs/vivijure-core` to
`^1.2.5` (cf#110 + core#54) and sort Stages / planner render panels by `catalog[].order`.

- **docs:** `.env.example` + `DEPLOYMENT.md` document local panel `RUNPOD_WORKERS_MAX=3` and the
  12GB↔16GB door switch sequence (`sync:secrets:compose` + force-recreate; `platform_secrets` wins
  over compose env). Links local#153, fleet#962.
- **fix(e2e):** cast-page smoke asserts the list pane + empty-state status on a fresh DB instead of
  `toBeVisible()` on an empty `#cast-list` (local#113).
- **fix(ci):** `sync-from-vivijure.sh` force-syncs shared `public/` (respects LOCAL_PUBLIC_SKIP);
  parity FAIL message names that remedy (#103).
- **fix(ci):** `check-module-manifest-drift.sh` on the upstream-parity job so committed
  `dev/manifests/` cannot silently diverge from vivijure-cf (excludes `bare-planner.json`) (#117).
- **ci:** adversarial security audit workflow on a schedule (`ADVERSARIAL_AUDIT_CF_API_TOKEN`).

Roll propagandhi after GHCR `:1.1.10` publish is green.

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

