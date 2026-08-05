// local#277: FLUX non-commercial weights must not be self-hosted; CF BFL channel stays default.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOUD_CAST_MODELS,
  DEFAULT_CLOUD_CAST_MODEL,
  DEFAULT_SELF_HOST_HF_MODEL,
  SELF_HOST_ALLOWED_HF_MODELS,
  isCloudCastModel,
  looksLikeSelfHostModelId,
  refuseSelfHostModel,
  resolveSelfHostModel,
} from "../src/modules/chain/cast-image-model-policy.js";
import { DEFAULT_CAST_MODEL, MODELS } from "../src/modules/chain/cast-image-core.js";

const root = resolve(import.meta.dirname, "..");

describe("cast.image model policy (local#277)", () => {
  it("cloud default is CF BFL klein-9b (not a HF self-host id)", () => {
    expect(DEFAULT_CLOUD_CAST_MODEL).toBe("@cf/black-forest-labs/flux-2-klein-9b");
    expect(DEFAULT_CAST_MODEL).toBe(DEFAULT_CLOUD_CAST_MODEL);
    expect(MODELS[0]).toBe(DEFAULT_CLOUD_CAST_MODEL);
    expect(MODELS).toEqual(CLOUD_CAST_MODELS);
    expect(looksLikeSelfHostModelId(DEFAULT_CLOUD_CAST_MODEL)).toBe(false);
  });

  it("manifest fixture default stays on the CF channel (byte-synced with cf)", () => {
    const m = JSON.parse(
      readFileSync(resolve(root, "dev/manifests/cast-image.json"), "utf8"),
    ) as { config_schema: { model: { default: string; values: string[] } } };
    expect(m.config_schema.model.default).toBe("@cf/black-forest-labs/flux-2-klein-9b");
    expect(m.config_schema.model.values[0]).toBe("@cf/black-forest-labs/flux-2-klein-9b");
    expect(m.config_schema.model.values.every((v) => !looksLikeSelfHostModelId(v))).toBe(true);
  });

  it("self-host allowlist is Apache Klein 4B only", () => {
    expect(SELF_HOST_ALLOWED_HF_MODELS).toEqual(["black-forest-labs/FLUX.2-klein-4B"]);
    expect(DEFAULT_SELF_HOST_HF_MODEL).toBe("black-forest-labs/FLUX.2-klein-4B");
    expect(refuseSelfHostModel(DEFAULT_SELF_HOST_HF_MODEL)).toBeNull();
    expect(resolveSelfHostModel(undefined)).toBe(DEFAULT_SELF_HOST_HF_MODEL);
    expect(resolveSelfHostModel(DEFAULT_SELF_HOST_HF_MODEL)).toBe(DEFAULT_SELF_HOST_HF_MODEL);
  });

  it("refuses non-commercial FLUX self-host ids with a diagnostic message", () => {
    for (const bad of [
      "black-forest-labs/FLUX.2-klein-9B",
      "black-forest-labs/FLUX.2-dev",
      "black-forest-labs/flux-2-klein-9b",
      "some-org/flux-2-dev-finetune",
    ]) {
      const msg = refuseSelfHostModel(bad);
      expect(msg, bad).toBeTruthy();
      expect(msg!, bad).toMatch(/Non-Commercial|not on the Apache-only allowlist|local#277/i);
      expect(() => resolveSelfHostModel(bad)).toThrow(/cast\.image self-host/);
    }
  });

  it("refuses arbitrary HF ids not on the allowlist", () => {
    const msg = refuseSelfHostModel("stabilityai/stable-diffusion-xl-base-1.0");
    expect(msg).toMatch(/not on the Apache-only allowlist/);
    expect(refuseSelfHostModel("")).toMatch(/empty model id/);
  });

  it("cloud catalog membership helper", () => {
    expect(isCloudCastModel("@cf/black-forest-labs/flux-2-klein-9b")).toBe(true);
    expect(isCloudCastModel("google/nano-banana-pro")).toBe(true);
    expect(isCloudCastModel("black-forest-labs/FLUX.2-klein-4B")).toBe(false);
  });

  it("THIRD_PARTY_MODELS.md records the FLUX commercial rule", () => {
    const doc = readFileSync(resolve(root, "THIRD_PARTY_MODELS.md"), "utf8");
    expect(doc).toMatch(/FLUX Non-Commercial|flux-non-commercial/i);
    expect(doc).toMatch(/@cf\/black-forest-labs\/flux-2-klein-9b/);
    expect(doc).toMatch(/FLUX\.2-klein-4B/);
    expect(doc).toMatch(/cast-image-model-policy/);
    expect(doc).toMatch(/local#277/);
  });

  // Fence for the local cast.image sidecar when present (PR #272 / #361).
  // When the path is ABSENT this suite must SKIP, not pass: a vacuous green fence
  // retires the worry without retiring the risk (joan-prreview-local on #359).
  // When PRESENT it must refuse free-variable model load and name a closed allowlist
  // that agrees with SELF_HOST_ALLOWED_HF_MODELS in this package.
  const sidecarApp = resolve(root, "containers/cast-image/app.py");
  const sidecarAllowlist = resolve(root, "containers/cast-image/model_allowlist.py");
  const hasSidecar = existsSync(sidecarApp);

  it.skipIf(!hasSidecar)(
    "sidecar enforces a closed Apache allowlist before from_pretrained",
    () => {
      const src = readFileSync(sidecarApp, "utf8");
      // #272 defect shape: env default + from_pretrained(model_id, ...) with NO allowlist module.
      // Requiring ALLOWED_HF_MODELS / model_allowlist import is what actually fails that tree.
      expect(src).toMatch(/ALLOWED_HF_MODELS|model_allowlist|refuse_model|resolve_model/);
      // Non-commercial sibling must not be a default or hard-coded load target here.
      expect(src).not.toMatch(/FLUX\.2-klein-9B|flux-2-klein-9b/i);
      // Free-variable load is fine ONLY after resolve_model/refuse; ban the #272 raw-env pattern:
      // CAST_IMAGE_MODEL default wired straight into from_pretrained without a guard symbol nearby.
      if (!/resolve_model|refuse_model|ALLOWED_HF_MODELS/.test(src)) {
        expect(src).not.toMatch(/from_pretrained\(\s*model_id\b/);
      }
    },
  );

  it.skipIf(!hasSidecar)(
    "sidecar ALLOWED_HF_MODELS agrees with TS SELF_HOST_ALLOWED_HF_MODELS",
    () => {
      // Prefer the dedicated allowlist module (#361); fall back to scanning app.py.
      // Doc comments may mention non-commercial siblings -- only the set membership matters.
      const py = existsSync(sidecarAllowlist)
        ? readFileSync(sidecarAllowlist, "utf8")
        : readFileSync(sidecarApp, "utf8");
      for (const id of SELF_HOST_ALLOWED_HF_MODELS) {
        expect(py, `python side missing ${id}`).toContain(id);
      }
      // Quoted members of ALLOWED_HF_MODELS / equivalent must not include non-commercial FLUX.
      const setBody = py.match(/ALLOWED_HF_MODELS[\s\S]{0,400}?\{([\s\S]*?)\}/)?.[1] ?? "";
      expect(setBody.length, "could not find ALLOWED_HF_MODELS set body").toBeGreaterThan(0);
      expect(setBody).not.toMatch(/klein-9B|flux-2-dev|FLUX\.2-dev/i);
      for (const id of SELF_HOST_ALLOWED_HF_MODELS) {
        expect(setBody).toContain(id);
      }
    },
  );
});
