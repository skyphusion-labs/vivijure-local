// HTTP sidecar transport for module workers.
//
// Each MODULE_* binding maps to MODULE_<NAME>_URL (e.g. MODULE_KEYFRAME_URL=http://127.0.0.1:9101).
// The sidecar must expose /module.json, /invoke, /poll, /cancel like a CF Worker module.
//
// THIS IS ALSO THE RUNPOD TELEMETRY SEAM (local#294). Every studio-to-module call passes through
// resolve(), so the recorder is attached HERE rather than at a call site: a writer a future refactor
// can bypass will eventually be bypassed. It is wired inside createModuleTransport so that BOTH
// construction sites (src/server.ts and src/platform/reload.ts) get it and a third one cannot miss it.

import type { FetcherLike, ModuleTransport } from "./types.js";
import { HttpFetcher } from "./http-fetcher.js";
import { DETAIL_MAX, type RunpodJobOutcome } from "../runpod-job-log.js";
import { degradeReasonOf } from "../degrade-reason.js";

/** Parse MODULE_FOO_URL env vars into binding -> base URL. */
export function moduleUrlsFromEnv(env: NodeJS.ProcessEnv): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MODULE_") || !key.endsWith("_URL") || !value) continue;
    const binding = key.slice(0, -"_URL".length);
    map.set(binding, value.replace(/\/$/, ""));
  }
  return map;
}

export interface ModuleJobEvent {
  jobId: string;
  module: string;
  outcome: RunpodJobOutcome;
  submittedAtMs?: number;
  detail?: string;
  /** cf#288: the fault CLASS, carried across the envelope by the module poll because the studio
   *  never sees the RunPod /status payload. Absent means the endpoint did not report one. */
  errorType?: string;
}

/** Sink for job events. MUST NOT throw: the transport calls it inside a try, but a sink that throws
 *  synchronously on every call would still be a defect in the sink. */
export type ModuleJobRecorder = (event: ModuleJobEvent) => void;

/** MODULE_FINISH_UPSCALE -> finish-upscale. Derived from the BINDING, not from the module manifest:
 *  the studio does not read a manifest on the invoke path, and the binding is what it actually has.
 *  These agree for every current module except where a binding name is deliberately compressed
 *  (MODULE_PLANENHANCE serves module-plan-enhance), so a label here can differ from the manifest name.
 *  Recorded rather than hidden: the column is a machine label for grouping, not an identifier to join
 *  against manifests. */
export function moduleLabelFromBinding(binding: string): string {
  return binding.replace(/^MODULE_/, "").toLowerCase().replace(/_/g, "-");
}

/** Closed terminal outcomes the module poll may declare (local#304). Anything else falls back. */
const POLL_OUTCOMES = new Set<RunpodJobOutcome>(["backend-error", "failed", "gone", "cancelled"]);

/** Read structured outcome off a poll envelope. Never parse `error` prose. */
export function pollOutcomeFromEnvelope(body: Record<string, unknown>): RunpodJobOutcome {
  const declared = body.outcome;
  if (typeof declared === "string" && POLL_OUTCOMES.has(declared as RunpodJobOutcome)) {
    return declared as RunpodJobOutcome;
  }
  // cf#298 legacy path: markers without outcome still distinguish CANCELLED.
  if (body.runpodStatus === "CANCELLED") return "cancelled";
  return "failed";
}

