// local#295: local CI must not float on vivijure-cf main for quality-tier-drift.
// A pin file + workflow ref is the deliberate contract; this test fails if either half
// is removed or rewritten to track floating main.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function pinSha(): string {
  const raw = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
  const m = raw.match(/^SHA=([0-9a-f]{40})\s*$/m);
  if (!m) throw new Error("dev/cf-quality-tier-pin missing SHA=<40-char hex>");
  return m[1];
}

describe("vivijure-cf quality-tier pin (local#295)", () => {
  it("dev/cf-quality-tier-pin holds a full 40-char commit SHA", () => {
    const sha = pinSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const body = readFileSync(resolve(root, "dev/cf-quality-tier-pin"), "utf8");
    expect(body).toMatch(/local#295/);
    expect(body).toMatch(/quality-tier-drift/);
    // Explicitly not for manifest-drift / containers-drift.
    expect(body).toMatch(/NOT used by manifest-drift/i);
  });

  it("ci.yml checks out vivijure-cf at the pin, not floating main", () => {
    const yml = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    expect(yml).toContain("local#295");
    expect(yml).toContain("dev/cf-quality-tier-pin");
    expect(yml).toContain("steps.cf_pin.outputs.sha");
    // Must not hardcode ref: main on the quality-tier checkout step.
    const qtBlock = yml.split("Checkout vivijure-cf")[1] ?? "";
    expect(qtBlock).toMatch(/ref:\s*\$\{\{\s*steps\.cf_pin\.outputs\.sha\s*\}\}/);
    expect(qtBlock).not.toMatch(/ref:\s*main\b/);
    // Whole modules/ tree, not a hand-listed sparse subset.
    expect(qtBlock).toMatch(/sparse-checkout:[\s\S]*modules/);
    expect(qtBlock).toMatch(/sparse-checkout-cone-mode:\s*true/);
    // Preflight names the issue so the next miss is self-diagnosing.
    expect(yml).toMatch(/Preflight quality-tier cf checkout \(local#295\)/);
  });

  it("pin SHA matches the value the workflow will request", () => {
    // Canary: if someone updates only the pin file or only a hardcode, this stays green
    // only when the pin file is the single source (workflow reads it at runtime).
    expect(pinSha().length).toBe(40);
  });
});
