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

/** Closed-set fault outcomes a module poll may declare on the envelope (local#304 hard fail;
 *  local#307 soft-degrade). ONE set, read by both callers below, so the vocabulary cannot drift
 *  between the two paths. Anything else is ignored so a hostile value cannot widen it. */
const POLL_OUTCOMES = new Set<RunpodJobOutcome>(["backend-error", "failed", "gone", "cancelled"]);

/**
 * Explicit closed-set fault outcome on a poll envelope, or undefined when absent/hostile.
 * Never invents from `error` prose. Used on BOTH ok:true soft-degrades (local#307) and ok:false
 * hard fails: the chain may still complete while the RunPod job failed. The ok:true path NEEDS the
 * undefined case, because "no marker" there means completed, not failed.
 */
export function declaredPollOutcome(body: Record<string, unknown>): RunpodJobOutcome | undefined {
  const declared = body.outcome;
  if (typeof declared === "string" && POLL_OUTCOMES.has(declared as RunpodJobOutcome)) {
    return declared as RunpodJobOutcome;
  }
  return undefined;
}

/** Read structured outcome off a poll envelope on the HARD-FAIL (ok:false) path. Never parse
 *  `error` prose. Always resolves: an absent marker falls back to the cf#298 legacy runpodStatus
 *  read, and otherwise `failed` (local#304). */
export function pollOutcomeFromEnvelope(body: Record<string, unknown>): RunpodJobOutcome {
  // cf#298 legacy path: markers without outcome still distinguish CANCELLED.
  return declaredPollOutcome(body) ?? (body.runpodStatus === "CANCELLED" ? "cancelled" : "failed");
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
      // cf#288: the fault CLASS, read from the STRUCTURED marker the module poll now carries. Never
      // derived from `error`, which is prose. Absent stays absent: the recorder writes NULL, and NULL
      // means "the endpoint did not tell us", never "this was not a refusal".
      const errorType = typeof body.errorType === "string" && body.errorType ? body.errorType : undefined;
      // detail: prefer the additive `detail` marker (soft-degrade, local#307); fall back to `error`
      // prose on hard fails. Never invent from output.degraded (that is studio-facing copy).
      const detail =
        typeof body.detail === "string"
          ? body.detail.slice(0, DETAIL_MAX)
          : typeof body.error === "string"
            ? body.error.slice(0, DETAIL_MAX)
            : undefined;

      if (ok) {
        // local#307: an honest soft-degrade returns ok:true so the chain keeps the original audio,
        // but the RunPod job itself failed/gone/backend-errored. Record THAT fact, not completed.
        // no-output-key and other non-RunPod shortfalls omit `outcome` and stay completed.
        const softFault = declaredPollOutcome(body);
        if (softFault) {
          this.recorder({ ...job, outcome: softFault, detail, errorType });
          return;
        }
        this.recorder({ ...job, outcome: "completed" });
        return;
      }
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
