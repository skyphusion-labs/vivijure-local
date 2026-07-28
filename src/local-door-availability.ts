// WHICH HOOKS DIE WHEN NO GPU DOOR IS CONFIGURED (local#229).
//
// Companion to src/video-finish-availability.ts, on the SAME channel (`host.hooks_unavailable` on
// GET /api/modules, core#98 / core v1.2.14). One attribute on a control, one answer from the host --
// not a second bespoke wire for "is there a GPU".
//
// WHY THIS EXISTS. Until local#229 a bare `compose up` (no LOCAL_BACKEND_URL, no RunPod) still
// offered "Local GPU Keyframe (SDXL on your own card)" and served the dev mock: a 1x1 PNG per
// keyframe, a black clip per shot, reported COMPLETED. Deleting the mock is the fix, but deletion
// alone would leave the OTHER failure shape -- a panel that offers motion and keyframe controls
// whose every option 400s at submit, the local#201 broken-button class. So the host now says the
// hooks are unavailable, with the knob named, BEFORE a render is spent.
//
// DERIVED FROM THE DISCOVERED MODULES, NOT FROM ENV, and that is load-bearing. Reading
// LOCAL_BACKEND_URL here would report "no keyframe engine" on a studio running the `cloud` profile
// with RunPod credentials, which serves both hooks perfectly well -- over-claiming, the failure
// direction that hides working capability (the same trap video-finish-availability.ts documents for
// VIDEO_FINISH_VPC). The honest question is not "is the local door configured" but "does ANY
// installed module still serve this hook", asked after `discoverConfiguredModules` has dropped
// everything that self-reports `configured: false`.
//
// ABSENT KEY MEANS AVAILABLE, matching the video-finish twin: a host with any serving module reports
// nothing at all, so the panel's positive control is a real observation rather than a missing field.
//
// NOT MIRRORED TO vivijure-cf. The hosted panel has no GPU-door concept and no configured-filter;
// there is no twin and no parity obligation attaches (see local#229 scope note).

import { servingForHook, type RegisteredModule } from "@skyphusion-labs/vivijure-core";
import type { HookName } from "@skyphusion-labs/vivijure-core/modules/types";

/**
 * Printed VERBATIM by the panel (core#98 does not rewrite or soften it).
 *
 * Written for an OPERATOR, not a tenant: the reader owns the machine and the knob is theirs, so the
 * string names it. Same local#226 rule the video-finish reason follows -- a self-hoster who is told
 * only "unavailable" has been handed a "go ask yourself".
 *
 * It says what is NOT happening as well as what to set, because the whole point of local#229 is that
 * the previous behaviour was to quietly produce something. An operator who liked the old GPU-less
 * "demo" needs to know it is gone deliberately, not broken.
 */
export const LOCAL_DOOR_UNAVAILABLE_REASON =
  "No GPU engine is installed on this studio: no local door and no cloud module is configured, so " +
  "keyframes and motion cannot be rendered here. Set LOCAL_BACKEND_URL to your GPU door " +
  "(vivijure-local-12gb / -16gb) to render locally, or enable the optional `cloud` compose profile " +
  "with RunPod credentials. Nothing is rendered with placeholder frames.";

/** The hooks a GPU engine is the sole provider of. Read off the module manifests, not intuition. */
export const GPU_ENGINE_HOOKS = ["keyframe", "motion.backend"] as const;

/**
 * `{}` when some installed module still serves the hook. Pass the ALREADY-FILTERED module list (the
 * output of `discoverConfiguredModules`), so a module that self-reports `configured: false` has
 * already been dropped and cannot mask the gap.
 */
export function localDoorHooksUnavailable(modules: RegisteredModule[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const hook of GPU_ENGINE_HOOKS) {
    if (servingForHook(modules, hook as HookName).length === 0) {
      out[hook] = LOCAL_DOOR_UNAVAILABLE_REASON;
    }
  }
  return out;
}
