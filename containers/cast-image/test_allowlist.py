"""Stdlib tests for the cast-image allowlist. No torch, no pytest.

CI runs: python3 containers/cast-image/test_allowlist.py

The named non-commercial branch and the generic catch-all are separate
assertions. An id that misses the named list must still be refused, and the
message must be the generic one so a green result cannot be the other branch.
"""
from __future__ import annotations

import os
import unittest
from unittest import mock

from model_allowlist import (
    ALLOWED_REVISIONS,
    DEFAULT_HF_MODEL,
    env_default_model,
    pretrained_kwargs,
    refuse_model,
    resolve_model,
    revision_for,
)

PIN = "e7b7dc27f91deacad38e78976d1f2b499d76a294"


class AllowlistTests(unittest.TestCase):
    def test_accepts_klein_4b_including_whitespace(self) -> None:
        self.assertIsNone(refuse_model(DEFAULT_HF_MODEL))
        self.assertIsNone(refuse_model(f"  {DEFAULT_HF_MODEL}  "))
        self.assertEqual(resolve_model(None), DEFAULT_HF_MODEL)
        self.assertEqual(resolve_model(f"  {DEFAULT_HF_MODEL}  "), DEFAULT_HF_MODEL)

    def test_named_noncommercial_branch(self) -> None:
        for bad in (
            "black-forest-labs/FLUX.2-klein-9B",
            "black-forest-labs/FLUX.2-dev",
            "black-forest-labs/flux-2-klein-9b",
            "some-org/flux-2-dev-finetune",
        ):
            msg = refuse_model(bad)
            self.assertIsNotNone(msg, bad)
            assert msg is not None
            self.assertIn("Non-Commercial", msg)
            with self.assertRaises(ValueError):
                resolve_model(bad)

    def test_catch_all_refuses_ids_the_named_list_misses(self) -> None:
        # FLUX2-klein-9B does not contain "flux-2-klein-9b" or "flux.2-klein-9b".
        for bad in (
            "FLUX2-klein-9B",
            "stabilityai/stable-diffusion-xl-base-1.0",
            "org/not-a-model",
        ):
            msg = refuse_model(bad)
            self.assertIsNotNone(msg, bad)
            assert msg is not None
            self.assertIn("not on the Apache-only allowlist", msg)
            self.assertNotIn("Non-Commercial", msg)
            with self.assertRaises(ValueError):
                resolve_model(bad)

    def test_empty_id_is_refused(self) -> None:
        msg = refuse_model("   ")
        self.assertIsNotNone(msg)
        assert msg is not None
        self.assertIn("empty model id", msg)

    def test_revision_pin(self) -> None:
        self.assertEqual(ALLOWED_REVISIONS[DEFAULT_HF_MODEL], PIN)
        self.assertEqual(revision_for(DEFAULT_HF_MODEL), PIN)
        self.assertEqual(pretrained_kwargs(f"  {DEFAULT_HF_MODEL}  "), {"revision": PIN})
        with self.assertRaises(ValueError):
            revision_for("org/not-a-model")
        with self.assertRaises(ValueError):
            pretrained_kwargs("FLUX2-klein-9B")

    def test_env_override_is_refused_at_read(self) -> None:
        with mock.patch.dict(os.environ, {"CAST_IMAGE_MODEL": "org/not-a-model"}):
            with self.assertRaises(ValueError):
                env_default_model()
        env = os.environ.copy()
        env.pop("CAST_IMAGE_MODEL", None)
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(env_default_model(), DEFAULT_HF_MODEL)


if __name__ == "__main__":
    unittest.main()
