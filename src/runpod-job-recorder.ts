// HOST GLUE for the shared RunPod job-log recorder (local#415).
//
// ------------------------------------------------------------------------------------------------
// WHY THIS FILE EXISTS AS ITS OWN MODULE. It used to be the tail of src/runpod-job-log.ts. That file
// is now a POINTER at @skyphusion-labs/vivijure-core/runpod-job-log and its entire value is that it
// declares nothing, asserted on purpose in tests/runpod-job-log-reexport-local415.test.ts. A
// function declared beside the pointer would have been the first crack in exactly the file the drift
// fix was about, so the glue moved out rather than the guard being weakened to accommodate it.
//
// WHY IT IS NOT IN CORE, WHICH WAS THE OPEN QUESTION IN local#415. Measured across the estate
// 2026-09-26 (`gh search code --owner skyphusion-labs`): `runpodJobRecorder` appears in 3 files and
// `createModuleTransport` in 9, and ALL 12 are in vivijure-local. Zero in vivijure-cf, zero in
// vivijure-core. That is not an accident of naming, it is the architecture: on cf every module Worker
// holds its own D1 binding and calls `recordRunpodJob` directly from inside the module (measured: 15
// module workers do), so cf has no transport seam to inject a recorder into and would import this
// wrapper nowhere. Lifting it into core would put a host-shaped adapter into the shared contract
// with exactly one caller in the estate, which is the opposite of what moving the job log into core
// achieved. It stays here, as the ONE local-only wrapper over the shared implementation.
//
// WHY THE WRAPPER IS NEEDED AT ALL, i.e. why the call sites do not just call recordRunpodJob. See
// migrations/0016: on this door NO module can write the studio database (compose declares 25 module
// services, 9 mount studio-data READ-ONLY, the RunPod submitters mount nothing), so the STUDIO
// writes the row at the one seam every module call passes through, `createModuleTransport`. That seam
// takes a synchronous `(event) => void` sink, and the shared recorder is an async best-effort
// function. This adapts the one to the other, and nothing else.
//
// FIRE-AND-FORGET IS THE CONTRACT, NOT A SHORTCUT. `recordRunpodJob` resolves on every path and never
// throws, so `void`-ing it cannot delay or break a render; that guarantee is core's and is asserted
// there. The same two-seam shape as the core#52 metering wrapper, and for the same reason: a reload
// rebuilds the transport, so a recorder attached only at boot would silently stop recording the
// moment an operator saves connection settings. Both construction sites (src/server.ts and
// src/platform/reload.ts) therefore call this.
//
// It imports through ../runpod-job-log.js on purpose rather than reaching past it into the package:
// the host keeps ONE specifier for this contract, and a call site proving the pointer resolves is
// worth more than a second import path to maintain.
// ------------------------------------------------------------------------------------------------

import type { Database } from "./platform/types.js";
import { recordRunpodJob, type RunpodJobRecord } from "./runpod-job-log.js";

/** Adapt the shared best-effort recorder to the synchronous sink `createModuleTransport` wants. */
export function runpodJobRecorder(db: Database | undefined): (event: RunpodJobRecord) => void {
  return (event: RunpodJobRecord): void => {
    void recordRunpodJob(db, event);
  };
}
