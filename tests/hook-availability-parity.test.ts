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

function platformWith(vars: Record<string, string>): Platform {
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
    modules: new NoModules(),
    vars: { AUTH_MODE: "token", STUDIO_API_TOKEN: SECRET, ...vars },
    // Built the way BOOT builds it: server.ts calls applyRuntimeEnvToPlatform, which sets
    // hostBindings from the runtime env (VIDEO_FINISH_URL -> the video-finish fetcher). A fixture
    // that only set `vars` would leave hostBindings undefined and make every studio look like it
    // lacks the tier -- which is exactly the over-claim the cf#118 check must not make.
    hostBindings: buildVpcHostBindings(vars as NodeJS.ProcessEnv),
  } as unknown as Platform;
}

async function hostOf(vars: Record<string, string>): Promise<ModulesResponse["host"]> {
  const app = createApp(testSettingsHost(platformWith(vars)));
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
    const host = await hostOf(FULLY_CONFIGURED);
    expect(host?.hooks_unavailable).toBeUndefined();
  });

  it("reports the VIDEO-FINISH hooks when only that tier is missing (cf#118)", async () => {
    // The gateway is configured, so plan.enhance is fine and anything reported here can ONLY have
    // come from the video-finish gate -- which is what makes this a test of that gate rather than a
    // test that something, somewhere, is unavailable.
    const host = await hostOf(GATEWAY_CONFIGURED);
    expect(Object.keys(host?.hooks_unavailable ?? {}).sort()).toEqual([
      "film.finish",
      "master",
      "notify",
      "score",
    ]);
    expect(host?.hooks_unavailable?.["plan.enhance"]).toBeUndefined();
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
});
