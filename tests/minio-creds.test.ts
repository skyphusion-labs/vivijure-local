import { describe, expect, it } from "vitest";
import {
  isMinioCredsPlaceholder,
  mintMinioAccessKey,
  mintMinioSecretKey,
  MINIO_CREDS_PLACEHOLDER,
} from "../src/minio-creds.js";

describe("minio-creds", () => {
  it("treats minioadmin / empty as placeholder", () => {
    expect(isMinioCredsPlaceholder(MINIO_CREDS_PLACEHOLDER, MINIO_CREDS_PLACEHOLDER)).toBe(true);
    expect(isMinioCredsPlaceholder("", "x")).toBe(true);
    expect(isMinioCredsPlaceholder("x", "")).toBe(true);
    expect(isMinioCredsPlaceholder(MINIO_CREDS_PLACEHOLDER, "rotated-secret")).toBe(true);
  });

  it("accepts minted pair", () => {
    const access = mintMinioAccessKey();
    const secret = mintMinioSecretKey();
    expect(access.startsWith("vj_")).toBe(true);
    expect(secret.length).toBe(64);
    expect(isMinioCredsPlaceholder(access, secret)).toBe(false);
  });
});
