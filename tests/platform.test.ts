import { describe, expect, it } from "vitest";
import { moduleUrlsFromEnv } from "../src/platform/modules.js";

describe("HttpModuleTransport", () => {
  it("parses MODULE_*_URL env vars into bindings", () => {
    const map = moduleUrlsFromEnv({
      MODULE_KEYFRAME_URL: "http://127.0.0.1:9101/",
      MODULE_LOCAL_GPU_URL: "http://127.0.0.1:9102",
      PORT: "8790",
    });
    expect(map.get("MODULE_KEYFRAME")).toBe("http://127.0.0.1:9101");
    expect(map.get("MODULE_LOCAL_GPU")).toBe("http://127.0.0.1:9102");
    expect(map.has("PORT")).toBe(false);
  });
});
