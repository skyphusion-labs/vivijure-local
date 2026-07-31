# Changelog


**Dual-panel release gate:** every studio feature ships to vivijure-cf and vivijure-local in the
same release wave ([[vivijure-hosted-parity-absolute]] in fleet memory:
`fleet-chezmoi/claude-memory/projects/-home-conrad-dev-vivijure/memory/vivijure-hosted-parity-absolute.md`).

## Unreleased

### ci: retire the upstream-parity byte-identity check (local#263)

The `upstream-parity` workflow diffed this repo's shared `public/` files against
`skyphusion-labs/vivijure-cf` `main` and failed on any byte difference. It is removed, with the
workflow renamed to `manifest-drift` (see below).

**Why.** Byte-identity of the shared frontend was only ever a proxy, and it held while both hosts'
backends emitted the same wire shape. They no longer do: `vivijure-cf`'s planning projector
deliberately omits fields this repo's projector stamps, and its own source says so. Once the
backends legitimately diverge, the check cannot tell "someone forgot to ship the twin" from "these
two products differ here on purpose" -- and it answers as though it can, reporting the honest change
as the defect. Its named remedy on failure made that worse: `sync-from-vivijure.sh` overwrites local
`public/` from upstream, so the gate's default fix was to delete the work it had just flagged.
Re-scoping was considered and rejected: the check's own contract forbids exempting a file that mixes
shared and local content ("the gate goes quietly blind"), and the alternative, splitting each
diverging file into shared and local halves, is a design tax re-paid on every legitimate divergence.

**THIS DOES NOT WEAKEN HOSTED/SELF-HOST PARITY.** That invariant is about the PRODUCT: every studio
feature ships to both panels in the same release wave, same-time releases, no community edition, no
pay gates. It is unchanged and non-negotiable. What was deleted is a much stronger and different
claim -- that two independently released codebases hold byte-identical files -- which the two repos
have outgrown. Prose that conflated the two (`CLAUDE.md`, `docs/DEPLOYMENT.md`) was untangled rather
than deleted, so the product rule is still written down where the check used to be.

**WHAT IS LOST, stated no bigger than it is.** The obligation itself survives, written at the top of
this file: the dual-panel release gate, every studio feature shipping to both panels in the same
release wave. What died is the MECHANICAL proxy for it. Nothing in CI now notices a shared-UI change
landing in one panel and not the other, so that alignment is a review obligation with no automated
backstop. No replacement is proposed here on purpose. One knock-on is recorded rather than papered
over: `tests/abuse-link.test.ts` justified its own missing renderer coverage by citing this gate, so
that justification is void and the comment now says the renderer is untested, tracked in local#287.

- The workflow is **renamed to `manifest-drift`, not deleted.** It also ran
  `check-module-manifest-drift.sh`, which is a different check, unaffected by any of the above, and
  needs the same `vivijure-cf` checkout. Deleting the workflow would have removed it silently. The
  rename is deliberate: a check named for something it no longer does is how the next reader builds
  on a false belief. **`manifest-drift` must be re-added as a required status check** -- the old
  `upstream-parity` context was removed from the ruleset first so this PR could land.
- Removed: `scripts/upstream-public-parity.sh`, the `upstream:parity` / `upstream:parity:verbatim`
  npm scripts, and `.cursor/rules/upstream-parity-pre-merge.mdc` (the Cursor lane is retired
  estate-wide).
- **Kept:** `scripts/sync-from-vivijure.sh`, with the gate language stripped. It is a working manual
  porting aid cited on its own merits in `docs/ARCHITECTURE.md`; deleting a tool because its
  enforcement went away is throwing out the hammer because the inspector left. It now owns the
  local-only skip list outright.