/** local#307: degrade reasons that name a RUNPOD FAULT, and the outcome each one IS.
 *
 * THE DEFECT THIS CLOSES. An honest soft-degrade returns `ok: true` -- correctly, because
 * speech-upscale is a polish step and a polish miss must not fail the chain (local#249/#77). The
 * CHAIN did complete. The runpod_job_log ROW is about the RUNPOD JOB, and on these three branches that
 * job did NOT complete: it was GC-ed, it reported FAILED, or it stalled with a terminal error in its
 * output. Recording them as `completed` made a failure rate computed off this table undercount by
 * exactly the degrade population, which is the population an operator most wants to count, and it did
 * so in the REASSURING direction.
 *
 * WHAT IS DELIBERATELY ABSENT FROM THIS MAP, because absence here is a claim too:
 *
 *   - `no-output-key` -- RunPod reported COMPLETED and named no output key. The job finished; the
 *     shortfall is OURS. Recording it as a backend failure would be the same class of lie pointing the
 *     other way, so it stays `completed`. tests/runpod-degrade-outcome-307.test.ts asserts that
 *     explicitly rather than leaving it to the fallthrough.
 *   - `local-door-unconfigured-mid-job` -- the operator unset LOCAL_FINISH_SPEECH_URL while the job was
 *     in flight, so the studio stopped being able to OBSERVE the job; the door never reported a fault.
 *     It is neither a RunPod fault nor an honest completion, and naming it correctly needs a value the
 *     closed outcome set does not have. Left at `completed` (unchanged behaviour) and filed rather than
 *     guessed; a new value goes to BOTH doors together (cf#286), never to one.
 *
 * PARITY: these are cf's outcomes for the same three events, so a cross-door query cannot need two
 * vocabularies. */
const DEGRADE_FAULT_OUTCOMES = new Map<string, RunpodJobOutcome>([
  ["endpoint-gone", "gone"],
  ["endpoint-failed", "failed"],
  ["endpoint-error", "backend-error"],
]);

/** Read a RunPod-fault degrade off an `ok: true` poll envelope, or return null.
 *
 * STRUCTURED, not prose: the reason token comes from degradeReasonOf, whose only counterpart is the
 * formatDegrade that WROTE the string (src/degrade-reason.ts). `error` is never consulted here.
 *
 * Returns null for a genuine success (no `degraded` at all) AND for a degrade that is not a RunPod
 * fault. Both keep `completed`, which is the honest answer for both. */
export function degradeFaultFromEnvelope(
  body: Record<string, unknown>,
): { outcome: RunpodJobOutcome; detail: string } | null {
  const output = body.output;
  if (!output || typeof output !== "object") return null;
  const degraded = (output as Record<string, unknown>).degraded;
  const reason = degradeReasonOf(degraded);
  if (!reason) return null;
  const outcome = DEGRADE_FAULT_OUTCOMES.get(reason);
  if (!outcome) return null;
  // The whole `degraded` value is the detail: reason plus whatever the handler could say about it,
  // bounded exactly as an error detail is. No errorType -- a degrade carries no structured fault
  // class, and NULL means "not told", which must stay distinguishable from "told, and not a refusal".
  return { outcome, detail: String(degraded).slice(0, DETAIL_MAX) };
}

/** How many in-flight poll tokens to remember. A submit is correlated to its terminal outcome through
 *  the opaque poll token, because the module poll RESPONSE carries no job id and decoding the token
 *  studio-side would couple the studio to module-internal token formats.
 *
 *  CONSEQUENCE, and it is a real limit: this map is in memory, so a terminal outcome whose submit
 *  happened in a PREVIOUS studio process cannot be attributed. That row keeps outcome submitted with
 *  terminal_at NULL, which is honest (unknown stays unknown) rather than fabricated. */
const MAX_TRACKED_JOBS = 500;

interface TrackedJob {
  jobId: string;
  module: string;
  submittedAtMs: number;
}

export class HttpModuleTransport implements ModuleTransport {
  private readonly tracked = new Map<string, TrackedJob>();

  constructor(
    private readonly urls: Map<string, string>,
    private readonly recorder?: ModuleJobRecorder,
  ) {}

  resolve(binding: string): FetcherLike | null {
    const base = this.urls.get(binding);
    if (!base) return null;
    const fetcher = new HttpFetcher(base);
    if (!this.recorder) return fetcher;
    return this.recording(fetcher, moduleLabelFromBinding(binding));
  }

  listBindings(): string[] {
    return [...this.urls.keys()].sort();
  }

