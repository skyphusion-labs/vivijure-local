import { describe, expect, it } from "vitest";
import {
  finishBackendFromProcess,
  localFinishConfigured,
  localFinishUrlFor,
  normalizeFinishBaseUrl,
  resolveFinishBackend,
} from "../src/modules/finish-backend.js";

describe("finish-backend", () => {
  // local#229: the default FLIPPED from runpod to local. This is the self-hosted panel, and the old
  // default meant bringing the finish satellites up without setting FINISH_BACKEND dispatched
  // homelab finish jobs to a cloud provider the operator never opted into. Unconfigured `local`
  // refuses by name instead (see the local-finish handler tests).
  it("defaults to LOCAL when FINISH_BACKEND unset (RunPod is opt-in)", () => {
    expect(resolveFinishBackend("finish-lipsync", finishBackendFromProcess({}))).toBe("local");
    expect(resolveFinishBackend("finish-upscale", finishBackendFromProcess({}))).toBe("local");
  });

  it("honors an EXPLICIT FINISH_BACKEND=runpod (the opt-in still works)", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "runpod" });
    expect(resolveFinishBackend("finish-lipsync", env)).toBe("runpod");
    expect(resolveFinishBackend("finish-upscale", env)).toBe("runpod");
  });

  it("honors FINISH_BACKEND=local for lipsync/upscale", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "local" });
    expect(resolveFinishBackend("finish-lipsync", env)).toBe("local");
    expect(resolveFinishBackend("finish-upscale", env)).toBe("local");
  });

  it("finish-rife is always runpod (no local image)", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "local" });
    expect(resolveFinishBackend("finish-rife", env)).toBe("runpod");
  });

  it("per-module override wins over global", () => {
    const env = finishBackendFromProcess({
      FINISH_BACKEND: "local",
      FINISH_LIPSYNC_BACKEND: "runpod",
    });
    expect(resolveFinishBackend("finish-lipsync", env)).toBe("runpod");
    expect(resolveFinishBackend("finish-upscale", env)).toBe("local");
  });

  it("localFinishUrlFor normalizes trailing slash", () => {
    const env = finishBackendFromProcess({ LOCAL_FINISH_LIPSYNC_URL: "http://gpu:8080/" });
    expect(localFinishUrlFor("finish-lipsync", env)).toBe("http://gpu:8080");
  });

  it("localFinishUrlFor returns null for finish-rife (no local path)", () => {
    const env = finishBackendFromProcess({
      LOCAL_FINISH_LIPSYNC_URL: "http://gpu:8080",
      LOCAL_FINISH_RIFE_URL: "http://gpu:8010",
    } as NodeJS.ProcessEnv);
    expect(localFinishUrlFor("finish-rife", env)).toBeNull();
    expect(localFinishConfigured("finish-rife", env)).toBe(false);
  });

  it("localFinishConfigured is false when URL missing in local mode", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "local" });
    expect(localFinishConfigured("finish-upscale", env)).toBe(false);
  });

  it("normalizeFinishBaseUrl rejects non-http(s)", () => {
    expect(normalizeFinishBaseUrl("ftp://x")).toBeNull();
  });
});
