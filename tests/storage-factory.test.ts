import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStorage } from "../src/platform/create-storage.js";

describe("createStorage", () => {
  it("selects S3 when S3_* is configured", () => {
    const bundle = createStorage({
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_BUCKET: "vivijure",
    });
    expect(bundle.backend).toBe("s3");
  });

  it("falls back to filesystem when S3_* is unset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vj-storage-"));
    try {
      const bundle = createStorage({
        ARTIFACT_ROOT: dir,
        PUBLIC_BASE_URL: "http://127.0.0.1:8790",
        STUDIO_API_TOKEN: "test-token",
      });
      expect(bundle.backend).toBe("filesystem");
      await bundle.renders.put("smoke/hello.txt", "hello", {
        httpMetadata: { contentType: "text/plain" },
      });
      const got = await bundle.renders.get("smoke/hello.txt");
      expect(got).not.toBeNull();
      expect(new TextDecoder().decode(got!)).toBe("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
