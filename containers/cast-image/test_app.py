"""CPU-only unit tests for cast-image sidecar (no CUDA / no model download).

Run (optional, not part of npm test):
  cd containers/cast-image && pip install aiohttp pillow && python -m pytest test_app.py -q
"""
from __future__ import annotations

import base64
import io
import json
from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image

import app as cast_app


def _tiny_png_b64() -> str:
    img = Image.new("RGB", (8, 8), color=(20, 40, 60))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _make_app() -> web.Application:
    application = web.Application(client_max_size=8 * 1024 * 1024)
    application.router.add_get("/health", cast_app.health)
    application.router.add_post("/generate", cast_app.generate)
    application.router.add_post("/unload", cast_app.unload)
    return application


@pytest.fixture
async def client():
    server = TestServer(_make_app())
    client = TestClient(server)
    await client.start_server()
    yield client
    await client.close()


@pytest.mark.asyncio
async def test_health_reports_configured_false_without_cuda(client):
    with mock.patch.object(cast_app, "_cuda_available", return_value=False):
        resp = await client.get("/health")
        assert resp.status == 200
        body = await resp.json()
        assert body["ok"] is True
        assert body["configured"] is False
        assert body["cuda"] is False


@pytest.mark.asyncio
async def test_generate_503_without_cuda(client):
    with mock.patch.object(cast_app, "_cuda_available", return_value=False):
        resp = await client.post(
            "/generate",
            data=json.dumps({"prompt": "a portrait"}),
            headers={"content-type": "application/json"},
        )
        assert resp.status == 503
        body = await resp.json()
        assert "no CUDA" in body["error"]


@pytest.mark.asyncio
async def test_generate_with_mock_pipeline(client):
    png = base64.b64decode(_tiny_png_b64())

    def fake_generate(payload):
        assert payload["prompt"] == "close-up portrait"
        return png

    with mock.patch.object(cast_app, "_cuda_available", return_value=True), mock.patch.object(
        cast_app, "_generate", side_effect=fake_generate
    ):
        resp = await client.post(
            "/generate",
            data=json.dumps(
                {
                    "prompt": "close-up portrait",
                    "ref_images": [_tiny_png_b64()],
                }
            ),
            headers={"content-type": "application/json"},
        )
        assert resp.status == 200
        body = await resp.json()
        assert body["mime"] == "image/png"
        assert body["image"]


@pytest.mark.asyncio
async def test_unload_ok(client):
    with mock.patch.object(cast_app, "_unload_pipe") as unload:
        resp = await client.post("/unload")
        assert resp.status == 200
        unload.assert_called_once()