  /** Wrap a fetcher so /invoke and /poll responses are observed. NOTHING here may change what the
   *  caller receives, delay it, or throw: the response handed back is the original object, and every
   *  observation runs on a CLONE inside a try. */
  private recording(inner: FetcherLike, moduleLabel: string): FetcherLike {
    const self = this;
    return {
      async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
        const url = String(typeof input === "string" ? input : input.url);
        const isInvoke = url.includes("/invoke");
        const isPoll = url.includes("/poll");
        let sentToken: string | null = null;
        if (isPoll) sentToken = await readPollToken(input, init);
        const res = await inner.fetch(input, init);
        try {
          if (isInvoke || isPoll) {
            const clone = res.clone();
            void clone
              .json()
              .then((body) => self.observe(moduleLabel, isInvoke, sentToken, body as Record<string, unknown>))
              .catch(() => undefined);
          }
        } catch {
          // A body that cannot be cloned is not a reason to affect the caller.
        }
        return res;
      },
    } as FetcherLike;
  }

  private observe(
    moduleLabel: string,
    isInvoke: boolean,
    sentToken: string | null,
    body: Record<string, unknown>,
  ): void {
    try {
      if (!this.recorder) return;
      const ok = body.ok === true;
      const pending = body.pending === true;
      if (isInvoke) {
        const jobId = typeof body.jobId === "string" ? body.jobId : "";
        if (!ok || !jobId) return; // not a RunPod submit; nothing to record
        const submittedAtMs = Date.now();
        const poll = typeof body.poll === "string" ? body.poll : null;
        if (poll) this.track(poll, { jobId, module: moduleLabel, submittedAtMs });
        this.recorder({ jobId, module: moduleLabel, outcome: "submitted", submittedAtMs });
        return;
      }
      if (pending) return; // still running; the open row already says so
      if (!sentToken) return; // cannot attribute this terminal to a job id; record nothing
      const job = this.tracked.get(sentToken);
      if (!job) return; // submit happened in a previous process (see MAX_TRACKED_JOBS)
      this.tracked.delete(sentToken);
      if (ok) {
        // local#307: `ok: true` is not the same as "the RunPod job completed". An honest soft-degrade
        // is ok:true by design, and three of its reasons ARE RunPod faults. Read the structured reason
        // off the degrade envelope; anything else (a real success, or a degrade that is not a backend
        // fault) still records completed.
        const fault = degradeFaultFromEnvelope(body);
        if (fault) {
          this.recorder({ ...job, outcome: fault.outcome, detail: fault.detail });
          return;
        }
        this.recorder({ ...job, outcome: "completed" });
        return;
      }
      const detail = typeof body.error === "string" ? body.error.slice(0, DETAIL_MAX) : undefined;
      // cf#288: the fault CLASS, read from the STRUCTURED marker the module poll now carries. Never
      // derived from `error`, which is prose. Absent stays absent: the recorder writes NULL, and NULL
      // means "the endpoint did not tell us", never "this was not a refusal".
      const errorType = typeof body.errorType === "string" && body.errorType ? body.errorType : undefined;
      // local#304: prefer the closed-set `outcome` the module poll already computed (gone /
      // backend-error / failed / cancelled). Fall back to runpodStatus for CANCELLED (cf#298) and
      // otherwise `failed`. Never derive outcome from the English `error` string.
      const outcome = pollOutcomeFromEnvelope(body);
      this.recorder({ ...job, outcome, detail, errorType });
    } catch {
      // Telemetry must never affect a render.
    }
  }

  private track(token: string, job: TrackedJob): void {
    if (this.tracked.size >= MAX_TRACKED_JOBS) {
      const oldest = this.tracked.keys().next();
      if (!oldest.done) this.tracked.delete(oldest.value);
    }
    this.tracked.set(token, job);
  }
}

/** Read the poll token from an outgoing /poll request WITHOUT consuming the body the caller sends.
 *  A Request is cloned; a string init body is read directly. Returns null when it cannot be read,
 *  which costs one terminal attribution and never costs a render. */
async function readPollToken(input: Request | string, init?: RequestInit): Promise<string | null> {
  try {
    let raw: string | null = null;
    if (typeof input !== "string") raw = await input.clone().text();
    else if (typeof init?.body === "string") raw = init.body;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { poll?: unknown };
    return typeof parsed.poll === "string" ? parsed.poll : null;
  } catch {
    return null;
  }
}

export function createModuleTransport(
  env: NodeJS.ProcessEnv,
  recorder?: ModuleJobRecorder,
): HttpModuleTransport {
  return new HttpModuleTransport(moduleUrlsFromEnv(env), recorder);
}
