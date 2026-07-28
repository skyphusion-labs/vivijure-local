// cf#98 parity on the self-host panel: the host reports hooks it cannot SERVE.
//
// Same defect, same shape, honest per host. A studio with the plan.enhance module installed but no
// AI Gateway configured would serve a full planning-model picker whose every option fails at hPlan
// -- and the panel could not know, because the fact was never on the wire (local#201 class).
//
// PARITY IS THE FEATURE, NOT THE BYTES: the reason string here deliberately differs from
// vivijure-cf's in its parenthetical, because the knobs differ. cf is a Worker with an `AI` binding;
// a self-host studio has no Workers binding at all. Shipping cf's text here would tell a homelabber
// to set something that does not exist on their machine.

import { describe, expect, it, afterEach } from "vitest";
import { testSettingsHost } from "./test-host.js";
import { createApp } from "../src/app.js";
import { _resetModuleDiscoveryCache, MODULE_API, type ModulesResponse } from "@skyphusion-labs/vivijure-core";
import { PLANNER_UNAVAILABLE_REASON } from "../src/platform/ai-gateway.js";
import type { FetcherLike, ModuleTransport, Platform } from "../src/platform/types.js";
import { FilesystemObjectStore, LocalObjectPresigner } from "../src/platform/storage.js";
import { EnvSecretStore } from "../src/platform/secrets.js";
import { openDatabase, migrateDatabase } from "../src/platform/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVpcHostBindings } from "../src/platform/vpc-transport.js";
import {
  VIDEO_FINISH_ADVISORY_HOOKS,
  VIDEO_FINISH_CAPABILITY_KEY,
  VIDEO_FINISH_GATED_HOOKS,
  VIDEO_FINISH_UNAVAILABLE_REASON,
} from "../src/video-finish-availability.js";
import {
  GPU_ENGINE_HOOKS,
  LOCAL_DOOR_UNAVAILABLE_REASON,
} from "../src/local-door-availability.js";

const SECRET = "a".repeat(32) + "b".repeat(32);
let dir: string;

class NoModules implements ModuleTransport {
  resolve(): FetcherLike | null {
    return null;
  }
  listBindings(): string[] {
    return [];
  }
}

/**
 * A module that serves the GPU-engine hooks, so "fully configured" can mean what it says.
 *
 * local#229 added a gate for "this host has no keyframe/motion engine at all", and the NoModules
 * fixture is exactly that host. Without a serving module here the omission test below could no
 * longer distinguish "nothing is unavailable" from "the GPU gate fires unconditionally".
 *
 * Deliberately NOT named `local-gpu`: the gate asks which hooks are SERVED, never which module name
 * serves them, and a fixture borrowing the first-party name would hide it if that ever changed.
 */
const fakeDoorManifest = {
  name: "acme-door",
  version: "1.0.0",
  api: "vivijure-module/2",
  hooks: [...GPU_ENGINE_HOOKS],
  provides: [{ id: "acme-door", label: "ACME Door" }],
  binding: "MODULE_ACMEDOOR",
};

class GpuDoorModule implements ModuleTransport {
  resolve(): FetcherLike {
    return {
      fetch: async (input: string | URL) =>
        new URL(String(input)).pathname === "/module.json"
          ? new Response(JSON.stringify(fakeDoorManifest), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 }),
    } as FetcherLike;
  }
  listBindings(): string[] {
    return ["MODULE_ACMEDOOR"];
  }
}

function platformWith(vars: Record<string, string>, modules: ModuleTransport = new NoModules()): Platform {
  dir = mkdtempSync(join(tmpdir(), "vj-hooks-"));
  const dbPath = join(dir, "studio.db");
  migrateDatabase(dbPath, join(import.meta.dirname, "..", "migrations"));
  const store = new FilesystemObjectStore(join(dir, "renders"));
  return {
    db: openDatabase(dbPath),
    renders: store,
    chatBucket: store,
    presigner: new LocalObjectPresigner("http://127.0.0.1:8790", SECRET),
    secrets: new EnvSecretStore({}),
    modules,
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, ...vars },
    // Built the way BOOT builds it: server.ts calls applyRuntimeEnvToPlatform, which sets
    // hostBindings from the runtime env (VIDEO_FINISH_URL -> the video-finish fetcher). A fixture
    // that only set `vars` would leave hostBindings undefined and make every studio look like it
    // lacks the tier -- which is exactly the over-claim the cf#118 check must not make.
    hostBindings: buildVpcHostBindings(vars as NodeJS.ProcessEnv),
  } as unknown as Platform;
}

