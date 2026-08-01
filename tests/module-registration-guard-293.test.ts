// EVERY REGISTERED MODULE MUST HAVE SOMETHING BEHIND IT (local#293).
//
// THE INVARIANT, stated once:
//
//   Every surface in this repo that causes the studio to REGISTER a module must have something in
//   this repo that can SERVE it.
//
// The studio discovers modules from `MODULE_<NAME>_URL` bindings (core `moduleUrlsFromEnv`), and the
// panel is a projection of that registry -- so anything the registry carries gets rendered as an
// available, configurable feature. A binding pointing at nothing is therefore not a dead link, it is
// an ADVERTISEMENT: the operator gets a section, a config schema, and a full set of knobs for a
// capability this install cannot deliver.
//
// local#291 was the live instance. `scripts/dev-module-fleet.sh` stood `finish-rife` up on :9110,
// which wrote MODULE_FINISH_RIFE_URL into the fleet env file, which the documented dev flow sources;
// the registry discovered it and the panel rendered `interpolate`, `interpolation_factor` (2x/4x/8x),
// `face_restore`, `face_fidelity` and `only_faces`. vivijure-local ships no RIFE image and no local
// RIFE path (Conrad 2026-07-28), so the only thing behind those knobs was a cloud call, on a panel
// whose premise is that RunPod is opt-in. It was the ONLY one of fifteen fleet entries with no
// compose service behind it -- a mechanical discriminator with zero false positives on a real corpus,
// which is why this guard exists rather than a fourth hand-fix.
//
// ------------------------------------------------------------------------------------------------
// WHAT THIS GUARD DELIBERATELY DOES NOT COVER, and the honest scope of it
//
// local#291 is one of FOUR instances of a broader shape ("the panel claims something the thing behind
// it does not support"). This guard catches ONE of them, and it is worth being blunt about why:
//
//   local#223  keyframe advertised "SDXL on RunPod" while serving the GPU mock.
//   local#229  local-gpu advertised "SDXL on your own card" while serving the GPU mock.
//   local#278  the local-gpu manifest advertises "Free after hardware" while the default door's
//              model needs commercial registration and carries a usage cap.
//
// In all three the implementation EXISTS and is correctly wired. `module-keyframe` and
// `module-local-gpu` are real compose services with real ports; every rule below passes on them, and
// would have passed on them the day those bugs shipped. What was wrong was what the running thing
// SAID about itself, which no registration-vs-implementation check can see. #278 is further out
// still: it is a claim about a third-party licence, decidable only by reading that licence.
//
// So: this guard is a fence for the sub-species where NOTHING is behind the binding, which is the
// only sub-species that is mechanically decidable from this repo's own files. The mock-honesty
// sub-species has its own fences (tests/no-gpu-mock-229.test.ts, tests/module-honesty-50-51.test.ts);
// the claim-accuracy sub-species has none and cannot get one of this kind. Widening these rules to
// reach for the others would mean heuristics over code shape, which buys false positives -- and a
// guard that cries wolf is disabled by the first person it annoys, which is how the upstream-parity
// gate died on 2026-07-31.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");

/**
 * THE ESCAPE HATCH, and its location is the load-bearing part.
 *
 * A module name listed here is exempt from the "must have a compose service" rule, with a written
 * reason. It ships EMPTY, and it lives HERE -- in the guard -- rather than as a marker inside
 * `dev-module-fleet.sh` or `compose.yaml`.
 *
 * That is deliberate and it is cp#245's lesson: that check tested for its correction marker as a
 * SUBSTRING of the content being checked, so a section that merely MENTIONED the marker disarmed the
 * check for itself. Any in-file opt-out has that shape -- the file under inspection gets to decide
 * whether it is inspected. Keeping the list out here means an exemption is an edit to the guard, so
 * it cannot be added without a reviewer seeing it as an exemption rather than as a comment.
 */
export const REGISTERED_WITHOUT_A_SERVICE: Record<string, string> = {
  // "module-name": "why nothing in this repo needs to serve it",
};

