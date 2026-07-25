// WHICH HOOKS DIE WHEN THE VIDEO-FINISH TIER IS ABSENT (cf#118).
//
// PARITY COPY of vivijure-cf/src/video-finish-availability.ts: same hook set, same reason string,
// same absent-key-means-available bias. The panels share no runtime module, and this is a PROMISE to
// the reader of the UI, so it is kept identical deliberately. Change one, change both, same window.
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
 * Written for the person who will read it: a hosted TENANT, who cannot fix this and should not be
 * told to set a binding they have no access to. The action is "ask whoever runs this studio", and
 * the sentence also says what they DO get, because "unavailable" alone reads as broken.
 */
export const VIDEO_FINISH_UNAVAILABLE_REASON =
  "Video finishing is not yet provisioned for this studio; finished renders deliver as per-shot clips.";

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
