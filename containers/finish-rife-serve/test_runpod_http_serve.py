"""Unit tests for finish-rife HTTP serve hardening (stdlib unittest)."""
from __future__ import annotations

import os
import threading
import unittest
from typing import Callable

from runpod_http_serve import (
    JobRegistry,
    QueueFullError,
    load_expected_token,
    route,
    token_error,
    validate_run_payload,
    wrap_runpod_handler,
)


class TokenTests(unittest.TestCase):
    def test_token_error_rejects_missing_expected(self) -> None:
        err = token_error("secret", "")
        self.assertEqual(err, (503, {"ok": False, "error": "LOCAL_FINISH_TOKEN not configured: refusing open GPU endpoint"}))

    def test_token_error_rejects_bad_bearer(self) -> None:
        err = token_error("wrong", "secret")
        self.assertEqual(err[0], 401)

    def test_token_error_accepts_match(self) -> None:
        self.assertIsNone(token_error("secret", "secret"))

    def test_load_expected_token_requires_nonempty(self) -> None:
        key = "TEST_FINISH_TOKEN_MISSING"
        old = os.environ.pop(key, None)
        try:
            with self.assertRaises(SystemExit):
                load_expected_token(key)
        finally:
            if old is not None:
                os.environ[key] = old


class PayloadValidationTests(unittest.TestCase):
    def test_rejects_non_object(self) -> None:
        self.assertEqual(validate_run_payload([]), "payload must be a JSON object")

    def test_rejects_wrong_action(self) -> None:
        err = validate_run_payload({"action": "render", "shot_id": "s1", "clip_key": "renders/x.mp4"})
        self.assertIn("unsupported action", err or "")

    def test_rejects_path_traversal(self) -> None:
        err = validate_run_payload(
            {"action": "finish_clip", "shot_id": "s1", "clip_key": "renders/../secret.mp4"},
        )
        self.assertIsNotNone(err)

    def test_rejects_url_clip_key(self) -> None:
        err = validate_run_payload(
            {"action": "finish_clip", "shot_id": "s1", "clip_key": "http://evil/x.mp4"},
        )
        self.assertIsNotNone(err)

    def test_accepts_finish_clip(self) -> None:
        self.assertIsNone(
            validate_run_payload(
                {
                    "action": "finish_clip",
                    "project": "demo",
                    "shot_id": "shot-1",
                    "clip_key": "renders/demo/shot-1/finished.mp4",
                    "config": {"interpolate": True},
                },
            ),
        )

    def test_accepts_selftest(self) -> None:
        self.assertIsNone(validate_run_payload({"selftest": True}))


class RouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

        def blocking_run(_payload: dict, _should_cancel: Callable[[], bool]) -> dict:
            self.started.set()
            self.release.wait(timeout=5)
            return {"ok": True}

        self.registry = JobRegistry(blocking_run, max_queue=1)
        self.token = "test-token"

    def tearDown(self) -> None:
        self.release.set()

    def test_health_requires_auth(self) -> None:
        status, body = route("GET", "/health", None, registry=self.registry, token=None, expected_token=self.token, service="svc")
        self.assertEqual(status, 401)
        status, body = route("GET", "/health", None, registry=self.registry, token=self.token, expected_token=self.token, service="svc")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})

    def test_selftest_requires_auth(self) -> None:
        status, _ = route(
            "POST",
            "/run",
            {"selftest": True},
            registry=self.registry,
            token=None,
            expected_token=self.token,
            service="svc",
        )
        self.assertEqual(status, 401)

    def test_run_rejects_invalid_payload(self) -> None:
        status, body = route(
            "POST",
            "/run",
            {"input": {"action": "render"}},
            registry=self.registry,
            token=self.token,
            expected_token=self.token,
            service="svc",
        )
        self.assertEqual(status, 400)
        self.assertIn("unsupported action", body.get("error", ""))

    def test_queue_full_returns_429(self) -> None:
        payload = {
            "action": "finish_clip",
            "shot_id": "s1",
            "clip_key": "renders/demo/s1/finished.mp4",
        }
        route("POST", "/run", {"input": payload}, registry=self.registry, token=self.token, expected_token=self.token, service="svc")
        self.started.wait(timeout=1)
        status, body = route(
            "POST",
            "/run",
            {"input": payload},
            registry=self.registry,
            token=self.token,
            expected_token=self.token,
            service="svc",
        )
        self.assertEqual(status, 429)
        self.assertEqual(body.get("error"), "queue full")


class RegistryTests(unittest.TestCase):
    def test_submit_raises_when_queue_full(self) -> None:
        started = threading.Event()
        release = threading.Event()

        def blocking_run(_payload: dict, _should_cancel: Callable[[], bool]) -> dict:
            started.set()
            release.wait(timeout=5)
            return {"ok": True}

        registry = JobRegistry(blocking_run, max_queue=1)
        registry.submit({"action": "finish_clip"})
        started.wait(timeout=1)
        with self.assertRaises(QueueFullError):
            registry.submit({"action": "finish_clip"})
        release.set()


if __name__ == "__main__":
    unittest.main()
