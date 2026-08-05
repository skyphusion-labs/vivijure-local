// local#278: local-gpu must not advertise "Free after hardware" while self-host CogVideoX
// may need commercial registration. Commercial product use is via vivijure-cf / Cloudflare.
// Cost/blurb live in dev/manifests/local-gpu.json (loaded by scripts/local-gpu-module-server.ts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = join(import.meta.dirname, "..", "dev/manifests/local-gpu.json");

describe("local-gpu cost honesty (local#278)", () => {
  it("does not claim Free after hardware", () => {
    const raw = readFileSync(MANIFEST, "utf8");
    expect(raw).not.toMatch(/Free after hardware/);
    const d = JSON.parse(raw) as { ui?: { cost?: string; blurb?: string; limits?: string[] } };
    expect(d.ui?.cost ?? "").toMatch(/licence|license|model/i);
    expect(d.ui?.blurb ?? "").toMatch(/CogVideoX/i);
    expect(d.ui?.blurb ?? "").toMatch(/self-host/i);
    expect(d.ui?.blurb ?? "").toMatch(/vivijure-cf|Cloudflare/i);
  });
});
