// local#316: video-finish base interpreter is pinned to python 3.11 for dual-panel
// parity with vivijure-cf. Dependabot ignore is the other half of the pin; this test
// fails in ordinary `npm test` if a grouped bump or careless rsync rewrites the FROM.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("video-finish python base pin (local#316)", () => {
  it("Dockerfile stays on python 3.11 (cf parity; not 3.14)", () => {
    const df = readFileSync(resolve(root, "containers/video-finish/Dockerfile"), "utf8");
    expect(df).toMatch(/^FROM python:3\.11/m);
    expect(df).not.toMatch(/^FROM python:3\.14/m);
    expect(df).toMatch(/local#316/);
  });

  it("dependabot ignores major/minor python bumps for video-finish", () => {
    const yml = readFileSync(resolve(root, ".github/dependabot.yml"), "utf8");
    expect(yml).toContain("/containers/video-finish");
    expect(yml).toContain("docker-images-video-finish-cf-parity");
    expect(yml).toMatch(/local#316/);
    // video-finish must NOT sit in the unconstrained docker-images group.
    const unconstrained = yml.split("docker-images:")[1] ?? "";
    expect(unconstrained).not.toContain("/containers/video-finish");
  });
});
