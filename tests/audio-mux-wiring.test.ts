import { describe, expect, it } from "vitest";
import {
  orchestratorContextFromPlatform,
  type ObjectPresigner,
  type Platform,
} from "@skyphusion-labs/vivijure-core/platform";
import { buildVpcHostBindings } from "../src/platform/vpc-transport.js";
import { openDatabase } from "../src/platform/sqlite.js";
import { createModuleTransport } from "../src/platform/modules.js";
import { FilesystemObjectStore } from "../src/platform/storage.js";
import { RuntimeSecretStore } from "../src/platform/runtime-secrets.js";
import { RuntimeEnv } from "../src/platform/runtime-env.js";

function mockPlatform(env: NodeJS.ProcessEnv): Platform {
  const runtime = RuntimeEnv.forTests(
    Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v])),
  );
  const db = openDatabase(":memory:");
  const renders = new FilesystemObjectStore("/tmp/vivijure-test-renders");
  return {
    db,
    renders,
    chatBucket: renders,
    presigner: {} as ObjectPresigner,
    secrets: new RuntimeSecretStore(runtime),
    modules: createModuleTransport(env),
    vars: {},
    hostBindings: buildVpcHostBindings(env),
  };
}

describe("audio / mux VPC wiring (homelab compose parity)", () => {
  const composeCpuEnv: NodeJS.ProcessEnv = {
    VIDEO_FINISH_URL: "http://video-finish:8000",
    AUDIO_BEAT_SYNC_URL: "http://audio-beat-sync:8000",
    AUDIO_MIX_URL: "http://audio-mix:8000",
    AUDIO_MASTER_URL: "http://audio-master:8000",
    MODULE_AUDIO_MASTER_URL: "http://module-audio-master:9121",
    MODULE_BEAT_SYNC_URL: "http://module-beat-sync:9120",
    MODULE_MUSIC_GEN_URL: "http://module-music-gen:9158",
  };

  it("studio orchestrator env exposes all CPU VPC bindings for assemble/master/mux", () => {
    const oenv = orchestratorContextFromPlatform(mockPlatform(composeCpuEnv));
    expect(oenv.VIDEO_FINISH_VPC).toBeDefined();
    expect(oenv.AUDIO_BEAT_SYNC_VPC).toBeDefined();
    expect(oenv.AUDIO_MIX_VPC).toBeDefined();
    expect(oenv.AUDIO_MASTER_VPC).toBeDefined();
  });

  it("module transport resolves audio-master and beat-sync sidecars", () => {
    const platform = mockPlatform(composeCpuEnv);
    expect(platform.modules.resolve("MODULE_AUDIO_MASTER")).toBeDefined();
    expect(platform.modules.resolve("MODULE_BEAT_SYNC")).toBeDefined();
    expect(platform.modules.resolve("MODULE_MUSIC_GEN")).toBeDefined();
  });
});
