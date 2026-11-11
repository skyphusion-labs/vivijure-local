# CLAUDE.md -- vivijure-local

## What this is

**Vivijure Local:** provider-neutral **LOCAL panel** host for Vivijure Studio. Same modular
architecture and reference API as `skyphusion-labs/vivijure-cf`; no Cloudflare runtime for the
studio process (Node + SQLite + S3/MinIO + HTTP sidecars).

Orchestration and the module contract live in published **`@skyphusion-labs/vivijure-core`**
(**HOST-ADOPTION complete**; Option A extraction is done). This repo is a thin host, not a fork of
core sources.

Version: see root `package.json` / latest `v*` tag / `CHANGELOG.md` / `RELEASES.md`.

The Hetzner fleet, including this section's old named reference installs, was decommissioned
2026-09-24; there is currently no Skyphusion-operated reference install of either panel
(verified 2026-09-25: the old production hostname for this panel is NXDOMAIN). Operator pins;
do not freeze hostnames or endpoint IDs as eternal truth here -- that already happened once and
the doc rotted under it.

## TWO panels (honesty)

| Panel | Repo | Notes |
|-------|------|-------|
| CF | `vivijure-cf` | Workers / D1 / R2 |
| LOCAL (this) | `vivijure-local` | Node host, self-hosted by the operator |

**Product parity** (same-time feature releases, no community edition) is required. **Semver pins of
core / MCP / compose images may lag cf** -- check each lockfile. Lag is not automatic defect; dual-panel
ship is the review obligation.

Upstream wire contract: `vivijure-cf` `docs/CONTRACT.md` (this repo has no copy; gaps in
`docs/PARITY.md`); module types from core (not a vendored `src/modules/types.ts` fork).

## Rules

- **API parity is non-negotiable.** Routes, status codes, and JSON shapes match cf `CONTRACT.md`.
  Track gaps in `docs/PARITY.md`.
- **Do not change backend engines.** RunPod, `vivijure-local-12gb` / `-16gb`, CPU containers keep
  their wire contracts.
- **Module contract is sacred.** SoT is `@skyphusion-labs/vivijure-core` (`modules/types`,
  `vivijure-module/2`). Do not re-fork types into this host.
- **Object storage is S3-compatible (MinIO default).** `S3_*` env; R2/S3 is a config swap.
  Filesystem (`ARTIFACT_ROOT`) is CI fallback only.
- **Required CI check is `ci`** (typecheck, test, conformance inside that job). Run
  `npm run typecheck` locally before push.
- **Dual-panel release gate (PRODUCT parity).** Ship product-facing changes with `vivijure-cf` in
  the same wave. Review obligation, not a CI check.
- **No byte-identity check on `public/`.** Projectors may diverge; `scripts/sync-from-vivijure.sh`
  is a manual porting aid only.
- **Wan cast train:** homelab does **not** wire `RUNPOD_WAN_TRAIN_ENDPOINT_ID` by default (CF path).
- **Ignore Cursor `AGENTS.md`** if present.

## Commands

```bash
npm run typecheck
npm test
npm run conformance
npm run dev
npm run compose:up      # CPU media stack + optional MinIO (see scripts)
npm run compose:down
docker compose up -d    # when compose files are the local profile you want
```

Other useful scripts: `migrate`, `install:studio`, `module-fleet`, `smoke:exit`, `smoke:exhaustive`,
`dev:mcp` / `deploy:mcp` (MCP Worker config only; package is vivijure-mcp). Full list: `package.json`.

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

Tag must match `package.json` version and `CHANGELOG.md` must contain `## vX.Y.Z`. Tag must be an
ancestor of `origin/main`.

**Review-time half (local#399).** `tests/changelog-version.test.ts` runs inside the required `ci`
check on every PR and asserts that `package.json` version equals the NEWEST `## vX.Y.Z` heading in
`CHANGELOG.md` (the `## Unreleased` section above it is skipped), equals `package-lock.json`
top-level `version`, and equals `package-lock.json` `packages[""].version`. It also asserts that an
EXACT dependency pin on an `@skyphusion-labs/*` package matches what the lock resolves, because
`npm ci` installs the LOCK and a hand-edited pin with a stale lock silently keeps the old package.
Caret and tilde ranges are deliberately not asserted against their floor. The tag-time guard above
fires only when someone cuts a tag; this one fires while a human is still looking at the diff.

### Dependency order

1. If needed, release and publish **`@skyphusion-labs/vivijure-core`** first (`vivijure-core-v*`).
2. Bump the core pin here on `main` (release PR).
3. Tag this repo only after the pin is on `main`.
4. **Dual-panel:** ship product-facing changes with **vivijure-cf** in the same wave.

### Cut a release

Every release goes through a PR, the same as every other change and every other repo. There is
no direct push to `main`, release cuts included (Conrad, 2026-11-10, fleet-chezmoi#1622).

1. Release PR: bump `package.json` and the lockfile, add `CHANGELOG.md` `## vX.Y.Z`, add the
   `RELEASES.md` ledger row. It merges through the normal gate like any PR.
2. Tag the release PR's MERGE COMMIT, not whatever `main` points at when you get to it. Only an
   org admin (the lead or Conrad) can create a release tag; crew open the release PR and ask the
   lead to tag.

```bash
git fetch origin main --tags
sha="$(gh pr view <release-pr> --json mergeCommit -q .mergeCommit.oid)"
git tag -a vX.Y.Z -m "vX.Y.Z" "$sha"
git push origin vX.Y.Z
```

3. Confirm `build-image.yml` green; pin fleet/compose to published image tags when rolling hosts.
4. Verify the **artifact** (running container / API), not only CI.
5. Close the ledger row (`source commit`, `published`) in a follow-up PR once the tag run is
   green.

Merge alone never moves `:latest` / versioned GHCR tags.

## Hard rules

- **CSAM bright-line (NON-NEGOTIABLE):** zero tolerance including synthetic.
- **Clean room** for GPU engines; **verify artifact not pipeline**.
- **Typecheck is the CI gate.**
- **No em-dashes / en-dashes.** Use `--` or commas.
- **Never freeze open sprint boards or specific RunPod endpoint IDs.**
- **Never a plaintext secret in a tracked file.**

## Crew + identity

Crew members work as their own Unix + gh identity (`sudo -u <member> bash -lc '...'`). Crew commits
use `skyphusion-<member>` identity, never Conrad's. Conrad devs only on his laptop
(`Conrad Rockenhaus <conrad@skyphusion.org>`).

## Release convention (bump-at-release)

One convention for every skyphusion-labs repo (Conrad, ruled 2026-11-10, fleet-chezmoi#1766). A version moves ONLY in a release PR: bump the version, then assemble the changelog. Feature and fix PRs do not bump. Releases go through a PR (fleet-chezmoi#1622) and the tag goes on that PR's merge commit.

- Version of record here: package.json (and package-lock.json).
- Tag shape: `v*`.
- Check before a release PR: does a tag already exist for the version currently in the manifest? Yes means the cycle is closed, so the release PR bumps. No means a bump already landed outside a release PR; stop and read why before bumping again.
