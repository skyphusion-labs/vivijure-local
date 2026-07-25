// WHICH HOOKS DIE WHEN THE VIDEO-FINISH TIER IS ABSENT (cf#118).
//
// PARITY WITH vivijure-cf/src/video-finish-availability.ts, and parity means the SAME HOOK SET and
// the SAME absent-key-means-available bias -- NOT the same bytes. The reason string deliberately
// DIFFERS, because the reader differs: a hosted tenant cannot act on a binding they have no access
// to, and a self-hoster can. That is the local#226 rule; the first version of this file ignored it
// and shipped the tenant's wording to an operator. Change the SET on one panel, change both, same
// window; change the STRING and only the panel whose reader changed.
//
// On THIS panel `VIDEO_FINISH_VPC` is not a Workers binding but the fetcher `vpc-transport.ts`
// synthesizes when `VIDEO_FINISH_URL` is configured (the compose video-finish container). Same
// question either way: can this host reach the video-finish tier. A self-hoster who has not brought
// the container up gets exactly what a hosted tenant gets -- an honest degrade, said out loud.
//
// The panel needs to say so BEFORE a user spends a render on a capability this host cannot deliver,
// and it says it through the generic cf#98 channel (`host.hooks_unavailable` on GET /api/modules),
// never through a bespoke "is video finish available" branch in the frontend. One attribute on a
// control, one answer from the host.
//
// THE SET BELOW IS READ OFF THE EXECUTION PATHS, not off intuition, because both errors are bad in
// opposite ways: name too few hooks and the panel offers buttons that cannot deliver; name too many
// and it hides capability that works. What the film path actually does with no VIDEO_FINISH_VPC
// (core film-orchestrator):
//
//   assemble  -> `degradeAssembleUnavailable` sets `phase = "done"` DIRECTLY, with the comment "no
//                assembled film to finish/notify; the clips ARE the delivered render". There is no
//                assembled film, and `transitionToDone` never runs.
//   mux       -> never reached (it is downstream of assemble), so an audio bed can never be
//                attached to a film.
//
// Therefore:
//
//   score       the music bed is produced fine and can never reach the film. Undeliverable.
//   master      polishes that same bed. It masters something nothing can attach. Undeliverable.
//   film.finish NEVER RUNS. It is driven from `transitionToDone`, which the assemble degrade
//               bypasses entirely. Not "degraded" -- absent.
//   notify      NEVER FIRES, for the same reason: `fireNotify` is called only from
//               `transitionToDone`. This one was on nobody's list; it is here because the code says
//               so.
//
// And what is NOT here, deliberately: keyframe, motion.backend, finish, speech, dialogue,
// plan.enhance, image.generate, cast.image. All of those are PER-SHOT work, and per-shot clips are
// exactly what a VPC-less host delivers -- the clips carry their own finish and speech output. A
// panel that greyed those out would be lying in the other direction.
//
// Scope note: this describes the FILM path. A clips-only render is unaffected by construction, and
// the scatter path degrades through its own gates in the same family.

/**
 * The reason string, printed VERBATIM by the panel (cf#98 does not rewrite or soften it).
 *
 * DIFFERENT FROM THE HOSTED PANEL'S, ON PURPOSE (local#226, and Joan caught me re-breaking it). The
 * hosted string is written for a TENANT who cannot fix this and has no access to the binding, so it
 * names no knob. Here the reader IS the operator: they own the machine, the knob is theirs, and a
 * string that withholds it is the "go ask yourself" failure with the asking removed.
 *
 * It names VIDEO_FINISH_URL specifically because this is the one case where the local reader has a
 * concrete, likely-diagnosable cause: `video-finish` is a DEFAULT service in the shipped compose
 * stack and compose.yaml already sets the variable, so a studio reaching this line has most likely
 * dropped or misconfigured a container it was given. "Not yet provisioned for this studio" would
 * tell that person nothing at all.
 *
 * Both halves the hosted string gets right are kept: it says what they DO still get (so
 * "unavailable" does not read as broken), and it stays generic about the panel.
 */
export const VIDEO_FINISH_UNAVAILABLE_REASON =
  "Video finishing is unavailable on this studio because the video-finish tier is not configured; " +
  "finished renders deliver as per-shot clips. Set VIDEO_FINISH_URL (the video-finish container in " +
  "the default compose stack) to enable it.";

/** Hooks whose product cannot be delivered without the video-finish tier. See the header. */
export const VIDEO_FINISH_GATED_HOOKS = ["score", "master", "film.finish", "notify"] as const;

/**
 * `{}` when the tier is present -- ABSENT KEY MEANS AVAILABLE, and that bias is load-bearing: a
 * deploy that binds the tier must report nothing at all, so the panel's positive control is a real
 * observation rather than the absence of a field nobody sets.
 */
export function videoFinishHooksUnavailable(env: { VIDEO_FINISH_VPC?: unknown }): Record<string, string> {
  if (env.VIDEO_FINISH_VPC) return {};
  return Object.fromEntries(VIDEO_FINISH_GATED_HOOKS.map((h) => [h, VIDEO_FINISH_UNAVAILABLE_REASON]));
}
