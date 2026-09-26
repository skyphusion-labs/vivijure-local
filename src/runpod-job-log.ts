// POINTER, NOT AN IMPLEMENTATION. The RunPod job log lives in vivijure-core (local#415, cf#475).
//
// ------------------------------------------------------------------------------------------------
// WHY THIS FILE IS ONE LINE. Every symbol that used to be declared here now lives at
// `@skyphusion-labs/vivijure-core/runpod-job-log`. This door was the LAST holder of a private copy:
// cf retired its own copy in cf#475 / cf#610 and said in as many words that the local half stayed
// open, because this table had no timing columns and core's upsert writes nine. migrations/0022 is
// that prerequisite, and it is why this change is two commits' worth of work in one ordered pass
// rather than a one-line edit.
//
// THE DRIFT THIS ENDS WAS MEASURED, NOT FEARED. Re-measured 2026-09-26 at `origin/main` against
// core 1.22.5, the private copy that stood here carried:
//
//   DETAIL_MAX 160, where cf#320 raised it to 480. cf#320 raised it because a validation refusal's
//     actionable tail (the path prefix that was wrong, the project that was expected) was exactly
//     what 160 chars cut, and recovering it forced an out-of-band RunPod /status lookup that may
//     already have aged out. Nobody chose to keep 160 here; the fix simply landed on the other copy.
//   No `unknown` outcome, so a job past RunPod's retention window could only be guessed at.
//   No RESOLVED_RUNPOD_OUTCOMES, so every query here had to re-derive which outcomes were OBSERVED,
//     and `terminal_at IS NOT NULL` kept reading as a completion predicate when it is not.
//   No timingFromStatus, no boundDetail, no DETAIL_TRUNCATION_MARKER, so a cut string here was
//     indistinguishable from a whole one.
//   No reconciler and no readiness probe at all.
//
// Two copies of one rule have no mechanism holding them together. That is the finding cp#321 made
// for `runpod-route.ts` and cf#403 made for the plane contract, and the remedy in both cases was NOT
// a sync check, because a sync check protects only the copy you kept. The remedy is: one
// implementation in core, every door imports it, and the survivor is asserted to declare nothing.
//
// WHY A RE-EXPORT RATHER THAN DELETING THE FILE AND REWRITING THE IMPORTS. Measured on this tree:
// three host files plus three test files import this specifier. A re-export is one file changed; the
// specifier every caller already writes keeps working, and `DETAIL_MAX` reaching
// src/platform/modules.ts through it is how the cf#320 bound arrives at the transport seam without
// touching that file at all.
//
// WHAT MUST NOT COME BACK. If you are about to add a `const`, a `function`, an `interface` or a
// `type` to this file, that is the duplicate this change removed, reappearing in the exact file that
// was fixed. Add it to core and let it flow through here.
// tests/runpod-job-log-reexport-local415.test.ts asserts this file declares nothing, and asserts
// IDENTITY rather than shape against core, because a re-forked copy with a matching surface passes
// every name-only comparison and IS the defect. An absence has to be asserted on purpose or nothing
// notices it decay.
//
// WHERE runpodJobRecorder WENT, since it used to live here. It is host-only glue (it adapts the
// shared recorder to the `createModuleTransport` seam this door has and cf does not), so it could
// not stay in a file whose whole value is holding nothing. It now lives in
// src/runpod-job-recorder.ts, which documents why it is not core's business.
//
// ONE TYPE NOTE, AND IT IS A NON-EVENT HERE. Core types the database handle as the platform
// `Database`. This host's src/platform/types.ts RE-EXPORTS that very type from core, so it is the
// same type by identity and not merely a structural match; every existing call site typechecks
// unchanged.
// ------------------------------------------------------------------------------------------------

export * from "@skyphusion-labs/vivijure-core/runpod-job-log";