async function hostOf(
  vars: Record<string, string>,
  modules: ModuleTransport = new NoModules(),
): Promise<ModulesResponse["host"]> {
  const app = createApp(testSettingsHost(platformWith(vars, modules)));
  const res = await app.request("/api/modules", { headers: { authorization: `Bearer ${SECRET}` } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as ModulesResponse;
  expect(body.api).toBe(MODULE_API);
  return body.host;
}

const GATEWAY_CONFIGURED = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  GATEWAY_ID: "gw",
  CF_AIG_TOKEN: "tok",
};

/**
 * "Serves everything" grew a second requirement in cf#118: a studio that cannot reach the
 * video-finish container cannot deliver score / master / film.finish / notify. VIDEO_FINISH_URL is
 * how this panel configures that tier (vpc-transport synthesizes the fetcher from it), so the
 * omission test has to configure it -- otherwise it stops asserting "the block is OMITTED" and
 * quietly becomes an assertion that the video-finish report does not exist.
 */
const FULLY_CONFIGURED = {
  ...GATEWAY_CONFIGURED,
  VIDEO_FINISH_URL: "http://video-finish:8080",
};

afterEach(() => {
  _resetModuleDiscoveryCache();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/modules host.hooks_unavailable (cf#98 parity)", () => {
  it("reports plan.enhance unavailable, reason VERBATIM, with no gateway configured", async () => {
    const host = await hostOf({});
    expect(host?.hooks_unavailable?.["plan.enhance"]).toBe(PLANNER_UNAVAILABLE_REASON);
  });

  it("OMITS the block when EVERY tier is configured -- absence means available", async () => {
    // A GPU module must be installed for this to mean "everything is available" (local#229): a host
    // with no keyframe/motion engine genuinely cannot render, and saying nothing would be the
    // over-claim.
    const host = await hostOf(FULLY_CONFIGURED, new GpuDoorModule());
    expect(host?.hooks_unavailable).toBeUndefined();
  });

  it("reports the VIDEO-FINISH hooks when only that tier is missing (cf#118)", async () => {
    // The gateway is configured and a GPU module is installed, so plan.enhance and the engine hooks
    // are fine -- anything reported here can ONLY have come from the video-finish gate, which is what
    // makes this a test of that gate rather than a test that something, somewhere, is unavailable.
    const host = await hostOf(GATEWAY_CONFIGURED, new GpuDoorModule());
    expect(Object.keys(host?.hooks_unavailable ?? {}).sort()).toEqual([
      "capability:video-finish",
      "film.finish",
      "master",
      "notify",
    ]);
    expect(host?.hooks_unavailable?.["plan.enhance"]).toBeUndefined();
  });

  // local#229: the GPU-engine gate. The mock that used to answer for an unconfigured door is
  // deleted, so a bare studio serves NO keyframe/motion engine -- and must say so before a render is
  // spent rather than offer controls whose every option 400s at submit.
  describe("GPU-engine hooks (local#229)", () => {
    it("reports keyframe + motion.backend when NO module serves them", async () => {
      const host = await hostOf(FULLY_CONFIGURED);
      for (const hook of GPU_ENGINE_HOOKS) {
        expect(host?.hooks_unavailable?.[hook]).toBe(LOCAL_DOOR_UNAVAILABLE_REASON);
      }
    });

    it("STOPS reporting them once any module serves them (POSITIVE CONTROL)", async () => {
      // The discriminating half: the gate is driven by what is SERVED, not by LOCAL_BACKEND_URL. A
      // studio on the optional `cloud` profile has no local door and renders fine, so reading env
      // here would grey out working capability.
      const host = await hostOf(FULLY_CONFIGURED, new GpuDoorModule());
      const named = Object.keys(host?.hooks_unavailable ?? {});
      for (const hook of GPU_ENGINE_HOOKS) expect(named).not.toContain(hook);
    });

    it("names the operator's own knob and never fabricates a fallback", async () => {
      // Same local#226 rule as the video-finish reason: the reader IS the operator.
      expect(LOCAL_DOOR_UNAVAILABLE_REASON).toMatch(/LOCAL_BACKEND_URL/);
      expect(LOCAL_DOOR_UNAVAILABLE_REASON).not.toMatch(/Ask whoever/);
      // The point of the change, pinned: no placeholder output is offered as a consolation.
      expect(LOCAL_DOOR_UNAVAILABLE_REASON).toMatch(/placeholder frames/);
    });

    it("uses bare dotted hook keys, never the capability: namespace", () => {
      for (const hook of GPU_ENGINE_HOOKS) expect(hook).not.toContain(":");
    });
  });

  it("cf#229 parity: score is REPORTED SERVABLE, because bed generation works here too", async () => {
    // THE PARITY THAT MATTERS IS THE SET AND THE BIAS, never the bytes. This studio has its own
    // reason string (it names VIDEO_FINISH_URL, because the reader is the operator), but if the two
    // panels disagreed about WHICH keys are unavailable, the same storyboard would light up
    // differently on the two doors -- and one of them would be lying. cf#229 removed score from the
    // hosted set because generation does not need the tier; the same is true here, so the same key
    // must be absent here.
    const host = await hostOf(GATEWAY_CONFIGURED);
    const named = Object.keys(host?.hooks_unavailable ?? {});
    for (const advisory of VIDEO_FINISH_ADVISORY_HOOKS) {
      expect(named, advisory + " RUNS on a studio with no video-finish tier").not.toContain(advisory);
    }
    // ...and the capability that IS absent is named, so the mux controls still have an honest key.
    expect(named).toContain(VIDEO_FINISH_CAPABILITY_KEY);
  });

  it("the capability key can never be mistaken for a hook name", () => {
    expect(VIDEO_FINISH_CAPABILITY_KEY).toMatch(/^capability:/);
    for (const hook of [...VIDEO_FINISH_GATED_HOOKS, ...VIDEO_FINISH_ADVISORY_HOOKS]) {
      expect(hook).not.toContain(":");
    }
  });

  it("a PARTIAL gateway config still reports unavailable", async () => {
    // Two of three is not configured. Reporting available here is the same broken-button class,
    // just harder to spot -- the picker would look right until the first plan.
    const host = await hostOf({ CLOUDFLARE_ACCOUNT_ID: "acct", GATEWAY_ID: "gw" });
    expect(host?.hooks_unavailable?.["plan.enhance"]).toBe(PLANNER_UNAVAILABLE_REASON);
  });

  it("the reason addresses THIS host's reader, with THIS host's knobs", async () => {
    // Parity is the feature with an honest answer per host, not identical bytes, and BOTH halves
    // differ for the same reason: the reader is a different person.
    //
    // Knobs: telling a self-hoster to set an `AI` binding names something their machine lacks.
    expect(PLANNER_UNAVAILABLE_REASON).toMatch(/CF_AIG_TOKEN/);
    expect(PLANNER_UNAVAILABLE_REASON).not.toMatch(/\bAI binding\b/);
    // Action: on a self-host door the reader IS the operator, so the instruction is given directly.
    // "Ask whoever operates this studio" is correct on the HOSTED door and tells a homelabber to go
    // ask themselves, so it is pinned ABSENT here rather than merely unasserted.
    expect(PLANNER_UNAVAILABLE_REASON).toMatch(/^Storyboard planning is unavailable/);
    expect(PLANNER_UNAVAILABLE_REASON).toMatch(/Set CLOUDFLARE_ACCOUNT_ID/);
    expect(PLANNER_UNAVAILABLE_REASON).not.toMatch(/Ask whoever/);
  });

  it("the SAME rule holds for the video-finish reason (cf#118, and it was broken once)", () => {
    // Enforced HERE, in the file that owns the local#226 rule, and not only in the cf#118 test:
    // the first cf#118 port shipped the hosted panel's tenant-facing wording to a self-host
    // operator, and a rule that lives only next to its newest instance does not catch the next one.
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).toMatch(/VIDEO_FINISH_URL/);
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).not.toMatch(/Ask whoever/);
    expect(VIDEO_FINISH_UNAVAILABLE_REASON).not.toMatch(/not yet provisioned/);
  });
});