function read(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

/** Service keys under `services:` in compose.yaml, across ALL profiles.
 *
 *  A TEXT read, not `docker compose config`: the question is "does this file declare a service by
 *  this name", which is profile-independent and needs no daemon. A service absent from the file
 *  cannot be produced by any profile. (Where the question genuinely IS about profile resolution,
 *  the compose CLI is the right tool -- see tests/localgpu-lane-280.test.ts.) */
function composeServices(): string[] {
  const lines = read("compose.yaml").split("\n");
  const start = lines.indexOf("services:");
  expect(start, "compose.yaml has no top-level `services:` key").toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== "") break;
    const m = /^ {2}([a-z0-9][a-z0-9._-]*):\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The `name port` rows the dev fleet starts, from the MODULE_PORTS heredoc.
 *
 *  Anchored on the heredoc OPENER and not on the whole `read` line, because the opener carries a
 *  trailing `|| true`. A slice regex that overruns or undershoots its terminator reads the wrong
 *  object with total confidence, so the null-guard below is what makes a shape change loud. */
function devFleetEntries(): { name: string; port: number }[] {
  const body = /MODULE_PORTS <<'EOF'[^\n]*\n([\s\S]*?)\nEOF/.exec(read("scripts/dev-module-fleet.sh"));
  expect(body, "MODULE_PORTS heredoc not found; scripts/dev-module-fleet.sh changed shape").not.toBeNull();
  return (body as RegExpExecArray)[1]
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, port] = l.split(/\s+/);
      return { name, port: Number(port) };
    });
}

/** Hardcoded `MODULE_*_URL: http://<host>:<port>` rows in compose.yaml.
 *
 *  Keyed on the HOST out of the URL, never on the variable name: the two disagree in this file by
 *  design (MODULE_PLANENHANCE_URL -> module-plan-enhance, MODULE_DIALOGUE_URL -> module-dialogue-gen),
 *  so a check that parsed the variable name would be checking a naming convention nobody promised.
 *  `${VAR:-}` passthrough rows are correctly ignored: an empty MODULE_*_URL is skipped by
 *  moduleUrlsFromEnv, so no binding is built and no module is registered. That is the honest shape
 *  local#280 established, not a gap. */
function composeModuleUrls(): { varName: string; host: string; port: number; line: number }[] {
  const out: { varName: string; host: string; port: number; line: number }[] = [];
  read("compose.yaml")
    .split("\n")
    .forEach((line, i) => {
      const m = /^\s+(MODULE_[A-Z0-9_]+_URL):\s*https?:\/\/([a-z0-9][a-z0-9._-]*):(\d+)\s*$/.exec(line);
      if (m) out.push({ varName: m[1], host: m[2], port: Number(m[3]), line: i + 1 });
    });
  return out;
}

/** The port a compose service's `command:` binds: the first bare numeric argument.
 *
 *  Every module sidecar script takes its port as argv[2] (`<script>.ts <port> [module]`), so the
 *  first number in the command IS the bound port. Returns null for a service whose command declares
 *  none, which the caller reports rather than silently passing. */
function commandPortFor(service: string): number | null {
  const lines = read("compose.yaml").split("\n");
  const at = lines.findIndex((l) => new RegExp(`^ {2}${service.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`).test(l));
  if (at < 0) return null;
  for (const line of lines.slice(at + 1)) {
    if (/^ {2}\S/.test(line)) break; // next service
    const m = /command:\s*\[([^\]]*)\]/.exec(line);
    if (m) {
      const num = /"(\d{2,5})"/.exec(m[1]);
      return num ? Number(num[1]) : null;
    }
  }
  return null;
}

// --------------------------------------------------------------------------- rule A

