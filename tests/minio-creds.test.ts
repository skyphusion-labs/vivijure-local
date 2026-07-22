import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeProfilesIncludeEdge,
  edgeProfileRefusesMinioPlaceholder,
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

  it("edge profile refuses placeholder MinIO root creds", () => {
    expect(composeProfilesIncludeEdge("edge")).toBe(true);
    expect(composeProfilesIncludeEdge("gpu,edge")).toBe(true);
    expect(composeProfilesIncludeEdge("")).toBe(false);
    expect(
      edgeProfileRefusesMinioPlaceholder("edge", MINIO_CREDS_PLACEHOLDER, MINIO_CREDS_PLACEHOLDER),
    ).toBe(true);
    expect(edgeProfileRefusesMinioPlaceholder("", MINIO_CREDS_PLACEHOLDER, MINIO_CREDS_PLACEHOLDER)).toBe(
      false,
    );
    expect(edgeProfileRefusesMinioPlaceholder("edge", "vj_ok", "rotated-secret-long-enough")).toBe(
      false,
    );
  });

  it("compose.yaml wires edge-minio-creds-gate before caddy", () => {
    const yaml = readFileSync(join(import.meta.dirname, "..", "compose.yaml"), "utf8");
    expect(yaml).toContain("edge-minio-creds-gate:");
    expect(yaml).toMatch(/depends_on:[\s\S]*edge-minio-creds-gate:[\s\S]*service_completed_successfully/);
  });
});
