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

  it("if containers/cast-image exists, the sidecar must call the Apache allowlist", () => {
    // PR #272 lands the sidecar; this fence turns red if that path ships without the guard.
    const app = resolve(root, "containers/cast-image/app.py");
    if (!existsSync(app)) return;
    const src = readFileSync(app, "utf8");
    expect(src).toMatch(/FLUX\.2-klein-4B|SELF_HOST|allowlist|ALLOWED/);
    expect(src).not.toMatch(/from_pretrained\(\s*model_id\s*\)/);
    // Non-commercial siblings must not be loadable via env/payload alone.
    expect(src.toLowerCase()).not.toMatch(/klein-9b.*from_pretrained|from_pretrained.*klein-9b/);
  });
});
