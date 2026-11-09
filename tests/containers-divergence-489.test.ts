// local#489: sync-containers.sh overwrote the paths check-containers-drift.sh allowlists, and the
// checker reported PASS on the overwritten tree. Fixed at the source: both scripts read ONE list,
// scripts/containers-local-divergence.txt, the sync never writes a listed path, and the checker
// fails when a listed path has become byte-identical to cf (the overwrite shape).
//
// These run the REAL scripts (copied into a temp tree, since both resolve the repo root from their
// own location) against a synthetic cf tree. No cf checkout and no network.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "..");
const DIRS = ["video-finish", "image-prep", "audio-beat-sync", "audio-mix", "audio-master"];
const LOCAL_VF = "FROM python:3.11-slim-bookworm\n# LOCAL: 3.14 was built cleanly twice and still rejected.\n";
const CF_VF = "FROM python:3.11-slim-bookworm\n";
const LOCAL_IP = "FROM python:3.11-slim-bookworm\n# LOCAL: dependabot-ignore notes after #254.\n";
const CF_IP = "FROM python:3.11-slim\n";

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true });
});

function put(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A local repo (the two real scripts plus the real list) and a cf tree that differs from it only
 *  in the listed paths, plus one ordinary file the sync must update. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "local489-"));
  made.push(base);
  const local = join(base, "local");
  const cf = join(base, "cf");
  for (const f of ["sync-containers.sh", "check-containers-drift.sh", "containers-local-divergence.txt"]) {
    cpSync(join(repo, "scripts", f), join(local, "scripts", f));
  }
  for (const d of DIRS) {
    const df = d === "audio-beat-sync" ? "FROM python:3.12-slim\n" : "FROM python:3.11-slim\n";
    for (const root of [local, cf]) {
      put(join(root, "containers", d, "app.py"), "print('same')\n");
      put(join(root, "containers", d, "Dockerfile"), df);
    }
  }
  put(join(local, "containers/video-finish/Dockerfile"), LOCAL_VF);
  put(join(cf, "containers/video-finish/Dockerfile"), CF_VF);
  put(join(local, "containers/image-prep/Dockerfile"), LOCAL_IP);
  put(join(cf, "containers/image-prep/Dockerfile"), CF_IP);
  put(join(local, "containers/README.md"), "local compose docs\n");
  put(join(cf, "containers/README.md"), "cf GHCR docs\n");
  // An ordinary file that is behind cf: the sync must update it.
  put(join(cf, "containers/audio-mix/app.py"), "print('cf moved')\n");
  return { local, cf };
}

function sync(local: string, cf: string) {
  return spawnSync("bash", [join(local, "scripts/sync-containers.sh")], { env: { ...process.env, VIVIJURE_SRC: cf }, encoding: "utf8" });
}

function check(local: string, cf: string) {
  const r = spawnSync("bash", [join(local, "scripts/check-containers-drift.sh"), cf], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const read = (p: string) => readFileSync(p, "utf8");

describe("local#489 one divergence list, read by both tools", () => {
  it("the sync keeps every listed path, updates the rest, and the checker then passes", () => {
    const { local, cf } = fixture();
    expect(check(local, cf).status, "the fixture starts behind cf").toBe(1);
    const s = sync(local, cf);
    expect(s.status, s.stderr).toBe(0);
    expect(read(join(local, "containers/video-finish/Dockerfile"))).toBe(LOCAL_VF);
    expect(read(join(local, "containers/image-prep/Dockerfile"))).toBe(LOCAL_IP);
    expect(read(join(local, "containers/README.md"))).toBe("local compose docs\n");
    expect(read(join(local, "containers/audio-mix/app.py"))).toBe("print('cf moved')\n");
    const c = check(local, cf);
    expect(c.status, c.out).toBe(0);
    expect(c.out).toContain("PASS");
  });

  it("RED on the local#489 shape: a listed Dockerfile overwritten with cf's bytes (comments gone, FROM unchanged)", () => {
    const { local, cf } = fixture();
    sync(local, cf);
    // Exactly what the old unguarded rsync did. Both FROM lines are python:3.11, so the pin test
    // alone still passes; only the identity check can see this.
    writeFileSync(join(local, "containers/video-finish/Dockerfile"), CF_VF);
    const c = check(local, cf);
    expect(c.status, c.out).toBe(1);
    expect(c.out).toContain("video-finish/Dockerfile is BYTE-IDENTICAL to cf");
  });

  it("CONTROL: the list is what protects the path; with its line removed the sync overwrites it", () => {
    const { local, cf } = fixture();
    const list = join(local, "scripts/containers-local-divergence.txt");
    writeFileSync(list, read(list).replace(/^video-finish\/Dockerfile\n/m, ""));
    expect(sync(local, cf).status).toBe(0);
    expect(read(join(local, "containers/video-finish/Dockerfile"))).toBe(CF_VF);
    expect(read(join(local, "containers/image-prep/Dockerfile"))).toBe(LOCAL_IP);
  });

  it("a listed path that does not exist locally is a stale line, and fails", () => {
    const { local, cf } = fixture();
    sync(local, cf);
    const list = join(local, "scripts/containers-local-divergence.txt");
    writeFileSync(list, read(list) + "audio-mix/gone.txt\n");
    const c = check(local, cf);
    expect(c.status).toBe(1);
    expect(c.out).toContain("audio-mix/gone.txt does not exist here");
  });

  it("both tools fail closed without the list", () => {
    const { local, cf } = fixture();
    rmSync(join(local, "scripts/containers-local-divergence.txt"));
    expect(sync(local, cf).status).toBe(2);
    expect(read(join(local, "containers/video-finish/Dockerfile")), "nothing was synced").toBe(LOCAL_VF);
    expect(check(local, cf).status).toBe(2);
  });

  it("neither script carries its own copy of the scope", () => {
    for (const f of ["sync-containers.sh", "check-containers-drift.sh"]) {
      const src = read(join(repo, "scripts", f));
      expect(src, f).toContain("containers-local-divergence.txt");
      expect(src, f).not.toMatch(/^\s*video-finish\/Dockerfile\)/m);
    }
  });

  it("the real list names the three deltas the checker header documents", () => {
    const listed = read(join(repo, "scripts/containers-local-divergence.txt"))
      .split("\n")
      .map((l) => l.replace(/#.*/, "").trim())
      .filter(Boolean);
    expect(listed.sort()).toEqual(["README.md", "image-prep/Dockerfile", "video-finish/Dockerfile"]);
    expect(execFileSync("bash", ["-n", join(repo, "scripts/sync-containers.sh")]).length).toBe(0);
  });
});