describe("A: every module the dev fleet stands up has a compose service behind it", () => {
  it("no fleet entry is registered with nothing to serve it", () => {
    // STRICT `module-<name>`, with NO bare-name fallback. The fallback looks harmless and is not:
    // compose declares a bare `audio-master` service (the CPU ffmpeg container) alongside
    // `module-audio-master` (the sidecar), so a bare-name fallback would accept the fleet's
    // `audio-master` entry on the strength of a container that serves no manifest at all. A loose
    // matcher passes for the wrong reason and reports confidently while doing it.
    const services = new Set(composeServices());
    const missing = devFleetEntries()
      .map((e) => e.name)
      .filter((n) => !services.has(`module-${n}`) && !(n in REGISTERED_WITHOUT_A_SERVICE));
    expect(missing, `fleet entries with no module-<name> compose service: ${missing.join(", ")}`).toEqual([]);
  });

  it("...and the fleet is not empty, nor is the service list (positive control)", () => {
    // Controls the rule above: an empty fleet has no violations, and an empty service list would make
    // EVERY entry a violation. Both parsers have to be returning real data for the pass to mean
    // anything, and the exact-count assertions make a silent parse regression loud.
    const entries = devFleetEntries();
    const services = composeServices();
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.map((e) => e.name)).toContain("keyframe");
    expect(services.length).toBeGreaterThan(20);
    expect(services).toContain("module-keyframe");
    expect(services).toContain("studio");
    // Every entry parsed a real port too, so a malformed row cannot slip through as name-only.
    expect(entries.every((e) => Number.isInteger(e.port) && e.port > 0)).toBe(true);
  });

  it("the mapping really is uniform, so no alias table is needed", () => {
    // Recorded because I assumed the opposite. While fixing local#291 I wrote that the finish
    // sidecars and the local-gpu door were named differently and that this guard would need a
    // reviewed alias table. Deriving it from the files instead of from memory: all fleet entries map
    // by the plain `module-` prefix, there are no exceptions, and an alias table would have been
    // machinery guarding a problem that does not exist. If this ever fails, the mapping has genuinely
    // become non-uniform and an alias table is then the right answer.
    const services = new Set(composeServices());
    for (const { name } of devFleetEntries()) {
      expect(services.has(`module-${name}`), `${name} does not map to module-${name}`).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------- rule B + C

describe("B/C: every module URL the studio is handed points at a service that exists, on its real port", () => {
  it("each hardcoded MODULE_*_URL names a declared compose service", () => {
    const services = new Set(composeServices());
    const bad = composeModuleUrls().filter((u) => !services.has(u.host));
    expect(
      bad.map((b) => `${b.varName} -> ${b.host} (line ${b.line})`),
      "studio env points at compose services that do not exist",
    ).toEqual([]);
  });

  it("each hardcoded MODULE_*_URL uses the port that service actually binds", () => {
    // A right-service/wrong-port binding is the quiet version of this whole defect class: discovery
    // cannot reach the module, core drops it after three failed manifest reads, and the panel is
    // simply SHORTER with no error anywhere. Nothing tells the operator a step went missing.
    const mismatched = composeModuleUrls()
      .map((u) => ({ ...u, bound: commandPortFor(u.host) }))
      .filter((u) => u.bound !== null && u.bound !== u.port);
    expect(
      mismatched.map((m) => `${m.varName} -> ${m.host}:${m.port} but the service binds ${m.bound}`),
      "studio env port does not match the port the service binds",
    ).toEqual([]);
  });

  it("...and the URL rows and their ports were actually parsed (positive control)", () => {
    // Both rules above are `filter(...).toEqual([])`, which is exactly what a parser returning
    // nothing produces. Pin that real rows were read AND that the port lookup resolves, otherwise
    // rule C is vacuous the moment the command format changes.
    const urls = composeModuleUrls();
    expect(urls.length).toBeGreaterThan(5);
    expect(urls.map((u) => u.varName)).toContain("MODULE_SUBTITLE_URL");
    const resolved = urls.filter((u) => commandPortFor(u.host) !== null);
    expect(resolved.length, "no service command port could be resolved; rule C is inert").toBe(urls.length);
  });
});

// --------------------------------------------------------------------------- rule D

describe("D: no two modules on one surface claim the same port", () => {
  it("the dev fleet assigns each module a distinct port", () => {
    // A collision is this defect class arriving by accident: the second sidecar fails to bind, the
    // fleet still writes its MODULE_*_URL, and the studio registers a module whose port belongs to a
    // different one. The fleet script does not check, and a failed background bind is easy to miss in
    // its output.
    const ports = devFleetEntries().map((e) => e.port);
    expect(ports.length).toBe(new Set(ports).size);
  });

  it("compose assigns each module service a distinct port", () => {
    const seen = new Map<number, string>();
    const clashes: string[] = [];
    for (const svc of composeServices().filter((s) => s.startsWith("module-"))) {
      const port = commandPortFor(svc);
      if (port === null) continue;
      const prev = seen.get(port);
      if (prev) clashes.push(`${svc} and ${prev} both on ${port}`);
      else seen.set(port, svc);
    }
    expect(clashes).toEqual([]);
    // Positive control: ports were actually read for most module services, so the loop is not
    // trivially clash-free because `commandPortFor` returned null every time.
    expect(seen.size).toBeGreaterThan(15);
  });
});

// --------------------------------------------------------------------------- the hatch

describe("the escape hatch stays honest", () => {
  it("every exemption carries a real reason", () => {
    for (const [name, reason] of Object.entries(REGISTERED_WITHOUT_A_SERVICE)) {
      expect(reason.trim().length, `exemption for ${name} has no reason`).toBeGreaterThan(20);
    }
  });

  it("the hatch cannot be opened from inside the files being checked", () => {
    // cp#245 in one assertion. If an exemption could be declared by a marker in dev-module-fleet.sh
    // or compose.yaml, then the file under inspection would decide whether it is inspected. The
    // guard must not read any opt-out token out of the checked content.
    const guard = read("tests/module-registration-guard-293.test.ts");
    const hatchReads = /read\((["'])(scripts\/dev-module-fleet\.sh|compose\.yaml)\1\)[\s\S]{0,200}?REGISTERED_WITHOUT_A_SERVICE/.test(
      guard,
    );
    expect(hatchReads, "the guard appears to source its exemptions from the content it checks").toBe(false);
  });
});
