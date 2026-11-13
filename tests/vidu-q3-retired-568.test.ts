// local#568: the RunPod `vidu-q3` door is retired in the SAME change that lands its hosted
// replacement, `cf-vidu-q3-turbo` (no window with neither door). These hold both halves.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXED_MOTION } from "../src/modules/runpod/fixed-motion.js";
import { isRunpodModuleName, RUNPOD_MODULE_NAMES } from "../src/modules/runpod/handlers.js";
import { PLATFORM_SECRET_FIELDS } from "../src/platform-secrets-catalog.js";
import { gatewayI2vDoor } from "../src/modules/gateway-i2v/doors/index.js";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("local#568: vidu-q3 (RunPod) is retired", () => {
  it("is not a RunPod module and has no fixed-motion entry", () => {
    expect(RUNPOD_MODULE_NAMES).not.toContain("vidu-q3");
    expect(isRunpodModuleName("vidu-q3")).toBe(false);
    expect(Object.keys(FIXED_MOTION)).not.toContain("vidu-q3");
    for (const cfg of Object.values(FIXED_MOTION)) expect(cfg.endpoint).not.toContain("vidu-q3-i2v");
  });
  it("has no catalog row, compose service, env entry or fixture", () => {
    const keys = PLATFORM_SECRET_FIELDS.map((f) => f.key);
    expect(keys).not.toContain("MODULE_VIDU_Q3_URL");
    expect(read("compose.yaml")).not.toMatch(/module-vidu-q3:|MODULE_VIDU_Q3_URL/);
    expect(read(".env.example")).not.toMatch(/MODULE_VIDU_Q3_URL/);
    expect(existsSync(join(ROOT, "dev", "manifests", "vidu-q3.json"))).toBe(false);
  });
});

describe("local#568: cf-vidu-q3-turbo (AI Gateway) replaces it", () => {
  it("is a served gateway door with a synced manifest", () => {
    expect(gatewayI2vDoor("cf-vidu-q3-turbo")?.model).toBe("vidu/q3-turbo");
    const m = JSON.parse(read("dev/manifests/cf-vidu-q3-turbo.json")) as { name: string; hooks: string[]; _local_divergence?: unknown };
    expect(m.name).toBe("cf-vidu-q3-turbo");
    expect(m.hooks).toEqual(["motion.backend"]);
    expect(m._local_divergence).toBeUndefined();
    expect(read("scripts/sync-module-manifests.ts")).toMatch(/"cf-vidu-q3-turbo"/);
  });
  it("is wired: compose service on 9160, studio env, catalog row, .env.example", () => {
    const compose = read("compose.yaml");
    expect(compose).toMatch(/module-cf-vidu-q3-turbo:[\s\S]*?gateway-i2v-module-server\.ts", "9160", "cf-vidu-q3-turbo"/);
    expect(compose).toMatch(/MODULE_CF_VIDU_Q3_TURBO_URL: \$\{MODULE_CF_VIDU_Q3_TURBO_URL:-\}/);
    expect(PLATFORM_SECRET_FIELDS.map((f) => f.key)).toContain("MODULE_CF_VIDU_Q3_TURBO_URL");
    expect(read(".env.example")).toMatch(/# MODULE_CF_VIDU_Q3_TURBO_URL=http:\/\/127\.0\.0\.1:9160/);
  });
  it("did not take a freed port (9151 kling, 9154 vidu-q3)", () => {
    expect(read("compose.yaml")).not.toMatch(/"915[14]"/);
  });
  it("is the panel default cloud model when none is offered", () => {
    expect(read("public/planner-history-row.js")).toMatch(/\|\| "cf-vidu-q3-turbo",/);
    expect(read("public/planner-history-row.js")).not.toMatch(/\|\| "seedance",/);
  });
});
