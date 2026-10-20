"""Apache-only model allowlist for the local cast.image sidecar.

Keep the ids and the revisions in sync with
src/modules/chain/cast-image-model-policy.ts
(SELF_HOST_ALLOWED_HF_MODELS and SELF_HOST_MODEL_REVISIONS).

FLUX.2 klein-9B and flux-2-dev weights are FLUX Non-Commercial. Commercial use
of those weights is lawful only through Cloudflare's BFL partner channel.
This sidecar must never load them.

Env CAST_IMAGE_MODEL and the request payload `model` field are both subject
to this list. An HF gated:auto flag is not a guardrail.
"""
from __future__ import annotations

import os

# Bare repo ids. The revision pin is ALLOWED_REVISIONS, not this set.
ALLOWED_HF_MODELS: frozenset[str] = frozenset(
    {
        "black-forest-labs/FLUX.2-klein-4B",
    }
)

# Licence read at this revision (THIRD_PARTY_MODELS.md). The short form e7b7dc2
# is the same commit. The loader must pass this string to from_pretrained.
ALLOWED_REVISIONS: dict[str, str] = {
    "black-forest-labs/FLUX.2-klein-4B": "e7b7dc27f91deacad38e78976d1f2b499d76a294",
}

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


def revision_for(model_id: str) -> str:
    """Pinned revision for an allowlisted id. Anything else is refused."""
    resolved = resolve_model(model_id)
    revision = ALLOWED_REVISIONS.get(resolved)
    if not revision:
        raise ValueError(
            f"cast.image self-host: {resolved} has no pinned revision. "
            "See THIRD_PARTY_MODELS.md."
        )
    return revision


def pretrained_kwargs(model_id: str) -> dict[str, str]:
    """Arguments the loader passes to from_pretrained besides the repo id."""
    return {"revision": revision_for(model_id)}


def env_default_model() -> str:
    """Read CAST_IMAGE_MODEL; refuse a non-allowlisted override at import."""
    if "CAST_IMAGE_MODEL" not in os.environ:
        return DEFAULT_HF_MODEL
    return resolve_model(os.environ.get("CAST_IMAGE_MODEL"))
