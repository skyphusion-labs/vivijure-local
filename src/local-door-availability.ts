// WHICH HOOKS DIE WHEN NO GPU ENGINE IS INSTALLED (local#229, local#280).
//
// Companion to src/video-finish-availability.ts, on the SAME channel (`host.hooks_unavailable` on
// GET /api/modules, core#98 / core v1.2.14). One attribute on a control, one answer from the host --
// not a second bespoke wire for "is there a GPU".
//
// THIS IS SELF-DESCRIPTION, NOT A SHIM, and the distinction is the whole point of local#280. Conrad
// rejected the first version of that fix because it kept a local-gpu container running just to answer
// `configured: false` about itself. Nothing here does that. This module never starts a process, never
// synthesizes a module entry, and never speaks on an absent module's behalf: it reads the host's OWN
// composition -- the registry the host built from its MODULE_*_URL bindings -- and reports which hooks
// that composition leaves unserved. A host describing its own capabilities is exactly what core
// v1.2.14 added this channel for.
//
// WHY IT IS STILL NEEDED once the module is gated out of the stack. Removing the container removes the
// fabrication and the fake advertisement, but a panel with no keyframe engine would still render
// motion and keyframe controls whose every option 400s at submit -- the local#201 broken-button class.
// Composition is the host's knowledge, so the host is the right one to say it, once, before a render
// is spent.
//
// DERIVED FROM THE DISCOVERED MODULES, NOT FROM ENV, and that is load-bearing. Reading
// LOCAL_BACKEND_URL here would report "no keyframe engine" on a studio running the `cloud` profile
// with RunPod credentials, which serves both hooks perfectly well -- over-claiming, the failure
// direction that hides working capability (the same trap video-finish-availability.ts documents for
// VIDEO_FINISH_VPC). The honest question is not "is the local door configured" but "does ANY installed
// module serve this hook".
//
// It does NOT depend on anything self-reporting. With the localgpu lane off there is no
// MODULE_LOCAL_GPU_URL, so moduleUrlsFromEnv builds no binding and core discovery never sees the
// module -- the gap is a real hole in the registry, not a module that asked to be hidden. The
// `configured: false` filter (local#201) still covers the RunPod sidecars, which are a different case:
// those are cloud modules whose credentials, not their existence, are optional.
//
// "There is no MODULE_LOCAL_GPU_URL" is a claim about the MERGED env (platform_secrets over
// process.env, DB winning), not about .env, and local#281 is what made the two agree: the key is
// derived, so nothing seeds a stored copy, sync purges an unset one, and migration 0015 removed the
// row every pre-local#280 studio carried. Before that the lane-off invariant held on a fresh install
// and failed on an upgraded one. This function stays honest either way -- it reads the DISCOVERED
// modules, and an unreachable binding is dropped by core discovery -- but it would have been reporting
// the gap correctly while the studio paid three failed manifest reads per discovery to find it.
//
// ABSENT KEY MEANS AVAILABLE, matching the video-finish twin: a host with any serving module reports
// nothing at all, so the panel's positive control is a real observation rather than a missing field.
//
// NOT MIRRORED TO vivijure-cf. The hosted panel has no GPU-door concept and no compose profiles; there
// is no twin and no parity obligation attaches (see local#229 scope note).

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
  "No GPU engine is installed on this studio, so keyframes and motion cannot be rendered here. To " +
  "render on your own card, run `npm run install:studio` and give it your GPU door address " +
  "(vivijure-local-16gb / -12gb) -- that enables the `localgpu` compose profile and sets " +
  "LOCAL_BACKEND_URL. To render in the cloud instead, enable the `cloud` profile with RunPod " +
  "credentials. Nothing is rendered with placeholder frames.";

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
