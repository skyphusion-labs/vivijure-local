# Phase 3 -- vivijure v2.0 / shared core

**Goal:** One orchestration codebase (`vivijure-core`), two thin hosts (`vivijure`, `vivijure-local`).

```
vivijure-core@2.x     registry, film/render orchestrators, types, conformance
vivijure@2.x          CloudflarePlatform host
vivijure-local@2.x    NodePlatform host
```

Phase 2 proved Option B on a homelab stack. Phase 3 extracts the forked orchestration into a
published package and deletes duplicate logic from both hosts.

## Milestones

| ID | Deliverable | Status |
|----|-------------|--------|
| M13 | Freeze Platform ICD (`docs/PLATFORM.md`, contract tests) | done |
| M14 | `packages/vivijure-core` scaffold (platform + module types export) | done |
| M15 | Extraction inventory + wave plan (`docs/core-extraction-inventory.md`) | done |
| M16 | Move dependency-free core (`types`, `conformance`, `structured-events`, `beat-sync-types`) into package | done |
| M17 | Move registry + film-model; hosts depend on `@skyphusion-labs/vivijure-core` | done |
| M18 | Move orchestrators; delete env bridge; single conformance suite in core CI | done |
| M19 | DB helpers + render-log in core | done |
| M20 | Bundle assembly (`bundle-assembler`, storyboard validate/yaml, tar) in core | done |

## Extraction waves (summary)

See [core-extraction-inventory.md](core-extraction-inventory.md) for the file list.

1. **Wave 0** -- no I/O: `modules/types.ts`, `modules/conformance.ts`, `structured-events.ts`, `beat-sync-types.ts`
2. **Wave 1** -- registry: `modules/registry.ts`, render pipeline helpers
3. **Wave 2** -- pure models: `film-model.ts`, validation helpers
4. **Wave 3** -- orchestrators: `film-orchestrator.ts`, `render-orchestrator.ts` (replace `env.*` with `platform.*`)
5. **Wave 4** -- DB helpers: `*-db.ts` (parameterized on `Platform.db`)

**Stays in hosts:** `src/platform/*` implementations (except lifted `types.ts`), `server.ts`, routes,
`compose.yaml`, operator docs.

## Release semantics (unchanged from ROADMAP)

- **vivijure 2.0.0** -- CF host on shared core; no user-facing API breaks (`vivijure-module/2` unchanged)
- **vivijure-local 2.0.0** -- Node host on same core; `docs/PARITY.md` fully green
- **CONTRACT.md** remains in `vivijure` until doc packaging merges

## Coordination with CF-native v1

Upstream `vivijure` continues shipping CF-native v1 until `vivijure-core` is ready. `vivijure-local`
carries the Platform ICD first; the CF host adopts the same ICD when orchestrators move to the package.
