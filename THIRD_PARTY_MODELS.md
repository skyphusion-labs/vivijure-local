# Third-party model licenses (vivijure-local)

Status: verified 2026-07-31 / reaffirmed local#277 (2026-08-05). This document is
project-maintained orientation, not legal advice; the upstream license texts control.

The vivijure-local **software** is AGPL-3.0-only (see `LICENSE`). That grant does **not**
cover model weights. Weights are third-party artifacts with their own terms. This file is
the inventory for every model path this door can reach, with the load-bearing commercial
rules. Operator-facing short form: [USE.md](USE.md).

**Maintenance rule:** change this file in the same commit as any change to a model
allowlist, default model id, or self-host sidecar model list. A model list that drifts
from this doc is a defect.

## Load-bearing rule: FLUX commercial use

| Weights | Hugging Face license | Self-host | Commercial path |
|---|---|---|---|
| FLUX.2 Klein **4B** (`black-forest-labs/FLUX.2-klein-4B`) | Apache-2.0 (ungated) | **Allowed** | Unrestricted under Apache-2.0 |
| FLUX.2 Klein **9B** | `flux-non-commercial-license` (gated) | **Forbidden** | Cloudflare Workers AI only (`@cf/black-forest-labs/flux-2-klein-9b`), via CF's BFL partner channel |
| FLUX.2 **dev** | `flux-non-commercial-license` (gated) | **Forbidden** | Cloudflare Workers AI only (`@cf/black-forest-labs/flux-2-dev`) |

That is why:

1. `dev/manifests/cast-image.json` and `src/modules/chain/cast-image-core.ts` default to a
   **`@cf/`** model id, not a Hugging Face self-host id. The default is lawful commercial
   inference through Cloudflare, not a silent self-host of non-commercial weights.
2. Any local cast.image sidecar (see open path for Apache Klein 4B) must allowlist **only**
   Apache-licensed HF ids. Code: `src/modules/chain/cast-image-model-policy.ts`
   (`SELF_HOST_ALLOWED_HF_MODELS` / `refuseSelfHostModel`). Env `CAST_IMAGE_MODEL` and the
   request payload `model` field are both subject to that allowlist -- HF `gated: auto` is
   an accidental speed bump, not a designed guardrail.
3. A contributor or agent must **not** "fix" the cast.image default off `@cf/` into a
   non-commercial HF id. That was the failure mode local#269 invited before this doc.

## Models on the local door

**You download** = weights fetched from upstream at first use; we never ship them in this
repo's images. **Baked** = weights inside a constellation image we publish (inventory lives
in that satellite's own THIRD_PARTY / license tree). **API** = no weights on your box;
provider terms apply.

| Model | Runs where | Delivery | Upstream license | Commercial self-host |
|---|---|---|---|---|
| LTX-Video 2B + 0.9.8-13B-distilled (+ optional spatial upscaler) | 12GB LTX door ([vivijure-local-backend](https://github.com/skyphusion-labs/vivijure-local-backend)) | You download | LTXV Open Weights License 0.X | Permitted below USD 10M annual revenue; use restrictions apply |
| CogVideoX-5b-I2V | 16GB door ([vivijure-local-16gb](https://github.com/skyphusion-labs/vivijure-local-16gb)) | You download | CogVideoX License (custom) | Requires free commercial authorization from licensor; 1M visits/mo service cap |
| RealVisXL V5.0 (SG161222) | Local SDXL keyframe stills | You download | CreativeML Open RAIL++-M | Permitted with Attachment A use restrictions |
| Hyper-SD SDXL 8-step CFG LoRA (ByteDance) | Keyframe step reduction | You download | CreativeML Open RAIL++-M (SD-family section) | Permitted with use restrictions; do not allowlist FLUX.1-dev / SD3 files from the same repo |
| IP-Adapter (h94) | Cast-consistent keyframes | You download | Apache-2.0 | Fine |
| Qwen3-14B (`qwen3:14b` via Ollama) | plan.enhance | Pulled by Ollama | Apache-2.0 | Fine |
| U-2-Net `u2net.onnx` (via rembg 2.0.77) | image-prep CPU container | Baked at runtime pull | rembg MIT; U-2-Net Apache-2.0; redistributed ONNX artifact license follows upstream U-2-Net | Fine |
| MuseTalk stack | Opt-in lipsync satellite | Baked in vivijure-musetalk | MIT + Apache-2.0 + BSD-3-Clause (that repo) | Fine |
| Real-ESRGAN | Opt-in upscale satellite | Baked in vivijure-upscale | BSD-3-Clause | Fine |
| FLUX.2 Klein 4B | Local cast.image sidecar (when enabled) | You download | Apache-2.0 | Fine (only Apache FLUX on the self-host allowlist) |
| FLUX.2 Klein 9B / FLUX.2-dev | **Not** self-hosted | API via `@cf/...` | FLUX Non-Commercial (weights) | Self-host **forbidden**; CF BFL channel only |
| Wan 2.2 A14B | RunPod datacenter backend only (not consumer cards) | Baked in vivijure-backend | Apache-2.0 | See [vivijure-backend THIRD_PARTY_MODELS.md](https://github.com/skyphusion-labs/vivijure-backend/blob/main/THIRD_PARTY_MODELS.md) |

Cloud i2v providers (Seedance, Kling, Veo, Wan API, etc.) and other Workers AI models are
API services under provider terms; no weights land on the box for those steps.

## Code guardrails

| Surface | Guard |
|---|---|
| cast.image cloud catalog default | `@cf/black-forest-labs/flux-2-klein-9b` in `cast-image-core.ts` / manifest fixture -- CF BFL channel |
| cast.image self-host allowlist | `cast-image-model-policy.ts` -- Apache Klein 4B only |
| Local GPU door keyframe models | `vivijure-local-16gb` `_env_allowlisted` (RealVisXL + Hyper-SD only) |
| Datacenter backend bake list | vivijure-backend `DEFAULT_SPECS` + its THIRD_PARTY_MODELS.md |

## Verification sources

- FLUX.2 Klein 4B (apache-2.0): https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- FLUX Non-Commercial (9B / dev family): see model cards under https://huggingface.co/black-forest-labs
- LTXV Open Weights 0.X: https://huggingface.co/Lightricks/LTX-Video-0.9.8-13B-distilled
- CogVideoX License: https://huggingface.co/zai-org/CogVideoX-5b-I2V
- RealVisXL V5.0: https://huggingface.co/SG161222/RealVisXL_V5.0
- Hyper-SD: https://huggingface.co/ByteDance/Hyper-SD
- IP-Adapter: https://huggingface.co/h94/IP-Adapter
- Qwen3-14B: https://huggingface.co/Qwen/Qwen3-14B
- U-2-Net: https://github.com/xuebinqin/U-2-Net
- rembg: https://github.com/danielgatis/rembg
