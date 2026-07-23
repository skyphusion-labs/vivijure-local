import { describe, expect, it } from "vitest";
import {
  finishBackendFromProcess,
  localFinishConfigured,
  localFinishUrlFor,
  normalizeFinishBaseUrl,
  resolveFinishBackend,
} from "../src/modules/finish-backend.js";

describe("finish-backend", () => {
  it("defaults to runpod when FINISH_BACKEND unset", () => {
    expect(resolveFinishBackend("finish-lipsync", finishBackendFromProcess({}))).toBe("runpod");
  });

  it("honors FINISH_BACKEND=local", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "local" });
    expect(resolveFinishBackend("finish-rife", env)).toBe("local");
  });

  it("per-module override wins over global", () => {
    const env = finishBackendFromProcess({
      FINISH_BACKEND: "local",
      FINISH_LIPSYNC_BACKEND: "runpod",
    });
    expect(resolveFinishBackend("finish-lipsync", env)).toBe("runpod");
    expect(resolveFinishBackend("finish-rife", env)).toBe("local");
  });

  it("localFinishUrlFor normalizes trailing slash", () => {
    const env = finishBackendFromProcess({ LOCAL_FINISH_RIFE_URL: "http://gpu:8080/" });
    expect(localFinishUrlFor("finish-rife", env)).toBe("http://gpu:8080");
  });

  it("localFinishConfigured is false when URL missing in local mode", () => {
    const env = finishBackendFromProcess({ FINISH_BACKEND: "local" });
    expect(localFinishConfigured("finish-upscale", env)).toBe(false);
  });

  it("normalizeFinishBaseUrl rejects non-http(s)", () => {
    expect(normalizeFinishBaseUrl("ftp://x")).toBeNull();
  });
});
