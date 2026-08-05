// local#314: intentional container deltas must stay pin-tested in-repo so a Dependabot
// bump or a careless rsync cannot silently rewrite the local base-image policy. Content
// identity against vivijure-cf is the CI job (containers-drift.yml); these pins run in
// every `npm test` without a cf checkout.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function dockerfile(rel: string): string {
  return readFileSync(resolve(root, "containers", rel), "utf8");
}

describe("containers intentional Dockerfile pins (local#314)", () => {
  it("video-finish stays on python 3.14 (local unconstrained group)", () => {
    expect(dockerfile("video-finish/Dockerfile")).toMatch(/^FROM python:3\.14/m);
  });

  it("image-prep stays on python 3.11 (numba pin)", () => {
    expect(dockerfile("image-prep/Dockerfile")).toMatch(/^FROM python:3\.11/m);
  });

  it("audio-beat-sync stays on python 3.11 (numba pin)", () => {
    expect(dockerfile("audio-beat-sync/Dockerfile")).toMatch(/^FROM python:3\.11/m);
  });

  it("check-containers-drift.sh is the CI gate (not only a manual script)", () => {
    const sh = readFileSync(resolve(root, "scripts/check-containers-drift.sh"), "utf8");
    expect(sh).toContain("local#314");
    expect(sh).toContain("video-finish");
    expect(sh).toContain("is_allowlisted");
    const wf = readFileSync(resolve(root, ".github/workflows/containers-drift.yml"), "utf8");
    expect(wf).toContain("check-containers-drift.sh");
    expect(wf).toContain("skyphusion-labs/vivijure-cf");
  });
});
