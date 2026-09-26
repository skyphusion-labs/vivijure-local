# The software, the weights, and commercial use

Status: upstream licenses verified 2026-07-31; FLUX family, Cloudflare partner terms and Gemini
API terms re-read 2026-09-26 (local#269, local#445; sources linked below). This document is
project-maintained orientation, not legal advice; the upstream license texts control.

## The short version

- The vivijure-local SOFTWARE is **AGPL-3.0-only** and free for ANY use, including commercial
  use, for everyone. There is no community edition, no pay gate, and no feature we hold back.
  Run it as a network service and the AGPL asks you to share your changes back.
- The MODEL WEIGHTS the local GPU door runs are **not ours**. Each model carries its own
  upstream license, and several of those restrict commercial use. We cannot grant, waive, or
  relicense any of those terms; only the weight licensor can. What we can do is tell you
  exactly where each model stands, so you do not walk into a licensing problem.
- None of these constraints are imposed by us, and none of them affect homelab, personal,
  research, or other non-commercial use. That audience is who the local door is built for.

## Per-model status

**You download** = the weights are fetched from upstream onto your box at first use; we never
ship them. **Baked** = the weights are inside a container image we publish, redistributed
under the stated upstream license (inventoried in that repo).

| Model | Runs where | Delivery | Upstream license | Commercial use |
|---|---|---|---|---|
| LTX-Video 2B + `LTX-Video-0.9.8-13B-distilled` (+ optional spatial upscaler) | 12GB LTX door motion ([vivijure-local-12gb](https://github.com/skyphusion-labs/vivijure-local-12gb)) | You download (~10GB, first render) | LTXV Open Weights License 0.X | **Permitted below USD 10,000,000 annual revenue**; at or above that Lightricks requires a paid license. Use restrictions apply (Attachment A). |
| CogVideoX-5b-I2V | 16GB door motion ([vivijure-local-16gb](https://github.com/skyphusion-labs/vivijure-local-16gb), the default door) | You download (~22GB, first render) | CogVideoX License (custom) | **Any commercial use requires registering with the licensor** for their (free) basic commercial authorization, and a commercial service is capped at 1,000,000 visits per month. We cannot register for you. Use restrictions apply. |
| RealVisXL V5.0 (SG161222) | Local SDXL keyframe stills, both doors (local#153) | You download | CreativeML Open RAIL++-M | Permitted, subject to the use restrictions in the license. |
| Hyper-SD SDXL 8-step CFG LoRA (ByteDance) | Keyframe step reduction | You download | CreativeML Open RAIL++-M (the SD-family section; the same repo carries FLUX.1-dev and SD3 licenses for OTHER files, which vivijure-local does not allowlist) | Permitted, subject to the use restrictions in the license. |
| IP-Adapter (h94) | Cast-consistent keyframes | You download | Apache-2.0 | **Fine.** |
| Qwen3-14B (`qwen3:14b` via Ollama) | Planner (plan.enhance) | Pulled by Ollama | Apache-2.0 | **Fine.** |
| U-2-Net `u2net.onnx` (via rembg) | image-prep CPU container | Baked | Apache-2.0 (rembg itself MIT) | **Fine.** |
| MuseTalk stack | Opt-in local lipsync satellite (`satellites` profile) | Baked in the [vivijure-musetalk](https://github.com/skyphusion-labs/vivijure-musetalk) image | MIT + Apache-2.0 + BSD-3-Clause (full inventory in that repo) | **Fine.** |
| Real-ESRGAN | Opt-in local upscale satellite | Baked in the [vivijure-upscale](https://github.com/skyphusion-labs/vivijure-upscale) image | BSD-3-Clause | **Fine.** |

Not in this table because it is not on the local door: **Wan 2.2 A14B** (Apache-2.0) runs only
on the datacenter RunPod backend (vivijure-backend); it does not fit consumer cards. Cloud i2v
providers (Seedance, Kling, Veo, the Wan API, and friends) and Workers AI models are API
services governed by provider terms; no weights land on your box for those steps.

In review, not yet shipped: a fully local cast.image path on **FLUX.2 Klein 4B** (Apache-2.0)
is PR [#272](https://github.com/skyphusion-labs/vivijure-local/pull/272). When it lands, the
table gains a commercially unrestricted local image-generation path; until then it is not in
any tagged release. Mind the family split, verified 2026-07-31 across every published variant:
the FLUX.2 klein **4B** line is Apache-2.0, while the klein **9B** line and FLUX.2-dev carry
the FLUX Non-Commercial License. That is exactly why the local path builds on the 4B, and why
the larger klein is consumed only as licensed inference via Workers AI, never self-hosted.
Re-read 2026-09-26: the Apache Klein 4B path is also the **only** FLUX path whose outputs may be
used as LoRA training data, because the Workers AI path is bound to BFL's Terms of Service and
1.3(n) there forbids using Output *"to train, distill or fine-tune any other AI models"* (see the
caveat under "The two supported commercial paths" and `THIRD_PARTY_MODELS.md`).

**Code + inventory (local#277):** the full third-party model table, the FLUX commercial rule,
and the self-host allowlist live in [THIRD_PARTY_MODELS.md](THIRD_PARTY_MODELS.md). The
enforceable guard is `src/modules/chain/cast-image-model-policy.ts` (verified-permissive HF ids
for self-host, Apache Klein 4B only today; `@cf/` defaults stay on the CF BFL channel).

## What this means in practice

- **Homelab, personal, research, community use: every path above is fine.** Nothing to
  register, nothing to pay, nothing we meter.
- **Commercial operation of the LOCAL inference path is between you and each weight
  licensor.** The sharp edge is the default 16GB door: the CogVideoX License does not permit
  commercial use until you register with the licensor, and caps a commercial service at 1M
  visits per month. The 12GB LTX door is commercially usable below USD 10M annual revenue.
  The OpenRAIL++ keyframe components permit commercial use with use restrictions. The
  Apache-2.0 and BSD components are commercially unrestricted.
- We do not police any of this and we do not phone home. It is your compliance obligation,
  stated here so it is visible before it bites.

## The two supported commercial paths

If you want to operate vivijure commercially without carrying model-weight obligations
yourself:

1. **Connect vivijure-local to Cloudflare Workers AI** for the cloud keyframe and image
   modules: you consume licensed inference from Cloudflare, and no third-party weights run on
   your box for those steps. (This is also why FLUX is offered via Workers AI and never
   self-hosted here: BFL-licensed FLUX weights require a commercial license unless consumed
   through BFL or a partner.)

   **Caveat for `cast.image` specifically (read from the texts 2026-09-26, local#269).** Licensed
   inference is not a licence to train. Cloudflare binds Workers AI use of the
   `@cf/black-forest-labs/*` models to BFL's Terms of Service, and 1.3(n) there forbids using
   Output *"to train, distill or fine-tune any other AI models"*. `cast.image` produces LoRA
   training references, so on the plain text the `@cf/` FLUX models are not a lawful source of
   training data even for a commercial operator. Whether that clause reaches Cloudflare partner
   consumption at all is with counsel ([vivijure-cf#751](https://github.com/skyphusion-labs/vivijure-cf/issues/751));
   until ruled, do not train on `@cf/` FLUX outputs. The local Apache Klein 4B path carries no
   such term. The same BFL terms and Usage Policy, and for `google/nano-banana-pro` the Gemini API
   terms (18+, no service directed at or likely to be accessed by under-18s), bind you as the
   provider's customer when you connect your own accounts.
2. **Use the hosted studio** ([vivijure-cf](https://github.com/skyphusion-labs/vivijure-cf)),
   where the operators carry the backend model licensing.

Both paths run the same software at the same release cadence; parity is absolute for our code
(see [docs/PARITY.md](docs/PARITY.md)).

## License verification sources (2026-07-31)

- LTXV Open Weights License 0.X: https://huggingface.co/Lightricks/LTX-Video-0.9.8-13B-distilled/blob/main/LTX-Video-Open-Weights-License-0.X.txt
- CogVideoX License: https://huggingface.co/zai-org/CogVideoX-5b-I2V/blob/main/LICENSE
- RealVisXL V5.0 (openrail++): https://huggingface.co/SG161222/RealVisXL_V5.0
- Hyper-SD tri-license file: https://huggingface.co/ByteDance/Hyper-SD/blob/main/LICENSE.md
- IP-Adapter (apache-2.0): https://huggingface.co/h94/IP-Adapter
- Qwen3-14B (apache-2.0): https://huggingface.co/Qwen/Qwen3-14B
- U-2-Net (Apache-2.0): https://github.com/xuebinqin/U-2-Net
- MuseTalk (MIT, weights usable for any purpose per upstream): https://github.com/TMElyralab/MuseTalk
- Real-ESRGAN (BSD-3-Clause): https://github.com/xinntao/Real-ESRGAN
- FLUX.2 Klein 4B (apache-2.0, in-repo LICENSE.md verbatim Apache-2.0, read 2026-09-26 at revision
  `e7b7dc2`): https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- FLUX Non-Commercial (klein 9B / FLUX.2-dev; HF copies gated, read from BFL's GitHub 2026-09-26):
  https://github.com/black-forest-labs/flux2/tree/main/model_licenses
- Cloudflare Workers AI FLUX model pages ("Terms and License" -> https://bfl.ai/legal/terms-of-service,
  2026-09-26): https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/
- Cloudflare Developer Platform terms, Workers AI section:
  https://www.cloudflare.com/service-specific-terms-developer-platform/
- Google Gemini API Additional Terms (effective 2026-03-23): https://ai.google.dev/gemini-api/terms
- Wan 2.2 (apache-2.0): https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B
