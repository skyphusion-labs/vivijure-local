"""RunPod-compatible job API over stdlib HTTP for homelab LOCAL_FINISH_* services.

Sidecars POST /run {"input": {...}} -> {"id"} and poll GET /status/<id> with the same envelope
RunPod serverless uses (IN_QUEUE / IN_PROGRESS / COMPLETED / FAILED). Stdlib only.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import signal
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

MAX_BODY_BYTES = 10 * 1024 * 1024
MAX_QUEUE = 32
_CLIP_KEY_PREFIX = "renders/"


class JobStatus(str, Enum):
    IN_QUEUE = "IN_QUEUE"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Cancelled(Exception):
    pass


class QueueFullError(Exception):
    pass


@dataclass
class Job:
    id: str
    payload: dict
    status: JobStatus = JobStatus.IN_QUEUE
    output: dict | None = None
    error: str | None = None
    _cancel: bool = field(default=False, repr=False)

    def status_dict(self) -> dict:
        d: dict = {"id": self.id, "status": self.status.value}
        if self.status is JobStatus.COMPLETED and self.output is not None:
            d["output"] = self.output
        if self.status is JobStatus.FAILED and self.error is not None:
            d["error"] = self.error
        return d


RunFn = Callable[[dict, Callable[[], bool]], dict]


class JobRegistry:
    def __init__(
        self,
        run_fn: RunFn,
        *,
        max_completed: int = 256,
        max_queue: int = MAX_QUEUE,
    ) -> None:
        self._run_fn = run_fn
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._queue: deque[str] = deque()
        self._completed_order: deque[str] = deque()
        self._max_completed = max_completed
        self._max_queue = max_queue
        self._worker: threading.Thread | None = None
        self._wake = threading.Condition(self._lock)
        self._stop = False

    def submit(self, payload: dict) -> str:
        with self._lock:
            active = sum(
                1
                for job in self._jobs.values()
                if job.status in (JobStatus.IN_QUEUE, JobStatus.IN_PROGRESS)
            )
            if active >= self._max_queue:
                raise QueueFullError()
            job = Job(id=uuid.uuid4().hex, payload=payload)
            self._jobs[job.id] = job
            self._queue.append(job.id)
            self._ensure_worker_locked()
            self._wake.notify()
        return job.id

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return True
            if job.status is JobStatus.IN_QUEUE:
                try:
                    self._queue.remove(job_id)
                except ValueError:
                    # Expected race: the worker dequeued this job before cancel ran.
                    pass
                job.status = JobStatus.FAILED
                job.error = "canceled before start"
                self._retain_locked(job_id)
                return True
            if job.status is JobStatus.IN_PROGRESS:
                job._cancel = True
            return True

    def _ensure_worker_locked(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._run_loop, name="finish-serve-jobs", daemon=True)
            self._worker.start()

    def _run_loop(self) -> None:
        while True:
            with self._lock:
                while not self._queue and not self._stop:
                    self._wake.wait()
                if self._stop and not self._queue:
                    return
                job_id = self._queue.popleft()
                job = self._jobs.get(job_id)
                if job is None or job.status is not JobStatus.IN_QUEUE:
                    continue
                if job._cancel:
                    job.status = JobStatus.FAILED
                    job.error = "canceled before start"
                    self._retain_locked(job_id)
                    continue
                job.status = JobStatus.IN_PROGRESS
            try:
                output = self._run_fn(job.payload, lambda: self._is_cancelled(job_id))
                with self._lock:
                    job.output = output
                    job.status = JobStatus.COMPLETED
                    self._retain_locked(job_id)
            except Cancelled:
                with self._lock:
                    job.status = JobStatus.FAILED
                    job.error = "canceled"
                    self._retain_locked(job_id)
            except Exception as e:  # noqa: BLE001
                with self._lock:
                    job.status = JobStatus.FAILED
                    job.error = str(e)[:500]
                    self._retain_locked(job_id)

    def _is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            return bool(job and job._cancel)

    def _retain_locked(self, job_id: str) -> None:
        self._completed_order.append(job_id)
        while len(self._completed_order) > self._max_completed:
            old = self._completed_order.popleft()
            self._jobs.pop(old, None)

    def shutdown(self) -> None:
        with self._lock:
            self._stop = True
            self._wake.notify_all()


_STATUS_RE = re.compile(r"^/status/([A-Za-z0-9]+)$")
_CANCEL_RE = re.compile(r"^/cancel/([A-Za-z0-9]+)$")


def load_expected_token(token_env: str) -> str:
    token = (os.environ.get(token_env) or "").strip()
    if not token:
        print(f"FATAL: {token_env} must be set to a non-empty secret", flush=True)
        raise SystemExit(1)
    return token


def token_error(headers_token: str | None, expected: str) -> tuple[int, dict] | None:
    if not expected.strip():
        return 503, {"ok": False, "error": "LOCAL_FINISH_TOKEN not configured: refusing open GPU endpoint"}
    provided = (headers_token or "").strip()
    if not provided or not hmac.compare_digest(provided, expected):
        return 401, {"ok": False, "error": "unauthorized"}
    return None


def _check_r2_key(key: str, *, prefix: str, what: str) -> str | None:
    k = str(key or "")
    if (
        not k
        or k != k.strip()
        or k.startswith("/")
        or "\\" in k
        or ".." in k.split("/")
        or not k.startswith(prefix)
    ):
        return f"{what}: clip_key must be a relative renders/ key"
    return None


def _looks_like_url(value: object) -> bool:
    return isinstance(value, str) and ("://" in value or value.startswith("file:"))


def validate_run_payload(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return "payload must be a JSON object"
    if payload.get("selftest") is True:
        return None
    if payload.get("action") != "finish_clip":
        return "unsupported action (finish-rife serve accepts finish_clip only)"
    err = _check_r2_key(str(payload.get("clip_key") or ""), prefix=_CLIP_KEY_PREFIX, what="finish_clip")
    if err:
        return err
    shot_id = payload.get("shot_id")
    if not isinstance(shot_id, str) or not shot_id.strip():
        return "finish_clip: shot_id is required"
    cfg = payload.get("config")
    if cfg is not None and not isinstance(cfg, dict):
        return "finish_clip: config must be an object"
    for field in ("clip_key", "project", "shot_id", "output_hash"):
        if _looks_like_url(payload.get(field)):
            return f"finish_clip: {field} must not be a URL"
    return None


def route(
    method: str,
    path: str,
    body: dict | None,
    *,
    registry: JobRegistry,
    token: str | None,
    expected_token: str,
    service: str,
    version: str = "serve-1",
) -> tuple[int, dict]:
    if method == "GET" and path == "/health":
        err = token_error(token, expected_token)
        if err:
            return err
        return 200, {"ok": True}

    if method == "POST" and path == "/run":
        err = token_error(token, expected_token)
        if err:
            return err
        payload = (body or {}).get("input", body or {})
        if not isinstance(payload, dict):
            return 400, {"ok": False, "error": "payload must be a JSON object"}
        if (body or {}).get("selftest") is True or payload.get("selftest") is True:
            return 200, {"ok": True, "selftest": True}
        validation_err = validate_run_payload(payload)
        if validation_err:
            return 400, {"ok": False, "error": validation_err}
        try:
            job_id = registry.submit(payload)
        except QueueFullError:
            return 429, {"ok": False, "error": "queue full"}
        return 200, {"id": job_id}

    m = _STATUS_RE.match(path)
    if method == "GET" and m:
        err = token_error(token, expected_token)
        if err:
            return err
        job = registry.get(m.group(1))
        if job is None:
            return 404, {"status": 404, "title": "Not Found", "detail": "job not found"}
        return 200, job.status_dict()

    m = _CANCEL_RE.match(path)
    if method == "POST" and m:
        err = token_error(token, expected_token)
        if err:
            return err
        registry.cancel(m.group(1))
        return 200, {"ok": True}

    return 404, {"status": 404, "title": "Not Found", "detail": "no such route"}


def wrap_runpod_handler(handler_fn: Callable[[dict], dict]) -> RunFn:
    """Adapt a RunPod handler(job) to the registry run_fn(payload, should_cancel)."""

    def run(payload: dict, should_cancel: Callable[[], bool]) -> dict:
        if should_cancel():
            raise Cancelled()
        job = {"input": payload}
        result = handler_fn(job)
        if not isinstance(result, dict):
            raise RuntimeError(f"handler returned non-dict: {type(result).__name__}")
        if result.get("error"):
            raise RuntimeError(str(result["error"])[:500])
        return result

    return run


def run_serve(
    handler_fn: Callable[[dict], dict],
    *,
    service: str,
    host: str | None = None,
    port: int | None = None,
    token_env: str = "LOCAL_FINISH_TOKEN",
    version: str = "serve-1",
) -> None:
    host = host or os.environ.get("HOST", "0.0.0.0")
    port = int(port or os.environ.get("PORT", "8010") or "8010")
    expected_token = load_expected_token(token_env)
    registry = JobRegistry(wrap_runpod_handler(handler_fn))

    class Handler(BaseHTTPRequestHandler):
        def _bearer(self) -> str | None:
            h = self.headers.get("authorization") or ""
            return h[7:] if h.lower().startswith("bearer ") else None

        def _body(self) -> dict | None:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0:
                return None
            if length > MAX_BODY_BYTES:
                raise ValueError("body too large")
            try:
                return json.loads(self.rfile.read(length) or b"{}")
            except Exception:
                return None

        def _dispatch(self, method: str) -> None:
            try:
                body = self._body() if method == "POST" else None
            except ValueError:
                status, payload = 413, {"ok": False, "error": "request body too large"}
            else:
                status, payload = route(
                    method,
                    self.path,
                    body,
                    registry=registry,
                    token=self._bearer(),
                    expected_token=expected_token,
                    service=service,
                    version=version,
                )
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

        def log_message(self, *args) -> None:
            pass

    httpd = ThreadingHTTPServer((host, port), Handler)

    def _graceful(_signum, _frame):
        registry.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _graceful)

    print(f"{service} LOCAL_FINISH HTTP on {host}:{port}", flush=True)
    try:
        httpd.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        # Expected shutdown signals; cleanup runs in finally.
        pass
    finally:
        httpd.server_close()
        registry.shutdown()
