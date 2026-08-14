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
  // WAS 3.14, AND THAT PREMISE WAS NEVER TRUE ON ANY BRANCH. local#314 was filed while
  // video-finish sat on 3.14 in the dependabot "unconstrained" group. local#316 landed in the
  // same window via PR #358 and PINNED it to 3.11 for dual-panel parity with cf -- which is where
  // cf has been the whole time. This PR was opened BEFORE #358 merged and sat behind main, so its
  // assertion describes a world that stopped existing while the PR waited.
  //
  // Bumping the Dockerfile to 3.14 to satisfy the old assertion would be the wrong repair: it
  // contradicts an already-merged, already-tested decision and would immediately break
  // tests/video-finish-python-316.test.ts, which asserts the exact opposite.
  //
  // The duplication with that sibling test is deliberate and worth keeping. It asserts the pin
  // because the PIN is the point (cf parity); this asserts it because DRIFT is the point. They
  // would need to disagree for a reason, and if one is ever deleted the other still fails.
  it("video-finish stays on python 3.11 (cf parity, local#316)", () => {
    expect(dockerfile("video-finish/Dockerfile")).toMatch(/^FROM python:3\.11/m);
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