Issue [local#263](https://github.com/skyphusion-labs/vivijure-local/pull/263), follow-up
[local#287](https://github.com/skyphusion-labs/vivijure-local/issues/287).

### fix(local-gpu)!: an absent GPU door installs no module at all (local#280)

Follow-up correcting the shape of the local#229 fix below, which Conrad rejected in review:
**"We shouldn't have to build a shim for a module that isn't even there."**

local#229 deleted the fabricators (correct) but replaced them with a `module-local-gpu` container that
still ran in the default stack, answering `/module.json` with `configured: false` *about itself*. It was
kept alive because the compose healthcheck curled that path -- a detail of our own stack definition
deciding that a process must exist to stand in for a module that does not. An absent capability is
absent; it is not a running service that describes its own absence.

- **The door module moved into a `localgpu` compose profile**, the same mechanism `cloud` /
  `satellites` / `edge` already use. With no door, `docker compose config --services` does not list
  `module-local-gpu` -- nothing started, nothing to hide, nothing to refuse.
- **Corrected the compose assumptions that forced the shim.** `studio` no longer `depends_on`
  `module-local-gpu: service_healthy` (a studio must boot on a box with no GPU), and
  `MODULE_LOCAL_GPU_URL` is no longer hardcoded to `http://module-local-gpu:9102` -- an empty
  `MODULE_*_URL` binds nothing, so the registry has no module to advertise.
- **Deleted the stub behaviour:** the `configured` field and its early-return branch are gone from
  `src/modules/local-gpu/app.ts`. `scripts/local-gpu-module-server.ts` now **exits before binding a
  port** when there is no door, so no entry point can produce a doorless local-gpu service.
- **Still one operator knob.** `npm run install:studio` derives the whole lane from
  `LOCAL_BACKEND_URL` (`src/localgpu-lane.ts`): it adds/removes `localgpu` in `COMPOSE_PROFILES` and
  sets/clears `MODULE_LOCAL_GPU_URL` in `.env`, which compose reads on its own, so a plain
  `docker compose up -d` sees the same lane. New `localgpu-door-gate` is fail-closed for the one case
  profiles cannot catch (lane on, door address blank), mirroring `edge-minio-creds-gate`.
- **The lane-off invariant now survives an UPGRADE, not only a fresh install** (local#281). This
  change is what stopped compose hardcoding `MODULE_LOCAL_GPU_URL`, which is exactly what made the
  key's sync rule ("homelab compose default: upsert when set, never purge when unset") wrong for it:
  every studio that ever booted an earlier version has that value sitting in `platform_secrets`, and
  `RuntimeEnv` merges the DB OVER env with the DB winning, so `install:studio` writing an empty value
  into `.env` could not clear it. The registry bound `MODULE_LOCAL_GPU` to a container the `localgpu`
  profile guarantees is absent; core discovery then dropped it after three failed manifest reads, so
  the panel stayed correct while every discovery pass absorbed a connection failure and logged a
  warning for a module nobody installed. `MODULE_LOCAL_GPU_URL` is reclassified as a DERIVED key
  (env/compose is its only authority): boot never seeds a copy, `sync:secrets` purges it
  unconditionally, and new migration `0015` deletes the row existing studios already carry.
- **`host.hooks_unavailable` stays** (`src/local-door-availability.ts`). It is self-description, not a
  shim: it starts no process and synthesizes no module entry, it reads the host's own registry and
  reports which hooks that composition leaves unserved. Without it, a doorless panel would still offer
  keyframe/motion controls whose every option 400s at submit.
- **UPGRADE NOTE, one setting is discarded.** Migration `0015` deletes any stored
  `MODULE_LOCAL_GPU_URL`, and before this release the Settings GUI accepted a write to it, so an
  operator running the door module on a host OTHER than the compose default could have set it by hand.
  That choice is dropped on upgrade, and `PATCH /api/settings/secrets` no longer stores the key: a
  typed row goes stale when the lane is turned off exactly like a seeded one, and a derived key with a
  single honest source is the whole point of the fix. **The setting moved rather than vanished** --
  put `MODULE_LOCAL_GPU_URL` in `.env`, which compose passes through and which nothing now overrides.
  The field stays visible in Settings (read-only) so the live value and its source are still legible.
- **The door gate applies the same test as the code it guards.** `localgpu-door-gate` checked only
  that `LOCAL_BACKEND_URL` was non-empty while `isDoorConfigured` requires an absolute `http(s)` URL,
  so a malformed door address passed the check that advertises itself as the fail-closed one and was
  caught a layer later by the sidecar. `setProfile` also leaves an already-correct `COMPOSE_PROFILES`
  byte-identical instead of rewriting `localgpu,cloud` to `cloud,localgpu` on the first run.
- **Test fixtures are hermetic now** (fixes local#275). `RuntimeEnv.forTests` no longer inherits
  `process.env`; a developer with `CF_AIG_TOKEN` exported was silently turning the "partial AI Gateway
  config" fixture into a complete one, so `hook-availability-parity`'s partial-gateway assertion passed
  in CI and failed locally. A fixture that reads the shell can also hide a real regression on the one
  machine that has the variable set.
- The configured path and the `cloud` profile are unchanged.

Issues [local#280](https://github.com/skyphusion-labs/vivijure-local/issues/280),
[local#281](https://github.com/skyphusion-labs/vivijure-local/issues/281),
[local#275](https://github.com/skyphusion-labs/vivijure-local/issues/275).

### docs(legal): USE.md, the software vs the model weights (local#283)

The software stays AGPL-3.0-only and free for any use including commercial; the model weights
on the local inference path carry their own upstream licenses, several of which restrict
commercial use (CogVideoX registration + visits cap; the LTX revenue threshold; OpenRAIL++ use
restrictions), and we cannot grant those rights. New top-level `USE.md` states the per-model
truth (license, delivery mode, commercial answer; upstream-verified 2026-07-31), the two
supported commercial paths (Workers AI licensed inference, or hosted vivijure-cf), and that
homelab / non-commercial use is unaffected on every path. README points to it beside the
license section; `docs/PARITY.md` gains a scope note: parity covers our software, and the
commercial difference on local inference is imposed by weight licensors, not by us.

### fix(local-gpu)!: delete the GPU mock; refuse loudly instead of fabricating frames (local#229)

**A bare `compose up` was shipping films assembled from fabricated frames.** `LOCAL_BACKEND_URL` is
empty by default and `scripts/local-gpu-module-server.ts` passed the real artifact store in as a
*mock* store unconditionally, so `local-gpu` served `invokeKeyframeMock` (a 1x1 red PNG per shot) and
`invokeLocalGpuMock` (a black 320x240 clip per shot) under the label "Local GPU Keyframe (SDXL on your
own card)" and reported the render COMPLETED. `/module.json` answered from the mock branch with the
bare manifest, so `configured` was absent -- and absent means *keep* at the registry choke point,
which is why the local#201 filter never hid it. The CPU finish stage then honestly assembled those
placeholders into a deliverable film.

Conrad's call, settling the product question local#229 was parked on: **gone, not relabelled.**

- **Deleted:** `src/modules/dev/gpu-mock-handlers.ts`, `src/modules/dev/gpu-mock-app.ts`,
  `scripts/gpu-mock-module-server.ts`, `src/modules/runpod/keyframe-sidecar.ts` (its only purpose was
  the mock fallback), and `MIN_PNG` / `buildStructuralMp4` from `src/dev/minimal-media.ts`. No flag,
  no env var, no commented-out branch.
- **`local-gpu` no longer has a doorless mode at all.** This entry originally shipped a sidecar that
  self-reported `configured: false`; local#280 above replaced that with a compose profile, so an
  unconfigured door means no service rather than a hidden one.
- **New honest-refusal gate** `src/local-door-availability.ts`: `GET /api/modules` reports `keyframe`
  and `motion.backend` in `host.hooks_unavailable` (the existing core#98 / v1.2.14 channel, alongside
  the video-finish twin) when **no installed module serves them**, with a reason naming the operator's
  own knob. Derived from the discovered modules, not from env, so a `cloud`-profile studio with RunPod
  credentials reports nothing.
- **RunPod is no longer the finish default:** `FINISH_BACKEND` defaults to `local` (was `runpod`).
  Bringing the `satellites` profile up without setting it used to dispatch homelab finish jobs to
  RunPod; it now refuses by name when `LOCAL_FINISH_*_URL` is unset. Explicit `FINISH_BACKEND=runpod`
  and the per-module overrides are unchanged. Completes the local#180 cutover.
- **Breaking for anyone who relied on the GPU-less "demo path":** a studio with no GPU door and no
  cloud module now renders nothing and says so, instead of producing placeholder output. Docs
  (README, DEPLOYMENT, quickstart, install-profiles, `.env.example`) no longer advertise it.
- `vivijure-cf` is untouched: it has no GPU mock and no configured-filter, so no parity obligation
  attaches. The genuine local pipeline (real door, CPU `video-finish` assemble, local finish
  sidecars) is unchanged.

Epic [local#200](https://github.com/skyphusion-labs/vivijure-local/issues/200) (RunPod strictly
opt-in), issue [local#229](https://github.com/skyphusion-labs/vivijure-local/issues/229).

### feat(ollama): harden creative home path for qwen3:14b (local#265)

Keep **`qwen3:14b`** as the 16GB default (strongest Ollama-library creative/instruction fit
with ~9.3GB Q4 headroom; reject mistral-small:24b / community fine-tunes as first-win default).
Working-path improvements: creative-director prompt overlays for plan/refine/chat/enhance;
chat temperature + structured cooler sampling; `ollama-pull` retries + `show` verify;
`module-plan-enhance` waits on pull; `npm run compose:up` blocks until the model is ready
(unless `PLANNER_AI_MOCK=true`); optional `compose.ollama-nvidia.yaml`; clearer missing-model
errors. Unload-before-door handoff from #268 unchanged.

### fix(homelab): unload Ollama on every path before door GPU claim (local#265)

Belt-and-suspenders sequential VRAM: studio film/clip/scatter/finalize submits call
`unloadOllamaBeforeRender`; local-gpu motion (not only keyframe) and local-finish also call
`ensureOllamaUnloadedForGpu` before `/run`. Fail-open with log when Ollama is down; never skip
when `OLLAMA_BASE_URL` is set. Docs: plan → unload → keyframe.

### feat(homelab): Ollama plan.enhance → unload → local-gpu (16GB first); no RunPod in default stack

Conrad ruling 2026-07-28 ([local#265](https://github.com/skyphusion-labs/vivijure-local/issues/265),
epic [local#200](https://github.com/skyphusion-labs/vivijure-local/issues/200)):

- **Compose:** `ollama` + `ollama-pull` services; `module-keyframe` (RunPod) moved to `cloud` profile;
  studio no longer sets `MODULE_KEYFRAME_URL` by default.
- **plan.enhance:** Ollama first-win when `OLLAMA_BASE_URL` is set; default catalog model
  **`ollama/qwen3:14b`** (~9.3GB Q4, fits 16GB with headroom). Chosen over qwen2.5:14b for
  stronger creative writing / scripts / video ideation; catalog also lists `deepseek-r1:14b`
  (max reasoning) and `qwen3:8b` (smaller fallback). Structured enhance/plan uses `think: false`;
  chat opts into thinking. AI Gateway / Anthropic remain opt-in overlays. `plan-enhance.json` is
  local-only (excluded from cf manifest drift).
- **Sequential VRAM:** unload Ollama (`keep_alive: 0`) after enhance and again before local-gpu
  keyframe submit.
- **Door default:** docs + `.env.example` put **16GB** (`vivijure-local-16gb`) first; 12GB is the
  alternate. `LOCAL_BACKEND_URL` still unset in compose for offline mock.
- **Secrets sync:** `MODULE_KEYFRAME_URL` is purgeable (cloud opt-in); `OLLAMA_*` synced from env.
- Residual RunPod **code** (handlers, cloud profile sidecars) stays for opt-in overlays; it is not
  registered in the default instance.

### chore(finish): retire finish-rife-serve from vivijure-local (Conrad ruling)

No local RIFE image. Removes `containers/finish-rife-serve`, the GHCR bake job
(`vivijure-local-finish-rife`), and `LOCAL_FINISH_RIFE_URL` / `FINISH_RIFE_BACKEND` wiring.
RIFE stays RunPod-only (vivijure-cf / explicit opt-in). Supersedes local#204; closes local#260.

## v1.5.1

PATCH: makes v1.5.0 installable. **v1.5.0 is a PARTIAL RELEASE and should not be pinned** -- its tag
bake failed on two container images, so `vivijure-local-image-prep` and `vivijure-local-audio-beat-sync`
were never published at `1.5.0`. Verified against GHCR, not inferred from the run: the other images
(studio, caddy, video-finish, audio-master, audio-mix) DO carry a `1.5.0` tag; those two do not. A
self-hoster running `VJ_IMAGE_TAG=1.5.0` therefore gets a compose that cannot pull two of its services.
Move to `1.5.1`.

Carries **NO schema change** (verified against `migrations/`, which exists in this repo: the
v1.5.0..v1.5.1 range touches no migration file). Contains exactly one merged PR: #254.

### fix(containers): revert image-prep and audio-beat-sync to python 3.11 (#254)

- Dependabot #243 moved three Dockerfiles from `python:3.11-slim-bookworm` to `3.14` inside a grouped
  `docker-images` update. **Both broken files already carried the constraint in a comment** ("Do NOT
  bump past 3.13") and were bumped anyway, because dependabot does not read prose. `video-finish`, the
  third file in that PR and the only one without such a comment, built fine -- an exact correlation.
- **3.14 is blocked upstream, not in our Dockerfiles**, which is why this is a revert rather than a fix
  forward: `image-prep` reaches numba via `rembg -> pymatting` and `audio-beat-sync` via `librosa`, and
  numba supports only `>=3.10,<3.14`. `audio-beat-sync` additionally pins `numpy==1.26.4`, which
  publishes no cp314 wheel, so pip falls back to a source build and meson dies with
  `Unknown compiler(s)` because the slim image has no compiler. Unpinning the hardcoded site-packages
  paths would not have helped.
- **Scope is the two broken images only.** Five containers sit on 3.14, not the three in #243:
  `audio-master` and `audio-mix` moved on 2026-07-15 (#79) and have shipped that way since, and
  `video-finish` is structurally identical to them (aiohttp its only dependency, no hardcoded python
  path) and builds clean. Reverting those would have undone a working security bump against evidence.
- **The pin is now enforced in `.github/dependabot.yml`, not in a comment.** The docker ecosystem entry
  is split so the two numba-pinned directories carry an `ignore` for python semver-major/minor, while
  every other directory keeps updating normally. Not a blanket freeze. A constraint a tool cannot see
  is a wish.
- Verified by BUILDING both images, because the PR check set is green and vacuous for container
  changes (vivijure-local#255): `audio-beat-sync` -> `warm OK`, 20 numba kernels baked; `image-prep` ->
  `rembg warm OK`, 29 kernels. Both are the exact steps that failed in run `30238372677`.

## v1.5.0

MINOR: the storage ceiling (vivijure-core#52). Twin: vivijure-cf v1.11.0 and vivijure-core v1.3.0, one
release wave, per the parity promise. The knob, the accounting and the reconcile all live in core; this
panel wires them, so the self-host door gets the identical feature in the identical release rather than
a hosted-only knob it never sees.

### feat(quota): R2_STORAGE_QUOTA_BYTES, accounted at write time in SQLite

- **`R2_STORAGE_QUOTA_BYTES`** -- unset / `0` / non-integer = OFF (a no-op that never touches the
  database). A positive integer = a byte ceiling enforced at SUBMIT with an honest **507** carrying the
  real numbers (`N bytes stored of the M-byte ceiling`). Reads, deletes, the planner and chat keep
  working, so the operator can go delete something. A ceiling that is SET but cannot be checked denies
  **503** (fail closed).
- **Usage is accounted at write time in SQLite** (migration `0014_storage_usage.sql`, carrying core's
  `STORAGE_USAGE_DDL` verbatim), never read from an S3/MinIO usage API. The ledger is keyed on the
  object key, so a job doc rewritten on every advance tick updates one row instead of climbing to the
  ceiling on control docs alone.
- **Two seams, both idempotent:** `server.ts` meters the store at boot, and
  `applyRuntimeEnvToPlatform` re-meters the store it REBUILDS on a settings save. Without the second
  one, accounting would silently stop the first time an operator saved connection settings.
- **Operator surface:** `GET /api/storage/usage` and `POST /api/storage/reconcile`. The reconcile
  rebuilds the ledger from the store and is both the one-time backfill for a studio that predates
  accounting (artifact sizes are not derivable from the DB, so the counter starts at 0) and the repair
  for drift from an out-of-band delete.

### fix(storage): a full-store list no longer returns a different spelling of every key

- `FilesystemObjectStore.list("")` always prepended a separator, so listing the WHOLE store returned
  `/renders/a.mp4` for an object written as `renders/a.mp4`. Any key-indexed consumer would hold rows a
  later delete could never match and drift forever. Found while wiring the storage reconcile, which is
  the first caller to pass an empty prefix; fixed and covered by a test asserting a reconciled key is
  the same key the write path uses.


## v1.4.0 -- 2026-07-26

MINOR: the abuse-report link twin (local#242 / control-plane#130). Twin: vivijure-cf v1.10.0 (same window, per the parity promise).

### feat(abuse): the abuse-report link on the self-host panel (local#242)

- **Same-wave twin of vivijure-cf#245.** The dual-panel gate at the top of this file is why this
  shipped first rather than after: the abuse link is a studio panel feature, and cutting the hosted
  release while this panel lacked it would have broken the gate.
- **The panel half is a SYNC, not a re-implementation.** `public/` is verbatim-shared with
  vivijure-cf and enforced by `scripts/upstream-public-parity.sh`, so `abuse-link.js`,
  `abuse-link-checks.js`, the script tags and the `.studio-foot` rules arrive through
  `scripts/sync-from-vivijure.sh`. Hand-writing a local renderer would have manufactured exactly the
  drift that gate exists to catch, which is what local#242 recorded as CI failure.
- **The host half is this repo, and it is where parity is the SET and the BIAS.** Identical
  contract: an optional operator var projected as `host.abuse_report_url` on `GET /api/modules`,
  refused unless it is an absolute http(s) URL, absent meaning no field and no link. The refusal is
  the same DOM boundary for the same reason (the value reaches an `href`, so `javascript:` and
  `data:` are dropped; a relative path is dropped because it would resolve against the studio
  origin).
- **What differs is who the reader is.** A hosted tenant cannot set this and must not be told to.
  Here the reader IS the operator, so the knob lives in the Settings catalog with every other
  operator var, and absence means "you have not published a contact for your own studio yet" rather
  than "nobody told you where to report".
- **No fallback address, deliberately.** This IS the bundle a self-hoster installs, so the rule that
  no abuse address ships inside it is this panel own requirement rather than inherited politeness.
  The parity test asserts it against the shipped assets with a non-empty sweep as its control, plus
  a check that the renderer has no address to fall back TO.

## v1.3.0 -- 2026-07-25

MINOR: hooks truthfulness parity twin of vivijure-cf v1.9.0 (same window, per the parity promise).

### fix(hosted): name the capability that is absent, not four hooks that depend on it (cf#229 parity)

- Same-window twin of vivijure-cf#241. PARITY IS THE SET AND THE BIAS, never the bytes: this panel
  keeps its own operator-facing reason (it names `VIDEO_FINISH_URL`, because here the reader IS the
  operator), and the KEYS it reports now match the hosted panel exactly.
- `score` leaves the unavailable set. Bed generation does not need the video-finish tier on either
  panel: the score module produces the bed locally and the film path never calls the hook at all
  (the bed is attached before submit as `job.audio_key`). Only the MUX needs the container. Keeping
  `score` here would grey out a generator that works, which is cf#98's defect pointed the other way.
- The set is now `capability:video-finish` plus `master`, `film.finish`, `notify`. The capability key
  names the TIER; the colon namespace keeps it from ever colliding with a hook name (hooks use dots).
- The two mux buttons declare the capability instead of `score` (supersedes the declaration in the
  cf#118 parity entry below). Same behaviour, honest reason.
- **Deliberately NOT mirrored:** the hosted twin also carries a three-state resolver for the cp#112
  population (tenants provisioned before the tier existed, whom no operator action can reach). That
  state cannot occur here -- the reader owns the knob -- so shipping it would be cargo. Recorded in
  the module header so the next porter does not "fix" the gap.

### feat(planner): declare what a control NEEDS versus what it cannot DELIVER (cf#234 parity)

- Ported verbatim from vivijure-cf: `public/hook-availability.js`, `public/planner-render-config.js`
  and `public/planner-history-row.js` were proven BYTE-IDENTICAL across both panels before the port,
  so the twin is a copy rather than a re-implementation.
- `data-hook-advisory="<key>"`: the control RUNS, its product cannot be delivered here. Noted, never
  disabled, never dimmed. The music and narration bed blocks declare it.
- `data-hook-scope="container"`: a required declaration on a SECTION, disabling its fields and
  stating the reason ONCE. `renderModuleSection` tags each projected section with the hook it was
  rendered under, so `master` / `film.finish` / anything future gates generically.
- The notification TOGGLE stays ungated (browser Notification API, works with no tier); a guard test
  forbids a `data-hook` on it.
- Evidence: parity + gate + declaration suites green, and the parity guard was failed on purpose
  (score folded back into the set fails both the set assertion and the cf#229 parity assertion). The
  live local studio was checked with curl: it emits the four keys with THIS panel's reason string,
  and the served planner carries the advisory declarations. The gate's rendered behaviour was
  browser-verified on vivijure-cf against the byte-identical asset.

### fix(planner): gate the audio-mux controls on the hook they drive (cf#118 parity)

- Ported verbatim from vivijure-cf (the changed region was proven identical across both panels
  before porting, not assumed).
- "add audio" and "narrate" both end in the video-finish container, and the panel rendered them
  unconditionally, so on a studio without that tier clicking was the only way to find out. Both
  now declare `data-hook="score"` and the cf#98 gate disables them with the host reason verbatim.
- **The gate was INERT for every dynamically-built control**: `hook-availability.js` applies on
  load and DOMContentLoaded only, and every history row is built after that. `renderHistoryList`
  now re-applies it over the rows it just built. Proven load-bearing by removing only the
  re-apply and watching both buttons stay clickable.

## v1.2.2 -- 2026-07-25

### fix(ci): drop the Actions-cache export from the finish-rife-serve bake (#227)

- The v1.2.1 finish-rife job BUILT successfully, then died exporting the ~60GB CUDA overlay into
  the 10GB Actions cache (`not_found`), leaving `vivijure-local-finish-rife` the only unpublished
  image of the ten. `cache-to` dropped from that job only; warm-bake reuse comes from GHCR layers.
  This tag is the retry that publishes the tenth image.

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

### fix(planner): the panel discloses a finishing degrade instead of a green "completed" (cf#118)

- Ported VERBATIM from vivijure-cf in the same window; `finalizeRenderPoll` was byte-identical
  across both panels, so this is one change in two repos rather than two implementations.
- When the video-finish tier is unavailable the orchestrator degrades honestly (per-shot clips at
  assemble, the silent film at mux, with a reason). The poll payload carried all of it
  (`output.finish_unavailable` plus `output.clips`) and the panel dropped it: the render read
  `completed`, in green, with the fact buried in a JSON blob.
- The panel now reads `completed with limits`, states structurally what was handed over, prints the
  studio reason **VERBATIM**, and lists the delivered per-shot clips as real download links.
- **Correctness, not cosmetics: the stale download link is fixed.** The assemble degrade leaves
  `output_key` UNDEFINED, and the old completed-branch only ASSIGNED the anchors, never reset them,
  so a degraded render following a good one in the same session left "download silent MP4" pointing
  at the PREVIOUS render. Reproduced in a real browser on the pre-fix asset, then re-run against
  the fix.
- New `public/finish-degrade.js`: pure, DOM-free, unit-tested under Node. Junk resolves to "no
  degrade", never to a scary banner on a render that is fine.

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

## v1.1.4 -- 2026-07-21

- **fix(deps): Pillow 12.3.0 in the image-prep sidecar (#140).**
- **fix(finish): faster sweep ticks, and finish-chain poll progress**, so a finishing film reports
  movement instead of looking stalled.
  (Backfilled 2026-07-28 from the v1.1.4 GitHub release; the row was missing from this file.)

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

## v1.0.1 -- 2026-07-18

- **fix(panel): sync the shared planner assets from vivijure-cf `main` (cf#62, #102).** The panel
  stops inventing core-owned quality tiers, and a stale saved model or tier now drops **visibly**
  through one guarded restore mechanism rather than silently resolving to something else. Panel
  parity with vivijure-cf v1.4.0 was verified live, per surface.
- **fix(containers): revert video-finish to a python 3.11 base (#97).**
- **fix(ci): make `upstream-parity` check the shared stylesheet and stop overclaiming (#92)**, then
  check `settings.js` verbatim now that the copies are identical (#96); make
  `npm run upstream:parity` actually work and stop advising an ignored variable (#94).
- **fix(planner): style the cancel-render control as destructive (#90).**
- **deps:** `@skyphusion-labs/vivijure-core` to `^1.0.0` (#89).
- GHCR images track `main` and already carried these files.
  (Backfilled 2026-07-28 from the v1.0.1 GitHub release; the row was missing from this file.)

## v1.0.0 -- 2026-07-15

- **First constellation-stable release of the local / homelab studio host.** Matches the GHCR
  `vivijure-local-studio` tip.
- **Carries no commits of its own**: the tag marks the stable line rather than shipping content, so
  the tree is identical to the plane-C tag before it.
  (Backfilled 2026-07-28 from the v1.0.0 GitHub release; the row was missing from this file.)

