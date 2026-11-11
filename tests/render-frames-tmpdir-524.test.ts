// local#524: render-frames-311 used to leave a vj-frames-route directory in TMPDIR.
// This runs that file in a child vitest whose TMPDIR we own, and counts the
// leftover directories before and after. The count is of this private directory
// only. It does not list the shared TMPDIR.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterAll } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "vj-frames-524-"));

function leftover(): string[] {
  return readdirSync(scratch).filter((name) => name.startsWith("vj-frames-route-")).sort();
}

describe("local#524 render-frames leaves no vj-frames-route dir", () => {
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("before and after counts of leftover dirs are equal, and the child ran", () => {
    const before = leftover();
    const child = spawnSync(
      join(ROOT, "node_modules/.bin/vitest"),
      ["run", "tests/render-frames-311.test.ts", "--reporter=dot"],
      {
        cwd: ROOT,
        env: { ...process.env, TMPDIR: scratch },
        encoding: "utf8",
      },
    );
    const after = leftover();
    const out = `${child.stdout}\n${child.stderr}`;
    expect(child.status, out).toBe(0);
    expect(out).toMatch(/Tests\s+[1-9]\d*\s+passed/);
    expect(after, `before ${before.length} [${before.join(", ")}] after ${after.length} [${after.join(", ")}]`).toEqual(before);
  }, 120_000);
});
