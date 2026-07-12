# @skyphusion-labs/vivijure-core

**Phase 3 scaffold.** This package will hold orchestration logic shared by:

- [`vivijure`](https://github.com/skyphusion-labs/vivijure) (Cloudflare Workers host)
- [`vivijure-local`](https://github.com/skyphusion-labs/vivijure-local) (Node homelab host)

Today it exports only the frozen **Platform ICD** (`src/platform/types.ts`). Wave 0 module types and
conformance move here in M16+.

Plan: [docs/PHASE3.md](../../docs/PHASE3.md) · Inventory: [docs/core-extraction-inventory.md](../../docs/core-extraction-inventory.md)

## Status

| Wave | Content | Status |
|------|---------|--------|
| Platform ICD | `platform/types.ts` | copied (sync with `src/platform/types.ts` until single source) |
| Wave 0 | `modules/types`, conformance, structured-events | pending |
| Wave 3 | orchestrators | pending |

When this package publishes to npm/GitHub Packages, both hosts will depend on `@skyphusion-labs/vivijure-core@2.x`
and delete forked copies under their `src/` trees.
