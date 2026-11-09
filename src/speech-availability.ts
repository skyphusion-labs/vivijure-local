// local#515: the parity half of vivijure-cf#904. `speech` is reported in host.hooks_unavailable
// whenever nothing installed serves it.
//
// THE FAILURE THIS CLOSES. GET /api/modules lists `speech` in core's static catalog ("clean /
// enhance dialogue audio"). On the default compose profile nothing serves it: the
// `module-speech-upscale` sidecar runs only under the `cloud` or `satellites` profile and
// MODULE_SPEECH_UPSCALE_URL is unset (docs/install-profiles.md). So the panel offered a stage that
// could not run, and the per-stage speech degrade key could never be written, because the stage
// never ran.
//
// SAME CHANNEL, SAME BIAS AS cf (src/providerless-hooks.ts there). The entry is DERIVED from the
// discovered modules, so it clears itself the moment a module serving `speech` is discovered, with
// no code change. The catalog keeps the hook: dropping it would remove it for a third-party module
// too. Absent key means available.
//
// WHERE THIS DIFFERS FROM cf, ON PURPOSE. cf has no first-party speech provider at all (cf#786 removed
// speech-upscale), so cf calls the hook "providerless". This door DOES ship one (local#383), it is
// just not running on the default profile. So the question here is the one cf's code already asks,
// "does any discovered module serve it", without cf's claim that nothing in the tree can. And the
// reason is written for an OPERATOR, the local#226 rule: the reader owns the box, so the string
// names the knob. Parity is the set and the bias, not the bytes.
//
// WHY ONLY `speech` AND NOT EVERY EMPTY HOOK, as on cf: an optional stage an operator has not
// installed (a finish module, say) is already rendered as a skipped stage. `speech` is listed because
// it is the one catalog hook the default install advertises and cannot serve, which is cf#904's case.

import { servingForHook, type RegisteredModule } from "@skyphusion-labs/vivijure-core";

/** Printed verbatim by the panel (core#98). Says what the user still gets, then what to set. */
export const SPEECH_UNAVAILABLE_REASON =
  "No speech module is running on this studio, so dialogue clean-up is skipped and dialogue audio " +
  "is used as generated. To clean dialogue on your own box, start the module-speech-upscale sidecar " +
  "(compose profile `satellites`), set MODULE_SPEECH_UPSCALE_URL=http://module-speech-upscale:9143, " +
  "and point LOCAL_FINISH_SPEECH_URL at your speech door (docs/install-profiles.md).";

/** `{}` when a discovered module serves `speech`. Pass the ALREADY-FILTERED module list, so a module
 *  that self-reports `configured: false` has been dropped and cannot mask the gap. */
export function speechHooksUnavailable(modules: RegisteredModule[]): Record<string, string> {
  return servingForHook(modules, "speech").length === 0 ? { speech: SPEECH_UNAVAILABLE_REASON } : {};
}
