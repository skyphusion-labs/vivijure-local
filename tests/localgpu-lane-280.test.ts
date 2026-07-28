// AN ABSENT MODULE IS ABSENT (local#280).
//
// local#229 deleted the GPU mock but replaced it with a container that booted just to answer
// `configured: false` about itself, kept alive because the compose healthcheck curled /module.json.
// Conrad rejected that: "We shouldn't have to build a shim for a module that isn't even there."
//
// So the fence here is not "the doorless module refuses politely" -- it is that with no door there is
// NO SERVICE IN THE STACK to refuse. The load-bearing assertions ask `docker compose config`, which is
// the real resolver (profiles, anchors, interpolation, depends_on) rather than a regex guess about what
// compose would do. It needs no daemon, only the compose CLI.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isDoorConfigured,
  localGpuLaneUpdates,
  LOCALGPU_MODULE_URL,
  LOCALGPU_PROFILE,
  parseProfiles,
  setProfile,
} from "../src/localgpu-lane.js";

const REPO = join(import.meta.dirname, "..");

/**
 * Services compose would actually start.
 *
 * `--env-file /dev/null` is deliberate: without it compose reads the developer's own .env, and a local
 * LOCAL_BACKEND_URL would decide the result instead of the fixture.
 */
function services(env: Record<string, string> = {}, profiles: string[] = []): string[] {
  const args = ["compose", "--env-file", "/dev/null"];
  for (const p of profiles) args.push("--profile", p);
  args.push("config", "--services");
  return execFileSync("docker", args, {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, LOCAL_BACKEND_URL: "", MODULE_LOCAL_GPU_URL: "", ...env },
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("no door: the local-gpu service is not in the stack at all", () => {
  it("`docker compose config` does not list it, or its gate", () => {
    const names = services();
    expect(names).not.toContain("module-local-gpu");
    expect(names).not.toContain("localgpu-door-gate");
  });

  it("the rest of the studio still comes up (this is not a broken stack)", () => {
    // Control for the assertion above: absent because it is gated, not because compose failed to
    // resolve the file and returned nothing.
    const names = services();
    expect(names).toContain("studio");
    expect(names).toContain("minio");
    expect(names).toContain("video-finish");
    expect(names.length).toBeGreaterThan(10);
  });

  it("the studio does NOT depend_on it, so a doorless box can boot", () => {
    // The reason the shim had to keep running: `studio` waited for module-local-gpu to be healthy.
    // A dependency on a service that may not exist is the assumption that forced the stand-in.
    const rendered = execFileSync(
      "docker",
      ["compose", "--env-file", "/dev/null", "config"],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, LOCAL_BACKEND_URL: "" } },
    );
    const studio = rendered.slice(rendered.indexOf("\n  studio:"));
    const dependsOn = studio.slice(studio.indexOf("depends_on:"), studio.indexOf("environment:"));
    expect(dependsOn).not.toContain("module-local-gpu");
    expect(dependsOn).toContain("video-finish"); // control: the block was actually found
  });

  it("binds no MODULE_LOCAL_GPU_URL, so the registry has no module to offer", () => {
    // The other half of "not installed": even with no container, a hardcoded binding would make the
    // studio advertise a module and 502 at submit. moduleUrlsFromEnv skips empty values.
    const rendered = execFileSync(
      "docker",
      ["compose", "--env-file", "/dev/null", "config"],
      { cwd: REPO, encoding: "utf8", env: { ...process.env, LOCAL_BACKEND_URL: "", MODULE_LOCAL_GPU_URL: "" } },
    );
    expect(rendered).not.toContain("http://module-local-gpu:9102");
  });
});

describe("door configured: the lane comes back, unchanged", () => {
  it("compose starts the module and its gate under the localgpu profile", () => {
    const names = services({ LOCAL_BACKEND_URL: "http://vivijure-local-16gb:8000" }, [LOCALGPU_PROFILE]);
    expect(names).toContain("module-local-gpu");
    expect(names).toContain("localgpu-door-gate");
  });

  it("the cloud profile is untouched by any of this", () => {
    // Regression guard on blast radius: the RunPod lane must gate exactly as it did before.
    const cloud = services({}, ["cloud"]);
    expect(cloud).toContain("module-keyframe");
    expect(cloud).toContain("module-own-gpu");
    expect(cloud).not.toContain("module-local-gpu");
    expect(services()).not.toContain("module-keyframe");
  });

  it("compose.yaml wires the door gate ahead of the module, fail-closed", () => {
    // Same idiom as edge-minio-creds-gate: the one inconsistency profiles cannot catch is "lane on,
    // door address blank", and that must stop the lane rather than start it pointing at nothing.
    const yaml = readFileSync(join(REPO, "compose.yaml"), "utf8");
    expect(yaml).toContain("localgpu-door-gate:");
    expect(yaml).toMatch(/localgpu-door-gate:\s*\n\s*condition: service_completed_successfully/);
    expect(yaml).toContain("REFUSING COMPOSE_PROFILES=localgpu with no LOCAL_BACKEND_URL.");
  });
});

describe("one operator knob derives the lane", () => {
  it("a door address turns the profile on and sets the module URL", () => {
    const updates = localGpuLaneUpdates(new Map([["LOCAL_BACKEND_URL", "http://vivijure-local-16gb:8000"]]));
    expect(updates.get("COMPOSE_PROFILES")).toBe(LOCALGPU_PROFILE);
    expect(updates.get("MODULE_LOCAL_GPU_URL")).toBe(LOCALGPU_MODULE_URL);
  });

  it("clearing the door address turns the lane back OFF", () => {
    // Both directions, or a stale profile leaves the door gate refusing the whole stack over a
    // variable the operator already removed.
    const updates = localGpuLaneUpdates(
      new Map([
        ["LOCAL_BACKEND_URL", ""],
        ["COMPOSE_PROFILES", "localgpu"],
        ["MODULE_LOCAL_GPU_URL", LOCALGPU_MODULE_URL],
      ]),
    );
    expect(updates.get("COMPOSE_PROFILES")).toBe("");
    expect(updates.get("MODULE_LOCAL_GPU_URL")).toBe("");
  });

  it("never clobbers the operator's other profiles", () => {
    expect(setProfile("edge,cloud", LOCALGPU_PROFILE, true)).toBe("edge,cloud,localgpu");
    expect(setProfile("edge,localgpu,cloud", LOCALGPU_PROFILE, false)).toBe("edge,cloud");
    expect(parseProfiles(" edge , , cloud ")).toEqual(["edge", "cloud"]);
  });

  it("is idempotent: a second run with the same door writes nothing", () => {
    const settled = new Map([
      ["LOCAL_BACKEND_URL", "http://vivijure-local-16gb:8000"],
      ["COMPOSE_PROFILES", LOCALGPU_PROFILE],
      ["MODULE_LOCAL_GPU_URL", LOCALGPU_MODULE_URL],
    ]);
    expect(localGpuLaneUpdates(settled).size).toBe(0);
  });

  it("a junk door address does NOT count as configured", () => {
    // Fail toward "no engine, and here is why" rather than enabling a lane that cannot work.
    expect(isDoorConfigured("vivijure-local-16gb:8000")).toBe(false); // no scheme
    expect(isDoorConfigured("   ")).toBe(false);
    expect(isDoorConfigured("ftp://door")).toBe(false);
    expect(isDoorConfigured(undefined)).toBe(false);
    expect(isDoorConfigured("https://door.lan:8000")).toBe(true);
  });
});
