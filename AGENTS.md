# Vivijure Local

This file is the guide for any coding agent and any contributor. Follow it.

## What this project is

This repo is the local Vivijure Studio panel. It matches the module shape and the reference API of `vivijure-cf`. The studio process does not run on the Cloudflare runtime.

The process is Node, plus SQLite, plus S3 or MinIO, plus HTTP sidecars. The operator self-hosts it.

Orchestration and the module contract live in `@skyphusion-labs/vivijure-core`. Host adoption is complete. This repo is a thin host. It is not a fork of core sources.

See root `package.json`, the latest `v*` tag, [CHANGELOG.md](CHANGELOG.md), and [RELEASES.md](RELEASES.md). Do not freeze a number here.

Do not freeze a hostname or an endpoint id in this file.

## Two panels

| Panel | Repo | Notes |
|-------|------|-------|
| Cloudflare | `vivijure-cf` | Workers, D1, R2 |
| Local (this repo) | `vivijure-local` | Node host; the operator self-hosts it |

Product parity is required. Features ship at the same time. There is no community edition. Core, MCP, and image pins may lag `vivijure-cf`. Check each lockfile. Lag alone is not a defect. The review must still ship both panels.

The wire contract is vivijure-cf `docs/CONTRACT.md`. This repo does not copy it. Gaps go in [docs/PARITY.md](docs/PARITY.md). Module types come from core. Do not vendor `src/modules/types.ts`.

## Rules

Routes, status codes, and JSON shapes match the Cloudflare `CONTRACT.md`. Track a gap in [docs/PARITY.md](docs/PARITY.md).

Do not change a backend engine wire contract. That includes RunPod, `vivijure-local-12gb`, `vivijure-local-16gb`, and the CPU containers.

The module contract source is `@skyphusion-labs/vivijure-core` (`modules/types`, `vivijure-module/2`).

Object storage is S3-compatible. MinIO is the default. Use `S3_*` env. R2 or S3 is a config swap. `ARTIFACT_ROOT` on the filesystem is the CI fallback only.

The required CI check is `ci`. That job runs typecheck, test, and conformance. Run `npm run typecheck` before you push.

Ship a product-facing change with `vivijure-cf` in the same wave. That duty is a review rule. It is not a CI check.

There is no byte-identity check on `public/`. Projectors may differ. `scripts/sync-from-vivijure.sh` is a manual porting aid only.

Hosted Wan training is retired. Self-host is the remaining path. This homelab profile does not set `RUNPOD_WAN_TRAIN_ENDPOINT_ID`.

## Commands

```bash
npm run typecheck
npm test
npm run conformance
npm run dev
npm run compose:up
npm run compose:down
docker compose up -d
```

Other scripts: `migrate`, `install:studio`, `module-fleet`, `smoke:exit`, `smoke:exhaustive`. `dev:mcp` and `deploy:mcp` configure the MCP Worker only. The package is vivijure-mcp. The full list is `package.json`.

## Port map

| Service | Port |
|---------|------|
| Studio API and UI | 8790 |
| MinIO S3 API | 9000 |
| MinIO console | 9001 |
| Ollama (`plan.enhance`) | 11434 |
| video-finish | 8780 |
| image-prep | 8781 |
| audio-beat-sync | 8782 |
| audio-mix | 8783 |
| audio-master | 8784 |
| Module sidecars | 9100 and up (local GPU 9102; RunPod keyframes stay in the cloud) |

## Release

Full ledger: [RELEASES.md](RELEASES.md).

`.github/workflows/build-image.yml` builds on a push or pull request to `main` and does not push (`:ci` tags only). A pushed `v*` tag publishes GHCR images `:X.Y.Z` and `:latest`. The image tag drops the `v` prefix.

The tag must match `package.json`. [CHANGELOG.md](CHANGELOG.md) must contain `## vX.Y.Z`. The tag must be an ancestor of `origin/main`.

`tests/changelog-version.test.ts` runs inside the required `ci` check. It checks four equalities. `package.json` version equals the newest `## vX.Y.Z` heading. The `## Unreleased` section is skipped. That version equals the lockfile top-level version. It also equals `packages[""].version`. An exact `@skyphusion-labs/*` pin must match the lock. `npm ci` installs the lock. A caret or tilde range is not checked against its floor. The tag guard runs only when someone tags. This test runs while a reviewer can still see the diff.

A version moves only in a release pull request. A feature pull request does not bump. A fix pull request does not bump. There is no direct push to `main`.

The version of record is `package.json` (and the lockfile). The tag shape is `v*`.

Before a release pull request, check tags. If the current manifest version already has a tag, the cycle is closed, so the release pull request bumps. If it has no tag, stop. Read why before you bump again.

Order:

1. Release `@skyphusion-labs/vivijure-core` first when you need it (`vivijure-core-v*`).
2. Bump the core pin here on `main`.
3. Tag this repo only after that pin is on `main`.
4. Ship product-facing work with vivijure-cf in the same wave.

Cut a release:

1. Open a release pull request. Bump `package.json` and the lockfile. Add `## vX.Y.Z` to [CHANGELOG.md](CHANGELOG.md). Add the [RELEASES.md](RELEASES.md) row.
2. An org admin tags that pull request merge commit.

```bash
git fetch origin main --tags
sha="$(gh pr view <release-pr> --json mergeCommit -q .mergeCommit.oid)"
git tag -a vX.Y.Z -m "vX.Y.Z" "$sha"
git push origin vX.Y.Z
```

3. Confirm `build-image.yml` is green. Pin compose to the published image tag when you roll a host.
4. Verify the running container or the API. Do not stop at CI.
5. Close the ledger row in a follow-up pull request after the tag run is green.

A merge alone does not move `:latest` or a versioned GHCR tag.

## Docs and safety

Write Simplified Technical English. Use short sentences. Put one idea in each sentence. Use the active present tense. Use plain words. Use the same word every time.

Do not use an em dash (U+2014). Do not use an en dash (U+2013). Use a comma, a semicolon, parentheses, or two hyphens (`--`).

State the limit next to the capability. Do not turn a measured result into a promise.

Read [README.md](README.md), [docs/PARITY.md](docs/PARITY.md), and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before you change a public claim.

The CSAM ban includes synthetic images. Do not weaken that check.

GPU engines stay clean-room. Verify the artifact, not only the pipeline.

Do not put a secret in a tracked file.
