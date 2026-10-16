# Third-party model licenses (vivijure-local)

Status: verified 2026-07-31 / reaffirmed local#277 (2026-08-05) / FLUX family, Cloudflare partner
terms and Gemini API terms re-read from the texts 2026-09-26 (local#269, local#445). This document is
project-maintained orientation, not legal advice; the upstream license texts control.

The vivijure-local **software** is AGPL-3.0-only (see `LICENSE`). That grant does **not**
cover model weights. Weights are third-party artifacts with their own terms. This file is
the inventory for every model path this door can reach, with the load-bearing commercial
rules. Operator-facing short form: [USE.md](USE.md).

**Maintenance rule:** change this file in the same commit as any change to a model
allowlist, default model id, or self-host sidecar model list. A model list that drifts
from this doc is a defect.

## Load-bearing rule: FLUX commercial use

| Weights | Hugging Face license | Self-host | Commercial path | Outputs as training data |
|---|---|---|---|---|
| FLUX.2 Klein **4B** (`black-forest-labs/FLUX.2-klein-4B`, revision `e7b7dc27f91deacad38e78976d1f2b499d76a294`) | Apache-2.0 (ungated); in-repo `LICENSE.md` is the verbatim Apache License 2.0, sha256 `ca02bc51900ab07789d1b70283329e7137f5af98f5161c23a1c81fc38a4af1fe`; no NOTICE file | **Allowed** (this revision) | Unrestricted under Apache-2.0 | **Yes.** Apache-2.0 says nothing about outputs; silence in a permissive copyright licence is the absence of a restriction. |
| FLUX.2 Klein **9B** | `flux-non-commercial-license` (gated; text read from BFL's GitHub copy, see sources) | **Forbidden** | Cloudflare Workers AI only (`@cf/black-forest-labs/flux-2-klein-9b`), via CF's BFL partner channel, **for inference** | **No, on the plain text.** The `@cf/` path is bound to BFL's Terms of Service, 1.3(n) (see below). Pending the cf#751 ruling, treat these outputs as not training data. |
| FLUX.2 **dev** | `flux-non-commercial-license` (gated; same) | **Forbidden** | Cloudflare Workers AI only (`@cf/black-forest-labs/flux-2-dev`), **for inference** | **No, on the plain text.** Same clause. |

That is why:

1. `dev/manifests/cast-image.json` and `src/modules/chain/cast-image-core.ts` default to a
   **`@cf/`** model id, not a Hugging Face self-host id. The default is lawful commercial
   inference through Cloudflare, not a silent self-host of non-commercial weights.
2. Any local cast.image sidecar (see open path for Apache Klein 4B) must allowlist **only**
   verified-permissive HF ids (the rule is defined in its own section below; Apache Klein 4B
   is the only member today). Code: `src/modules/chain/cast-image-model-policy.ts`
   (`SELF_HOST_ALLOWED_HF_MODELS` / `refuseSelfHostModel`). Env `CAST_IMAGE_MODEL` and the
   request payload `model` field are both subject to that allowlist -- HF `gated: auto` is
   an accidental speed bump, not a designed guardrail.
3. A contributor or agent must **not** "fix" the cast.image default off `@cf/` into a
   non-commercial HF id. That was the failure mode local#269 invited before this doc.

### The `@cf/` path is licensed inference, and it carries conduct terms about outputs

Read from the texts 2026-09-26 (local#269). Cloudflare's Workers AI model pages for all three
`@cf/black-forest-labs/*` ids carry the badge **Partner** and link "Terms and License" to
`https://bfl.ai/legal/terms-of-service`. Cloudflare's Developer Platform Service-Specific Terms
(Workers AI section) say: *"Machine learning models made available by Cloudflare in connection
with the Services constitute Third-Party Products ... By using such machine learning models, you
agree to the applicable third-party terms, including any acceptable use policies or other
restrictions on use of such model."* The BFL Terms of Service then say, in 1.3 "Restrictions On
Your Use of the Services": *"You may not do any of the following in connection with your use of
the Services: ... (n) use Output to train, distill or fine-tune any other AI models;"*.

`cast.image` exists to produce a LoRA training set. On the plain text, **outputs from the `@cf/`
FLUX path are not training data**, on either door. Whether BFL's ToS (scoped to BFL's own
Services) reaches Cloudflare partner consumption at all is a question for counsel, tracked as
[vivijure-cf#751](https://github.com/skyphusion-labs/vivijure-cf/issues/751); until it is ruled,
the cautious reading stands and no lane designs as though CF FLUX outputs may be trained on.
Consequence: the local Apache Klein 4B path is not only the licence-clean path, it is the **only**
FLUX path whose outputs may feed `/train-lora`.

The same terms also bind conduct on the `@cf/` path, whoever the operator is: 1.2(c) (consent
where Output depicts *"real, identifiable individuals"*), 1.3(m) (no representing Output as
human-generated or as a real photograph), 1.3(p) (no stripping AI content marking), and the BFL
Usage Policy incorporated by 1.2(h) (no CSAM/NCII, no military, surveillance, law-enforcement or
biometric-inference use, no EU "high-risk AI system"). `google/nano-banana-pro` is reached through
the Gemini API, whose Additional Terms (effective 2026-03-23) require the operator to be 18+ and
to *"not use the Services as part of a website, application, or other service ... that is
directed towards or is likely to be accessed by individuals under the age of 18"*, and forbid using
the Services *"to develop models that compete with the Services"*. On a self-hosted instance these
bind the self-hoster as the provider's customer; on a hosted instance they bind the operator of
that instance.

### Verified-permissive: the rule the self-host allowlist encodes

"Apache-only" is the label; this is the rule. A weight repo may be added to
`SELF_HOST_ALLOWED_HF_MODELS` (and the sidecar mirror) only when all five hold, and this file is
updated in the same commit:

1. The licence **text** was read from the artifact itself (an HF `license:` tag is a claim, not a
   grant; a gated repo whose licence file returns 401 has not been read).
2. The licence is OSI-permissive (Apache-2.0, MIT, BSD all qualify; "Apache" is not special).
3. The text carries **no output-use clause and no field-of-use clause** (RAIL-family and
   "non-commercial" licences fail here even when they are otherwise generous).
4. The allowlist entry pins the **revision** whose licence was read, and the loader passes that
   revision through; a later revision can ship a different `LICENSE.md` under the same name.
5. This file records the revision, the licence text's sha256 and the in-repo components.

Applied to the candidates named in local#269 (all retrieved 2026-09-26):

| Candidate | Status | Why |
|---|---|---|
| `black-forest-labs/FLUX.2-klein-4B` @ `e7b7dc2` | **Allowlisted** | Verbatim Apache-2.0 in repo. Components loaded by `Flux2KleinPipeline.from_pretrained`: `Flux2Transformer2DModel`, `AutoencoderKLFlux2`, a `Qwen3ForCausalLM` text encoder of the Qwen3-4B class (upstream `Qwen/Qwen3-4B` is Apache-2.0), `Qwen2TokenizerFast`; all inside the repo under its licence. |
| `Qwen/Qwen-Image` | Would qualify; **not allowlisted** | In-repo `LICENSE` is verbatim Apache-2.0 (sha256 `832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e`). Excluded on VRAM, not licence. |
| `Tongyi-MAI/Z-Image-Turbo` | **Do not allowlist** | HF tag says `apache-2.0`; the repo contains **no licence file** and the README has no licence section. Fails rule 1. |
| `black-forest-labs/FLUX.1-schnell` | **Do not allowlist** until the gate is read | BFL's GitHub copy is verbatim Apache-2.0, but the HF repo is `gated: auto` and its `LICENSE.md` returns 401; the click-through text is unread. Fails rule 1 today. |

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
| FLUX.2 Klein 4B (revision `e7b7dc2`) | Local cast.image sidecar (when enabled) | You download | Apache-2.0 | Fine (the only member of the verified-permissive self-host allowlist; outputs may be trained on) |
| FLUX.2 Klein 9B / FLUX.2-dev | **Not** self-hosted | API via `@cf/...` | FLUX Non-Commercial (weights); BFL Terms of Service on the `@cf/` path | Self-host **forbidden**; CF BFL channel for inference only; **outputs not training data** on the plain text of BFL ToS 1.3(n) (cf#751) |
| Wan 2.2 A14B | RunPod datacenter backend only (not consumer cards) | Baked in vivijure-backend | Apache-2.0 | See [vivijure-backend THIRD_PARTY_MODELS.md](https://github.com/skyphusion-labs/vivijure-backend/blob/main/THIRD_PARTY_MODELS.md) |

Cloud i2v providers (Seedance, Kling, Veo, Wan API, etc.) and other Workers AI models are
API services under provider terms; no weights land on the box for those steps.

## Code guardrails

| Surface | Guard |
|---|---|
| cast.image cloud catalog default | `@cf/black-forest-labs/flux-2-klein-9b` in `cast-image-core.ts` / manifest fixture -- CF BFL channel |
| cast.image self-host allowlist | `cast-image-model-policy.ts` -- verified-permissive rule, Apache Klein 4B only today; enforcement spec on local#398 |
| Local GPU door keyframe models | `vivijure-local-16gb` `_env_allowlisted` (RealVisXL + Hyper-SD only) |
| Datacenter backend bake list | vivijure-backend `DEFAULT_SPECS` + its THIRD_PARTY_MODELS.md |

## Verification sources

- FLUX.2 Klein 4B (apache-2.0): https://huggingface.co/black-forest-labs/FLUX.2-klein-4B (in-repo
  `LICENSE.md`, `model_index.json`, `text_encoder/config.json` read 2026-09-26 at revision `e7b7dc2`)
- FLUX Non-Commercial (9B / dev family): the HF in-repo `LICENSE.md` files are gated (401 without
  accepting the gate). BFL publishes the same licences on GitHub, read 2026-09-26:
  https://github.com/black-forest-labs/flux2/blob/main/model_licenses/LICENSE-FLUX-NON-COMMERICAL
  (v2.1, sha256 `e98f298dae1bcc91aeb13e30948d8600418d8a161840e34078bbaf2b18abcecc`) and
  https://github.com/black-forest-labs/flux2/blob/main/model_licenses/LICENSE-FLUX-DEV (v2.0, sha256
  `49d6e28784b26ba85d2849a68c2d1144600f0bf52136878cd152f604c65580a8`). Whether the gated in-repo
  copies are byte-identical is unverified.
- FLUX.1 schnell (Apache-2.0 on GitHub; HF repo gated):
  https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-schnell
- Cloudflare Workers AI model pages (2026-09-26; "Terms and License" -> BFL ToS):
  https://developers.cloudflare.com/workers-ai/models/flux-2-klein-9b/ ,
  https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/ ,
  https://developers.cloudflare.com/workers-ai/models/flux-2-dev/
- Cloudflare Developer Platform Service-Specific Terms (Workers AI section):
  https://www.cloudflare.com/service-specific-terms-developer-platform/
- BFL Terms of Service: https://bfl.ai/legal/terms-of-service ; BFL Usage Policy (Last Revised
  2026-08-04): https://bfl.ai/legal/usage-policy
- Google Gemini API Additional Terms (effective 2026-03-23): https://ai.google.dev/gemini-api/terms ;
  Generative AI Prohibited Use Policy: https://policies.google.com/terms/generative-ai/use-policy
- Qwen-Image (apache-2.0, in-repo LICENSE read 2026-09-26): https://huggingface.co/Qwen/Qwen-Image
- Z-Image-Turbo (tag only, no licence file, 2026-09-26): https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- LTXV Open Weights 0.X: https://huggingface.co/Lightricks/LTX-Video-0.9.8-13B-distilled
- CogVideoX License: https://huggingface.co/zai-org/CogVideoX-5b-I2V
- RealVisXL V5.0: https://huggingface.co/SG161222/RealVisXL_V5.0
- Hyper-SD: https://huggingface.co/ByteDance/Hyper-SD
- IP-Adapter: https://huggingface.co/h94/IP-Adapter
- Qwen3-14B: https://huggingface.co/Qwen/Qwen3-14B
- U-2-Net: https://github.com/xuebinqin/U-2-Net
- rembg: https://github.com/danielgatis/rembg
