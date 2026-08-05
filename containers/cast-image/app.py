"""Local cast.image backend: FLUX.2 Klein 4B (Apache-2.0) over HTTP.

Homelab path for vivijure-local#269. Fits the 16GB sequential-VRAM door:
cast.image (this service) → unload → Ollama plan.enhance → unload → local-gpu keyframe.

Endpoints:
  GET  /health   → { ok, configured, model, gpu, cuda }
  POST /generate → { prompt, width?, height?, ref_images?: [b64...] } → { image, mime }
  POST /unload   → { ok }  (drop pipeline from VRAM)

When CUDA is absent the server still binds and reports configured:false so compose
healthchecks pass; /generate returns a clear 503.

LICENSING (local#277): only Apache-2.0 Klein 4B is allowlisted for self-host.
CAST_IMAGE_MODEL and payload model are both subject to model_allowlist.py --
non-commercial FLUX (9B / dev) must go through Cloudflare's BFL channel, never here.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import threading
from typing import Any

from aiohttp import web

from model_allowlist import env_default_model, resolve_model

PORT = int(os.environ.get("PORT", "8785"))
# Allowlist-enforced (local#277). A non-Apache CAST_IMAGE_MODEL fails at import.
DEFAULT_MODEL = env_default_model()
# Optional bearer (defense in depth on LAN-exposed GPU hosts).
SERVICE_TOKEN = (os.environ.get("CAST_IMAGE_TOKEN") or "").strip()
MAX_REFS = 4
DEFAULT_STEPS = int(os.environ.get("CAST_IMAGE_STEPS", "4"))
DEFAULT_GUIDANCE = float(os.environ.get("CAST_IMAGE_GUIDANCE", "1.0"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("cast-image")

_lock = threading.Lock()
_pipe: Any = None
_pipe_model: str | None = None


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _auth_ok(request: web.Request) -> bool:
    if not SERVICE_TOKEN:
        return True
    hdr = request.headers.get("Authorization") or ""
    if hdr == f"Bearer {SERVICE_TOKEN}":
        return True
    return False


def _require_auth(request: web.Request) -> web.Response | None:
    if _auth_ok(request):
        return None
    return web.json_response({"ok": False, "error": "unauthorized"}, status=401)


def _load_pipe(model_id: str) -> Any:
    global _pipe, _pipe_model
    with _lock:
        if _pipe is not None and _pipe_model == model_id:
            return _pipe
        if not _cuda_available():
            raise RuntimeError(
                "cast.image local: no CUDA GPU. Klein 4B needs ~13GB VRAM "
                "(16GB door path). On NVIDIA hosts use compose profile cast-image "
                "with the nvidia overlay; see docs/DEPLOYMENT.md."
            )
        import torch
        from diffusers import Flux2KleinPipeline
        from PIL import Image  # noqa: F401  — ensure pillow is importable before gen

        log.info("loading %s (bfloat16, cpu offload for 16GB headroom)", model_id)
        pipe = Flux2KleinPipeline.from_pretrained(model_id, torch_dtype=torch.bfloat16)
        # Offload keeps peak under 16GB when sharing a card with Ollama headroom.
        if hasattr(pipe, "enable_model_cpu_offload"):
            pipe.enable_model_cpu_offload()
        else:
            pipe.to("cuda")
        _pipe = pipe
        _pipe_model = model_id
        log.info("model ready: %s", model_id)
        return _pipe


def _unload_pipe() -> None:
    global _pipe, _pipe_model
    with _lock:
        if _pipe is None:
            return
        log.info("unloading cast.image pipeline (VRAM handoff)")
        try:
            del _pipe
        except Exception:
            pass
        _pipe = None
        _pipe_model = None
        try:
            import torch
            import gc

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception as e:
            log.warning("cuda empty_cache failed: %s", e)


def _decode_refs(ref_images: list[Any]) -> list[Any]:
    from PIL import Image

    out: list[Any] = []
    for raw in ref_images[:MAX_REFS]:
        if not isinstance(raw, str) or not raw.strip():
            continue
        b64 = raw.strip()
        if "," in b64 and b64.lower().startswith("data:"):
            b64 = b64.split(",", 1)[1]
        try:
            data = base64.b64decode(b64)
            img = Image.open(io.BytesIO(data)).convert("RGB")
            out.append(img)
        except Exception as e:
            log.warning("skip bad ref image: %s", e)
    return out


def _generate(payload: dict[str, Any]) -> bytes:
    import torch

    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width = int(payload.get("width") or 1024)
    height = int(payload.get("height") or 1024)
    # Payload model is allowlisted the same as env (local#277).
    model_id = resolve_model(str(payload.get("model") or DEFAULT_MODEL))
    refs = _decode_refs(list(payload.get("ref_images") or []))

    pipe = _load_pipe(model_id)
    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "height": height,
        "width": width,
        "guidance_scale": DEFAULT_GUIDANCE,
        "num_inference_steps": DEFAULT_STEPS,
        "generator": torch.Generator(device="cpu").manual_seed(0),
    }
    # Multi-ref editing when the pipeline accepts image= (Klein family).
    if refs:
        try:
            kwargs["image"] = refs if len(refs) > 1 else refs[0]
            result = pipe(**kwargs)
        except TypeError:
            log.warning("pipeline rejected image=; falling back to text-to-image")
            kwargs.pop("image", None)
            result = pipe(**kwargs)
    else:
        result = pipe(**kwargs)

    image = result.images[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


async def health(_request: web.Request) -> web.Response:
    cuda = _cuda_available()
    return web.json_response(
        {
            "ok": True,
            "configured": cuda,
            "gpu": cuda,
            "cuda": cuda,
            "model": DEFAULT_MODEL,
            "loaded": _pipe is not None,
        }
    )


async def generate(request: web.Request) -> web.Response:
    denied = _require_auth(request)
    if denied:
        return denied
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)
    if not isinstance(payload, dict):
        return web.json_response({"error": "JSON object required"}, status=400)
    if not _cuda_available():
        return web.json_response(
            {
                "error": (
                    "cast.image local not configured: no CUDA GPU. "
                    "Build/run containers/cast-image on an NVIDIA host "
                    "(compose profile cast-image). Weights: " + DEFAULT_MODEL
                )
            },
            status=503,
        )
    # Refuse non-allowlisted model before touching CUDA / the event-loop offload.
    try:
        resolve_model(str((payload or {}).get("model") or DEFAULT_MODEL))
    except ValueError as e:
        return web.json_response({"error": str(e)[:500]}, status=400)
    try:
        # Heavy work off the event loop.
        png = await asyncio.to_thread(_generate, payload)
    except ValueError as e:
        # Allowlist refusal from _generate (defensive; pre-check above should catch it).
        return web.json_response({"error": str(e)[:500]}, status=400)
    except Exception as e:
        log.exception("generate failed")
        return web.json_response({"error": str(e)[:500]}, status=500)
    return web.json_response(
        {
            "image": base64.b64encode(png).decode("ascii"),
            "mime": "image/png",
            "model": DEFAULT_MODEL,
        }
    )


async def unload(request: web.Request) -> web.Response:
    denied = _require_auth(request)
    if denied:
        return denied
    await asyncio.to_thread(_unload_pipe)
    return web.json_response({"ok": True})


def main() -> None:
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_get("/health", health)
    app.router.add_post("/generate", generate)
    app.router.add_post("/unload", unload)
    log.info(
        "cast-image listening on :%s model=%s cuda=%s",
        PORT,
        DEFAULT_MODEL,
        _cuda_available(),
    )
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
