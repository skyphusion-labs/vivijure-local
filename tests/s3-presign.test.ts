import { describe, it, expect } from "vitest";
import { presignS3WithConfig, uriEncode } from "../src/platform/s3-presign.js";

describe("uriEncode", () => {
  it("encodes slashes in query values", () => {
    expect(uriEncode("a/b", true)).toBe("a%2Fb");
    expect(uriEncode("renders/x.mp4", false)).toBe("renders/x.mp4");
  });
});

describe("presignS3WithConfig", () => {
  const cfg = {
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    endpoint: "http://127.0.0.1:9000",
    bucket: "vivijure",
    region: "us-east-1",
  };

  it("mints a GET URL with SigV4 query params", async () => {
    const url = await presignS3WithConfig(cfg, "GET", "renders/film.mp4", 300, 1_700_000_000_000);
    expect(url).toContain("http://127.0.0.1:9000/vivijure/renders/film.mp4?");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(url).toContain("X-Amz-Signature=");
  });

  it("refuses unsafe keys", async () => {
    await expect(presignS3WithConfig(cfg, "GET", "../secret", 300)).rejects.toThrow(/unsafe/);
  });
});
