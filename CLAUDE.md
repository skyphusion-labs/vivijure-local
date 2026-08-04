# CLAUDE.md -- vivijure-local

## What this is

**Vivijure Local:** provider-neutral host for the Vivijure Studio control plane. Same modular architecture and reference API as `skyphusion-labs/vivijure-cf`; no Cloudflare runtime.

Upstream canon for the wire contract: `vivijure/docs/CONTRACT.md` and `vivijure/docs/module-api.md`.

## Strategy (locked)

1. **Option B (now):** fork-adapt vivijure `src/` into this repo behind `src/platform/` adapters. Prove CONTRACT parity to the crew.
2. **Option A (vivijure v2.0):** shared orchestration in [`vivijure-core`](https://github.com/skyphusion-labs/vivijure-core); shrink both repos to hosts.

Design platform interfaces in `src/platform/types.ts` so v2 extraction is mechanical, not a rewrite.

## Rules

- **API parity is non-negotiable.** Every route, status code, and JSON shape in upstream `CONTRACT.md` must match. Track progress in `docs/PARITY.md`.
- **Do not change backend engines.** RunPod, `vivijure-local-12gb`, CPU containers keep their wire contracts.
- **Do not fork `public/` long-term.** Copy stays in sync with upstream until v2 shared UI packaging exists.
- **Module contract is sacred.** `../vivijure-core/src/modules/types.ts` must match upstream byte-for-byte unless the epoch bumps in both repos together. Beat-sync planner types live in `vivijure-core/src/beat-sync-types.ts` (upstream: `modules/beat-sync/src/contract.ts`). Sync: `npm run sync:module-types`.
- **Object storage is S3-compatible (MinIO default).** Use `S3_*` env vars; R2/S3 is a config swap. Filesystem (`ARTIFACT_ROOT`) is CI fallback only.
- **Required CI check is `ci`** (typecheck, test, and conformance run inside that job). Run `npm run typecheck` locally before push.
- **Dual-panel release gate (PRODUCT parity, unchanged).** Every studio feature ships to `vivijure-cf` and `vivijure-local` in the same release wave: same-time releases, no community edition, no pay gates. This is a review obligation, not a CI check.
- **There is no byte-identity check on `public/` any more.** The `upstream-parity` workflow diffed shared `public/` against `vivijure-cf` `main`; it was retired in local#263 because the two hosts' projectors legitimately diverged, so byte-identity stopped being a true statement about a working system. `scripts/sync-from-vivijure.sh` survives as a manual porting aid. Nothing now detects a shared-UI change landing in only one panel: that is on review.

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
| MinIO S3 API | 9000 |
| MinIO console | 9001 |
| Ollama (plan.enhance) | 11434 |
| video-finish | 8780 |
| image-prep | 8781 |
| audio-beat-sync | 8782 |
| audio-mix | 8783 |
| audio-master | 8784 |
| Module sidecars | 9100+ (local-gpu 9102; RunPod keyframe cloud-only) |

## Release / tagging

Full ledger: **`RELEASES.md`**.

**TAG-GATED GHCR publish.** `.github/workflows/build-image.yml`:

- Push/PR to `main`: build-only smoke (`:ci` tags, **no** registry push).
- Pushed **`v*`** tag: publishes GHCR images `:X.Y.Z` + `:latest` (v prefix stripped on image tags).

Tag must match `package.json` version and `CHANGELOG.md` must contain `## vX.Y.Z` (workflow refuses
mismatches). Tag must be an ancestor of `origin/main`.

### Dependency order

1. If this release needs a new **`@skyphusion-labs/vivijure-core`**, release and publish **core
   first** (`vivijure-core-v*`).
2. Bump the core pin here on `main` (release PR).
3. Tag this repo only after the pin is on `main`.
4. **Dual-panel:** ship product-facing changes with **vivijure-cf** in the same wave (same-time
   releases; no community edition).

### Cut a release

1. **Release PR on `main`:** bump `package.json`, add `CHANGELOG.md` `## vX.Y.Z`, land the PR.
2. **Tag:**

```bash
git fetch origin main && git checkout main && git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

3. **GitHub Release** (recommended; CI does not always create it for you):

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
```

4. Confirm `build-image.yml` green; pin fleet/compose to the published `X.Y.Z` image tags when
   rolling hosts.

Merge alone never moves `:latest` / versioned GHCR tags.

## Crew identity

Conrad laptop: commits as `Conrad Rockenhaus <conrad@skyphusion.org>`. Branch + PR; never push to
`main` unless Conrad says so.
