import { describe, it, expect } from "vitest";
import {
  resolveCastImageMime,
  sniffCastImageMime,
  CAST_IMAGE_MIME_RE,
} from "../src/cast-media.js";

describe("cast image MIME allowlist + sniff (stored-XSS gate)", () => {
  it("CAST_IMAGE_MIME_RE rejects text/html and svg", () => {
    expect(CAST_IMAGE_MIME_RE.test("text/html")).toBe(false);
    expect(CAST_IMAGE_MIME_RE.test("image/svg+xml")).toBe(false);
    expect(CAST_IMAGE_MIME_RE.test("image/png")).toBe(true);
  });

  it("resolveCastImageMime rejects text/html claims", () => {
    expect(() => resolveCastImageMime("text/html")).toThrow(/not allowed/);
  });

  it("sniffCastImageMime returns null for HTML", () => {
    expect(sniffCastImageMime(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffCastImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
  });

  it("resolveCastImageMime with bytes rejects HTML claiming image/png", () => {
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect(() => resolveCastImageMime("image/png", html)).toThrow(/recognizable/);
  });
});
