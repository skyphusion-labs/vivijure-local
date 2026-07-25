// local#223 (cf#224 gate 3): the keyframe sidecar is the ONE module that falls back to the dev GPU
// mock when RunPod is unconfigured, and it was the one module the local#201 configured-filter could
// not see. The old composition routed EVERY path (`app.all("*")`) to the mock, including
// `/module.json`; the mock serves the raw manifest, `configured` is absent, and absent means "always
// keep" by design. Net: a bare no-RunPod homelab was offered "GPU Keyframe (SDXL on RunPod)" and got
// mock output -- a silent substitution that reads as a successful render.
//
// The fix (gate 3: HIDE when unconfigured, no relabel, no mock output to users): the MANIFEST is
// always served by the RunPod app, so `configured` is honest, and an uncredentialed keyframe module
// is dropped at the registry choke point exactly like every other RunPod module. Only non-manifest
// paths still fall back to the mock, which keeps the mock reachable as a direct dev affordance
// while making it unreachable through the panel (a hidden module is neither visible nor
// submittable; see src/module-registry.ts).
//
// Both branches read configured through the SAME predicate (`runpodModuleConfigured`) so the
// manifest`s honesty and the routing decision cannot drift apart.
import { Hono } from "hono";
import type { ArtifactStore } from "../../platform/create-storage.js";
import { createGpuMockModuleApp } from "../dev/gpu-mock-app.js";
import { createRunpodModuleApp } from "./app.js";
import type { RunpodModuleEnv } from "./env.js";
import { runpodModuleConfigured } from "./handlers.js";

export function createKeyframeSidecarApp(
  manifest: Record<string, unknown>,
  getEnv: () => Promise<RunpodModuleEnv>,
  mockStore: ArtifactStore,
): Hono {
  const mockApp = createGpuMockModuleApp(manifest, "keyframe", mockStore);
  const runpodApp = createRunpodModuleApp(manifest, "keyframe", getEnv);
  const app = new Hono();

  // Registered FIRST so it wins over the catch-all below: the manifest never comes from the mock.
  app.get("/module.json", (c) => runpodApp.fetch(c.req.raw, c.env));

  app.all("*", async (c) => {
    const target = runpodModuleConfigured(await getEnv(), "keyframe") ? runpodApp : mockApp;
    return target.fetch(c.req.raw, c.env);
  });

  return app;
}
