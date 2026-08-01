# `dev/manifests/` -- module manifest FIXTURES

These are committed copies of the `MANIFEST` literal each `vivijure-cf` module worker exports,
extracted by `scripts/sync-module-manifests.ts` (`npm run module-manifests`) and pinned here so
`scripts/check-module-manifest-drift.sh` can fail when this repo's understanding of a module drifts
from the module itself.

## A fixture is not a module

**A file in this directory does not mean vivijure-local installs, ships, or can run that module.**
A module is something the registry can DISCOVER: a `MODULE_<NAME>_URL` binding pointing at something
that serves `GET /module.json`. A fixture is a manifest on disk. The two are read together by the
dev tooling, and confusing them is how a module with no implementation behind it ends up rendered as
a working, configurable feature in the panel (the frontend is a projection of the registry, so
anything the registry carries gets a config panel).

What actually decides whether a local install has a module:

| Question | Answered by |
| --- | --- |
| Can a local install bring it up? | a service in `compose.yaml`, in any profile (default, `cloud`, `satellites`, `localgpu`, `edge`) |
| Does the documented dev fleet stand it up? | `scripts/dev-module-fleet.sh` |
| Is there a fixture for it? | this directory (NOT an answer to either question above) |

## `finish-rife.json` is the case that proves the rule (local#291)

**vivijure-local ships no RIFE image and has no local RIFE path** (Conrad 2026-07-28). The build
workflow retired the image on purpose (`.github/workflows/build-image.yml`),
`src/modules/finish-backend.ts` documents that there is no `LOCAL_FINISH_RIFE_URL`, and
`scripts/finish-module-server.ts` refuses `finish-rife` outright on the local backend. There is no
`module-finish-rife` service in `compose.yaml` under any profile, and it is deliberately absent from
`scripts/dev-module-fleet.sh`.

`finish-rife.json` is still here because it has two real consumers, neither of which is a local
install:

1. `check-module-manifest-drift.sh` diffs every committed fixture against the `vivijure-cf` module.
   Removing the fixture without removing the sync-list entry (or the reverse) fails that check by
   design, and the drift signal against cf is worth keeping.
2. An operator who wires RIFE to RunPod **explicitly** (`scripts/finish-module-server.ts`, see
   `docs/FINISH_BACKEND.md`) reads the config schema from this fixture. That path is opt-in, wired by
   hand, and stays supported. What is not supported is a local install being handed RIFE knobs it
   never asked for.

Fence: `tests/finish-rife-not-local-291.test.ts`.

## Two fixtures are excluded from the drift check

- `bare-planner.json` -- a deliberate enum-less fixture for the gate / e2e, not produced by sync.
- `plan-enhance.json` -- the local-only Ollama first-win catalog (Conrad 2026-07-28 / #265). cf keeps
  the Anthropic / AI Gateway manifest. Do not re-sync this file from cf.
