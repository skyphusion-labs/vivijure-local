"""Apache-only model allowlist for the local cast.image sidecar (local#277).

FLUX.2 klein-9B and flux-2-dev weights are FLUX Non-Commercial. Commercial use is
lawful only through Cloudflare's BFL partner channel (@cf/...). This sidecar must
never load those weights: only Apache-2.0 Klein 4B is permitted.

Pattern mirrors vivijure-local-16gb preview_sdxl._env_allowlisted. Env
CAST_IMAGE_MODEL and the request payload `model` field are both subject to this
list -- HF gated:auto is not a designed guardrail.
"""
from __future__ import annotations

import os

# Keep in sync with src/modules/chain/cast-image-model-policy.ts SELF_HOST_ALLOWED_HF_MODELS.
ALLOWED_HF_MODELS: frozenset[str] = frozenset(
    {
        "black-forest-labs/FLUX.2-klein-4B",
    }
)

DEFAULT_HF_MODEL = "black-forest-labs/FLUX.2-klein-4B"


def refuse_model(model_id: str | None) -> str | None:
    """Return a refusal message when model_id is not Apache-allowlisted; else None."""
    raw = (model_id or "").strip()
    if not raw:
        return (
            "cast.image self-host: empty model id refused; "
            f"permitted Apache-only: {sorted(ALLOWED_HF_MODELS)}"
        )
    if raw in ALLOWED_HF_MODELS:
        return None
    lower = raw.lower()
    if (
        "flux-2-klein-9b" in lower
        or "flux.2-klein-9b" in lower
        or "flux-2-dev" in lower
        or "flux.2-dev" in lower
    ):
        return (
            f"cast.image self-host: {raw} carries the FLUX Non-Commercial License and "
            "must not be self-hosted. Commercial use is lawful only via Cloudflare "
            "Workers AI (@cf/black-forest-labs/...). "
            f"Apache-only allowlist: {sorted(ALLOWED_HF_MODELS)}. See THIRD_PARTY_MODELS.md."
        )
    return (
        f"cast.image self-host: {raw} is not on the Apache-only allowlist; "
        f"permitted: {sorted(ALLOWED_HF_MODELS)}. See THIRD_PARTY_MODELS.md (local#277)."
    )


def resolve_model(model_id: str | None = None) -> str:
    """Resolve a model id; raise ValueError when not allowlisted."""
    raw = (model_id or "").strip()
    if not raw:
        return DEFAULT_HF_MODEL
    msg = refuse_model(raw)
    if msg:
        raise ValueError(msg)
    return raw


def env_default_model() -> str:
    """Read CAST_IMAGE_MODEL from the environment; refuse non-allowlisted overrides at import/start."""
    if "CAST_IMAGE_MODEL" not in os.environ:
        return DEFAULT_HF_MODEL
    return resolve_model(os.environ.get("CAST_IMAGE_MODEL"))
