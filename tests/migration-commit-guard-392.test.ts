// MIGRATION COMMITS ARE AN INDEX, AND AN APPLIED FILE IS HISTORY (local#392).
//
// Two rules, both on commits reachable from head and not from the base:
//   a migrations/ touch cannot wear a ci:, docs:, or chore: subject
//   a path under migrations/ that already exists on the base cannot be changed
//
// The tests run the real script against a real git repo. A string match on the
// script would stay green if the range, the combined-diff, or the subject
// anchor was wrong, and those three are the ways this guard goes vacuous or
// cries wolf. Fixture repos live under the temp dir. Nothing here is committed
// on the branch that ships the guard.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/check-migration-commits.sh");
const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `HARNESS FAILURE: git ${args.join(" ")}\n${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`,
    );
  }
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "migration-commit-guard-"));
  dirs.push(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "guard-test"]);
  git(repo, ["config", "user.email", "guard-test@example.com"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  return repo;
}

function write(repo: string, rel: string, body: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  git(repo, ["add", "--", rel]);
}

function commit(repo: string, subject: string): string {
  git(repo, ["commit", "-m", subject]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

function run(repo: string, base: string, head: string): { status: number; output: string } {
  try {
    const stdout = execFileSync("bash", [script, base, head], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string; message?: string };
    if (typeof err.status !== "number") {
      throw new Error(`HARNESS FAILURE: the guard did not run.\n${err.message ?? ""}`);
    }
    return { status: err.status, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("migration commit guard (local#392)", () => {
  it("fails when a commit edits a migration that already exists on the base", () => {
    const repo = initRepo();
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n");
    const base = commit(repo, "feat(db): add job log");
    write(repo, "migrations/0016_runpod_job_log.sql", "select 2;\n");
    const head = commit(repo, "fix(db): amend applied job log");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(1);
    expect(output).toContain("migrations/0016_runpod_job_log.sql");
    expect(output).toContain("already exists");
    expect(output).not.toContain("starts with ci:");
  });

  it("passes when the only migration change is a new file with a feat(db) subject", () => {
    const repo = initRepo();
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n");
    const base = commit(repo, "feat(db): add job log");
    write(repo, "migrations/0099_example.sql", "select 99;\n");
    const head = commit(repo, "feat(db): add example forward migration");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(0);
    expect(output).toContain("PASS (1 commit(s) not already on the base)");
    expect(output).not.toContain("0099_example.sql");
  });

  it("fails when a ci: subject touches migrations, even to add a new file", () => {
    const repo = initRepo();
    write(repo, "README", "base\n");
    const base = commit(repo, "feat: readme");
    write(repo, "migrations/0099_example.sql", "select 99;\n");
    const head = commit(repo, "ci: add a migration");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(1);
    expect(output).toContain("ci: add a migration");
    expect(output).toContain("starts with ci:");
    expect(output).not.toContain("already exists");
  });

  it.each(["docs: note the column", "chore: tidy sql", "ci(db): hide schema", "CI: hide schema", "chore(deps)!: bump"])(
    "rejects migration subject %s",
    (subject) => {
      const repo = initRepo();
      write(repo, "README", "base\n");
      const base = commit(repo, "feat: readme");
      write(repo, "migrations/0099_example.sql", "select 99;\n");
      const head = commit(repo, subject);

      const { status, output } = run(repo, base, head);

      expect(status, output).toBe(1);
      expect(output).toContain(subject);
      expect(output).toContain("starts with ci:");
    },
  );

  it("allows a ci: subject that does not touch migrations", () => {
    const repo = initRepo();
    write(repo, "README", "base\n");
    const base = commit(repo, "feat: readme");
    write(repo, "README", "ci only\n");
    const head = commit(repo, "ci: workflow only");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(0);
    expect(output).toContain("PASS (1 commit(s) not already on the base)");
  });

  it("allows fix(ci): on a new migration, because the type is fix, not ci", () => {
    const repo = initRepo();
    write(repo, "README", "base\n");
    const base = commit(repo, "feat: readme");
    write(repo, "migrations/0099_example.sql", "select 99;\n");
    const head = commit(repo, "fix(ci): add example forward migration");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(0);
    expect(output).toContain("PASS (1 commit(s) not already on the base)");
  });

  it("allows a later commit to edit a migration that does not exist on the base", () => {
    const repo = initRepo();
    write(repo, "README", "base\n");
    const base = commit(repo, "feat: readme");
    write(repo, "migrations/0099_example.sql", "select 1;\n");
    commit(repo, "feat(db): add example forward migration");
    write(repo, "migrations/0099_example.sql", "select 2;\n");
    const head = commit(repo, "fix(db): correct the new migration before merge");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(0);
    expect(output).toContain("PASS (2 commit(s) not already on the base)");
  });

  it("does not judge a violating commit that is already the base", () => {
    const repo = initRepo();
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n");
    const root = commit(repo, "feat(db): add job log");
    write(repo, "migrations/0016_runpod_job_log.sql", "select 2;\n");
    write(repo, "migrations/0020_render_motion_backend.sql", "select 20;\n");
    const historical = commit(repo, "ci: estate workflow standard");
    write(repo, "README", "after\n");
    const head = commit(repo, "feat: note");

    const hidden = run(repo, historical, head);
    expect(hidden.status, hidden.output).toBe(0);
    expect(hidden.output).toContain("PASS (1 commit(s) not already on the base)");

    const inRange = run(repo, root, historical);
    expect(inRange.status, inRange.output).toBe(1);
    expect(inRange.output).toContain("migrations/0016_runpod_job_log.sql");
    expect(inRange.output).toContain("starts with ci:");
  });

  it("passes a clean merge of a migration that landed on the base", () => {
    const repo = initRepo();
    write(repo, "migrations/0001_init.sql", "select 1;\n");
    commit(repo, "feat(db): init");
    git(repo, ["checkout", "-b", "feature"]);
    write(repo, "README", "feature\n");
    commit(repo, "feat: readme");
    git(repo, ["checkout", "main"]);
    write(repo, "migrations/0002_next.sql", "select 2;\n");
    const main = commit(repo, "feat(db): next");
    git(repo, ["checkout", "feature"]);
    git(repo, ["merge", "--no-ff", "--no-edit", "-m", "Merge main into feature", "main"]);
    const feature = git(repo, ["rev-parse", "HEAD"]).trim();
    const parents = git(repo, ["show", "-s", "--format=%P", feature]).trim().split(/\s+/);
    expect(parents, "the fixture must be a merge or the combined-diff path is untested").toHaveLength(2);

    const { status, output } = run(repo, main, feature);

    expect(status, output).toBe(0);
    expect(output).toContain("PASS (2 commit(s) not already on the base)");
  });

  it("fails an evil merge that edits a migration which exists on the base", () => {
    const repo = initRepo();
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n");
    commit(repo, "feat(db): add job log");
    git(repo, ["checkout", "-b", "feature"]);
    write(repo, "README", "feature\n");
    commit(repo, "feat: readme");
    git(repo, ["checkout", "main"]);
    write(repo, "migrations/0020_render_motion_backend.sql", "select 20;\n");
    const main = commit(repo, "feat(db): motion backend");
    git(repo, ["checkout", "feature"]);
    git(repo, ["merge", "--no-ff", "--no-commit", "main"]);
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n-- hand edit during merge\n");
    git(repo, ["commit", "-m", "Merge main into feature"]);
    const feature = git(repo, ["rev-parse", "HEAD"]).trim();

    const { status, output } = run(repo, main, feature);

    expect(status, output).toBe(1);
    expect(output).toContain("migrations/0016_runpod_job_log.sql");
    expect(output).toContain("already exists");
  });

  it("reports both rules when one commit does both", () => {
    const repo = initRepo();
    write(repo, "migrations/0016_runpod_job_log.sql", "select 1;\n");
    const base = commit(repo, "feat(db): add job log");
    write(repo, "migrations/0016_runpod_job_log.sql", "select 2;\n");
    const head = commit(repo, "ci: rewrite applied migration");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(1);
    expect(output).toContain("already exists");
    expect(output).toContain("starts with ci:");
  });

  it("treats migrations/demo the same as a numbered file at the root", () => {
    const repo = initRepo();
    write(repo, "migrations/demo/0001_demo_seed.sql", "select 1;\n");
    const base = commit(repo, "feat(db): seed demo");
    write(repo, "migrations/demo/0001_demo_seed.sql", "select 2;\n");
    const head = commit(repo, "fix(db): amend demo seed");

    const { status, output } = run(repo, base, head);

    expect(status, output).toBe(1);
    expect(output).toContain("migrations/demo/0001_demo_seed.sql");
    expect(output).toContain("already exists");
  });
});
