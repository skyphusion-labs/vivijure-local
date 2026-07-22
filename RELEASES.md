# Releases -- vivijure-local

Self-hosted Vivijure Studio (Node, SQLite, S3/MinIO). A release is:

1. Version bump in `package.json` on `main`
2. Git tag `vX.Y.Z` pushed to origin
3. **GitHub Release** on that tag (`gh release create vX.Y.Z ...`)
4. GHCR images published by `.github/workflows/build-image.yml` on tag push
   (`ghcr.io/skyphusion-labs/vivijure-local-studio:X.Y.Z` + `:latest`)

Merge to `main` alone does **not** publish images; cut a tag deliberately.

## Cutting a release

```bash
# 1. Bump package.json + CHANGELOG.md (+ lockfile: npm install)
# 2. Tag + push
git tag v1.1.5
git push origin v1.1.5

# 3. GitHub Release
gh release create v1.1.5 --title "v1.1.5" --notes-file notes.md

# 4. Confirm build-image workflow green
gh run list --workflow build-image.yml --limit 3
```

**Dual-panel rule:** ship paired with `vivijure-cf` in the same wave; pin the same
`@skyphusion-labs/vivijure-core` semver.

## Release ledger

| git tag | GHCR studio | source commit | published | notes |
|---|---|---|---|---|
| `v1.1.11` | 1.1.11 | (pending) | 2026-07-22 | **Dual-panel cf v1.7.10:** security grind (CSRF/demo/MinIO/cast MIME/speech project). |
| `v1.1.10` | 1.1.10 | 20d4a81 | 2026-07-22 | **Dual-panel cf v1.7.9:** core ^1.2.5 (cf#110 + core#54 catalog.order UI); parity/CI #103/#117; cast e2e #113. |
| `v1.1.9` | 1.1.9 | 3748560 | 2026-07-22 | **Dual-panel cf v1.7.8:** re-list `alibaba-wan-lora` on default compose (drop profile gate); wire studio `MODULE_ALIBABA_WAN_LORA_URL` + depends_on. |
| `v1.1.6` | 1.1.6 | (pending) | (pending) | Security (#146): sharp 0.35.3, SSRF url_guard on finish sidecars, CodeQL config. CI inline GPU sync (#144). gitignore .wrangler (#145). |
| `v1.1.5` | 1.1.5 | d7700bb | 2026-07-21 | **Dual-panel cf#29:** core ^1.2.2, Aura-1 TTS (#141), ai-run path fix, dialogue-gen gateway env, finish-stack voiced verify. Pairs cf v1.7.4. |
| `v1.1.4` | 1.1.4 | 6656ea1 | 2026-07-21 | Pillow 12.3.0 in image-prep sidecar (#140). Tag only; no GitHub Release at cut time. |
| `v1.1.3` | 1.1.3 | ad8a202 | 2026-07-21 | Wan LoRA UI + planner parity with cf v1.7.3 (#138). Tag only; no GitHub Release at cut time. |
| `v1.1.0` | 1.1.0 | -- | 2026-07-18 | Chat/image module territory (cf#129). |
