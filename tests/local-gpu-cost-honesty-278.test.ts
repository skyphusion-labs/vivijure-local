// local#278: local-gpu / vivijure-local = hobby + non-commercial; commercial = vivijure-cf.
// Cost/blurb live in dev/manifests/local-gpu.json (local-gpu-module-server -> /module.json).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = join(import.meta.dirname, "..", "dev/manifests/local-gpu.json");

describe("local-gpu cost honesty (local#278)", () => {
  it("does not claim Free after hardware and spells hobby vs commercial path", () => {
    const raw = readFileSync(MANIFEST, "utf8");
    expect(raw).not.toMatch(/Free after hardware/);
    const d = JSON.parse(raw) as { ui?: { cost?: string; blurb?: string; limits?: string[] } };
    expect(d.ui?.cost ?? "").toMatch(/non-commercial|hobby|licence|license/i);
    expect(d.ui?.blurb ?? "").toMatch(/hobby|non-commercial/i);
    expect(d.ui?.blurb ?? "").toMatch(/vivijure-cf|Cloudflare/i);
    expect(d.ui?.blurb ?? "").toMatch(/not this door|self-host only/i);
    const limits = (d.ui?.limits ?? []).join(" ");
    expect(limits).toMatch(/non-commercial|hobby/i);
    expect(limits).toMatch(/vivijure-cf/i);
  });
});
