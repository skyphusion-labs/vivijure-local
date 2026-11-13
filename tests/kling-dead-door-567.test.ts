// local#567: the `kling` motion door dispatched to RunPod public endpoint `kling-v2-1-i2v-pro`,
// which returns 404 "endpoint not found" (measured 2026-11-13; vivijure-cf removed its copy for the
// same reason in vivijure-cf#921). Every render routed to it failed at submit. These assertions keep
// the dead door from coming back through any of the paths that used to ship it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXED_MOTION } from "../src/modules/runpod/fixed-motion.js";
import { isRunpodModuleName, RUNPOD_MODULE_NAMES } from "../src/modules/runpod/handlers.js";
import { PLATFORM_SECRET_FIELDS } from "../src/platform-secrets-catalog.js";

const DEAD_SLUG = "kling-v2-1-i2v-pro";

describe("local#567 dead kling door stays removed", () => {
  it("is not a RunPod module name", () => {
    expect(RUNPOD_MODULE_NAMES).not.toContain("kling");
    expect(isRunpodModuleName("kling")).toBe(false);
  });

  it("has no fixed-motion entry, and no entry dispatches to the dead slug", () => {
    expect(Object.keys(FIXED_MOTION)).not.toContain("kling");
    for (const [name, cfg] of Object.entries(FIXED_MOTION)) {
      expect(cfg.endpoint, name).not.toContain(DEAD_SLUG);
    }
  });

  it("has no platform secrets catalog row", () => {
    expect(PLATFORM_SECRET_FIELDS.map((f) => f.key)).not.toContain("MODULE_KLING_URL");
  });

  it("has no compose service, compose env or .env.example entry", () => {
    const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
    expect(compose).not.toMatch(/module-kling:/);
    expect(compose).not.toMatch(/MODULE_KLING_URL/);
    const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    expect(envExample).not.toMatch(/MODULE_KLING_URL/);
  });
});
