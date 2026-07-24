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
| `v1.2.0` | 1.2.0 | (pending) | (pending) | Epic #200 (no-RunPod default): #201 broken-button fix, #202 creds-free narration tier, #203 no-RunPod docs, #209 narration default compose, #204 RIFE homelab serve adopt, #213/#214 honest Wan train-time copy, core ^1.2.13. |
| `v1.1.16` | 1.1.16 | d70c624 | 2026-07-23 | **Ledger-gap backfill (cf#215 Lane D):** ad-hoc security-day tag, package.json never bumped past 1.1.15, no CHANGELOG heading cut at the time; backfilled 2026-07-25. K3 hardening: #194/#196 core pins, #195 dockerignore secrets, #197/#198 K3 FP runlogs, #199 cast import cap + safe URI decode. GHCR publish confirmed live (build-image run 2026-07-23T19:36:02Z). See CHANGELOG.md. |
| `v1.1.15` | 1.1.15 | 3f52bdc | 2026-07-23 | **Backfilled (cf#215 Lane D, 2026-07-25):** ledger row only was missing; package.json and CHANGELOG.md were both correct at the time. Wan cast train default (cf#29 Phase E): core `^1.2.8`; Cast UI parity with cf via /train-lora, SDXL escape hatch sends model_family:"sdxl". GHCR publish confirmed live (build-image run 2026-07-23T04:28:31Z). |
| `v1.1.14` | 1.1.14 | (pending) | (pending) | Homelab panel closeout (#180): #186-190 compose + secrets; default CPU + local-gpu; no RIFE/speech-upscale in default. |
| `v1.1.13` | 1.1.13 | (pending) | (pending) | **FINISH_BACKEND** local router (#180 / #182). Image only; propagandhi cutover waits on GEX44 finish HTTP stack. |
| `v1.1.12` | 1.1.12 | 4747f2a | 2026-07-22 | **Dual-panel cf v1.7.11:** local-GPU keyframes (#153); core `^1.2.7`; door images `1.0.3`. |
| `v1.1.11` | 1.1.11 | 91d85b2 | 2026-07-22 | **Dual-panel cf v1.7.10:** security grind (CSRF/demo/MinIO/cast MIME/speech project). |
| `v1.1.10` | 1.1.10 | 20d4a81 | 2026-07-22 | **Dual-panel cf v1.7.9:** core ^1.2.5 (cf#110 + core#54 catalog.order UI); parity/CI #103/#117; cast e2e #113. |
| `v1.1.9` | 1.1.9 | 3748560 | 2026-07-22 | **Dual-panel cf v1.7.8:** re-list `alibaba-wan-lora` on default compose (drop profile gate); wire studio `MODULE_ALIBABA_WAN_LORA_URL` + depends_on. |
| `v1.1.6` | 1.1.6 | (pending) | (pending) | Security (#146): sharp 0.35.3, SSRF url_guard on finish sidecars, CodeQL config. CI inline GPU sync (#144). gitignore .wrangler (#145). |
| `v1.1.5` | 1.1.5 | d7700bb | 2026-07-21 | **Dual-panel cf#29:** core ^1.2.2, Aura-1 TTS (#141), ai-run path fix, dialogue-gen gateway env, finish-stack voiced verify. Pairs cf v1.7.4. |
| `v1.1.4` | 1.1.4 | 6656ea1 | 2026-07-21 | Pillow 12.3.0 in image-prep sidecar (#140). Tag only; no GitHub Release at cut time. |
| `v1.1.3` | 1.1.3 | ad8a202 | 2026-07-21 | Wan LoRA UI + planner parity with cf v1.7.3 (#138). Tag only; no GitHub Release at cut time. |
| `v1.1.0` | 1.1.0 | -- | 2026-07-18 | Chat/image module territory (cf#129). |
