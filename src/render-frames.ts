// local#311 (cf#322 / cf PR #324 twin): make a rendered clip VISIBLE, by turning it into an artifact
// the transport can carry.
//
// WHY THIS EXISTS. The MCP tool-result content union carries exactly two variants, text and image, and
// has no video variant, so a finished film can only ever be handed to an agent as a LINK -- an agent
// asked to judge render quality has nothing to look at. cf#322 measured this on the hosted door: 128 of
// the 129 most recent COMPLETED renders carry `keyframes: null`, so the mp4 is the only artifact that
// exists for them. The one artifact type produced is the one type the transport cannot carry.
//
// So we produce one: sample frames out of the clip, tile them into ONE jpeg, write it to storage as a
// NORMAL artifact, and return the KEY, never the bytes. `view_artifact` fetches `GET /api/artifact/<key>`
// once vivijure-mcp is installed on this door, and `artifact_url`/`/api/artifact-url` (local#309) reach
// it too, so a key means every existing surface picks the sheet up with no new capability from any of
// them.
//
// WHAT A CONTACT SHEET PROVES, AND WHAT IT DOES NOT (verbatim from cf#324, the claim does not change
// per door). It is evidence about the frames it sampled, not about the clip. It can show composition,
// lighting, and whether the subject is on-model. Sampling across the clip additionally exposes drift,
// identity change between shots, and the degenerate still-image-with-a-timestamp case, which a single
// frame structurally cannot. It still cannot show per-frame flicker or motion judder between the
// samples. Nothing built on this may describe a clip as "checked"; the honest claim is "N frames sampled
// at these timestamps looked like this".
//
// WHY THIS DOES NOT REUSE `callVideoFinish` (vivijure-core/film-orchestrator.ts, shared by both panels).
// That caller collapses "tier unbound", "container answered 404", "container unreachable" and
// "container answered but failed" into a bare `Response | null` and leaves the distinction to whatever
// reads the Response later -- exactly the collapse cf#286/#288 exist to remove elsewhere in the stack.
// Each state implies a different operator action, most importantly `route-not-served`, which is EXPECTED
// during a rollout window and must say so or an operator goes hunting a bug that does not exist.
import { notFound, badRequest } from "./errors.js";
import { json, readBody } from "./http.js";
import { isSafeRelKey } from "./shared.js";
import { ARTIFACT_PREFIXES } from "./artifacts.js";
import type { FetcherLike, Platform } from "./platform/types.js";

export const FRAMES_MIN_COUNT = 1;
export const FRAMES_MAX_COUNT = 25;
export const FRAMES_DEFAULT_COUNT = 9;
/** The source clip is presigned for the container to GET, and the sheet for it to PUT. Both are
 *  capability credentials handed to a container on the operator's own compose network, so they are
 *  short-lived: long enough to move a clip and a jpeg, not long enough to be worth capturing. */
export const FRAMES_PRESIGN_TTL_SECONDS = 900;

/** Frames are stored as jpeg DELIBERATELY. `safeArtifactContentType` (src/artifacts.ts) remaps anything
 *  outside its allowlist to application/octet-stream, and MCP image-inlining only accepts /^image\//.
 *  image/jpeg is inside that allowlist, so the sheet survives the remap and is actually displayable.
 *  This constant and the container's PUT header must agree; both are asserted against the REAL exported
 *  guard in tests/render-frames-311.test.ts, not a transcribed copy of the regex. */
export const FRAMES_CONTENT_TYPE = "image/jpeg";

export interface FramesGrid {
  cols: number;
  rows: number;
}

/** Square-ish grid for n samples: 9 -> 3x3, 4 -> 2x2, 6 -> 3x2. Logic-identical to cf's gridFor(). */
export function gridFor(count: number): FramesGrid {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** Clamp a caller-supplied sample count into the allowed band. Absent/blank/garbage -> the default;
 *  never throws, mirroring clampArtifactUrlTtl (src/artifacts.ts) -- a bad count is worth ignoring, not
 *  failing a read over. */
export function clampFrameCount(raw: string | null): number {
  if (raw === null || raw.trim() === "") return FRAMES_DEFAULT_COUNT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return FRAMES_DEFAULT_COUNT;
  return Math.min(FRAMES_MAX_COUNT, Math.max(FRAMES_MIN_COUNT, Math.floor(n)));
}

/** Parse the single-frame timestamp. Only meaningful when count === 1; null means "let the container
 *  pick the midpoint", which it can do because only it knows the duration. Negative/garbage -> null. */
export function parseFrameAt(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** The output key, derived DETERMINISTICALLY from the source key and the sample spec, so a repeat
 *  request is idempotent and can be served straight from storage without touching the container.
 *
 *  The derived key keeps the source key's own directory and therefore its top-level prefix BY
 *  CONSTRUCTION: `renders/film-x/film.mp4` -> `renders/film-x/frames/film-3x3.jpg`. That is what keeps
 *  it inside ARTIFACT_PREFIXES and reachable through `/api/artifact` and `/api/artifact-url` at all --
 *  a key built from a fixed literal prefix would read fine and 404 through both routes while every unit
 *  test still passed. Inheriting the prefix means the derived key is inside the set whenever the source
 *  was, which the guard has already enforced. Logic-identical to cf's deriveFramesKey(). */
export function deriveFramesKey(sourceKey: string, count: number, at: number | null): string {
  const slash = sourceKey.lastIndexOf("/");
  const dir = slash === -1 ? "" : sourceKey.slice(0, slash);
  const base = slash === -1 ? sourceKey : sourceKey.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const safeStem = (stem.replace(/[^\w.-]+/g, "_").slice(0, 120) || "clip").replace(/^\.+/, "_");
  const spec =
    count === 1
      ? `at${at === null ? "mid" : String(Math.round(at * 1000)) + "ms"}`
      : (() => {
          const g = gridFor(count);
          return `${g.cols}x${g.rows}`;
        })();
  return `${dir ? dir + "/" : ""}frames/${safeStem}-${spec}.jpg`;
}

/** Every distinguishable way this can fail. These are NOT cosmetic: each implies a different operator
 *  action, and collapsing them is the defect cf#286/#288 exist to remove elsewhere in the stack.
 *  `route-not-served` is EXPECTED during a rollout window (this door's `containers/video-finish` is a
 *  straight mirror of vivijure-cf's copy, synced by scripts/sync-containers.sh AFTER cf#322 merges
 *  upstream, then the image has to be rebuilt and the compose service restarted) -- an operator who
 *  reads a generic error there will go hunting a bug that does not exist.
 *
 *  `store-unpresignable` has NO cf#324 counterpart: it exists because this door has a storage backend
 *  cf's R2-only world does not -- the filesystem backend (LocalObjectPresigner, local#309) refuses to
 *  presign either end honestly rather than pretending. That is a storage-configuration state, not a
 *  container fault, so it gets its own name instead of being folded into `container-error`. */
export type FramesFailureState =
  | "tier-unavailable"
  | "route-not-served"
  | "container-unreachable"
  | "container-error"
  | "store-unpresignable";

export interface FramesFailure {
  ok: false;
  state: FramesFailureState;
  status: number;
  reason: string;
}

export interface FramesSuccess {
  ok: true;
  key: string;
  count: number;
  grid: FramesGrid;
  frame_times: number[];
  duration: number | null;
  reused: boolean;
}

export type FramesOutcome = FramesSuccess | FramesFailure;

const FAILURES: Record<FramesFailureState, { status: number; reason: string }> = {
  "tier-unavailable": {
    status: 503,
    reason:
      "the video-finish tier is not configured on this studio (VIDEO_FINISH_VPC is unbound), so no " +
      "frame can be extracted. Set VIDEO_FINISH_URL (the video-finish container in the default compose " +
      "stack) to enable it.",
  },
  "route-not-served": {
    status: 503,
    reason:
      "the video-finish container is reachable but does not serve POST /frames yet, so its image " +
      "predates cf#322. EXPECTED during a rollout: containers/video-finish is a mirror of vivijure-cf's " +
      "copy (scripts/sync-containers.sh) and only carries this route after cf#322/cf PR #324 merges " +
      "upstream and the image is rebuilt and the compose service restarted. No bug to hunt; re-try after " +
      "that.",
  },
  "container-unreachable": {
    status: 502,
    reason:
      "the video-finish container did not answer (transport failure, or 503/504 after retries). The " +
      "tier is configured; the container itself is down, not started, or unreachable at VIDEO_FINISH_URL.",
  },
  "container-error": {
    status: 502,
    reason:
      "the video-finish container serves POST /frames and rejected or failed on this clip. The tier and " +
      "the route are both fine; the fault is with this input or with ffmpeg on it.",
  },
  "store-unpresignable": {
    status: 503,
    reason:
      "this storage backend cannot mint a scoped, expiring URL for frame extraction (see the presigner's " +
      "own message). Configure MinIO or another S3-compatible store to enable it.",
  },
};

export function framesFailure(state: FramesFailureState, reasonOverride?: string): FramesFailure {
  const f = FAILURES[state];
  return { ok: false, state, status: f.status, reason: reasonOverride ?? f.reason };
}

/** Ask the container for a contact sheet. Retries only the transient gateway statuses, the way
 *  callVideoFinish does, and maps every other outcome onto its OWN state rather than folding them into
 *  one null. */
export async function requestFramesFromContainer(
  vpc: FetcherLike,
  payload: unknown,
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<{ ok: true; body: Record<string, unknown> } | FramesFailure> {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? 1500;
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
  let resp: Response | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      resp = await vpc.fetch("http://video-finish/frames", init);
    } catch {
      resp = null;
    }
    if (resp && resp.status !== 503 && resp.status !== 504) break;
    if (attempt < retries - 1) await new Promise((r) => setTimeout(r, backoffMs));
  }
  if (!resp) return framesFailure("container-unreachable");
  // A 404 from a container that ANSWERED is the rollout state: the service is up, this route is not in
  // its image yet. Distinguished from an unreachable service on purpose.
  if (resp.status === 404) return framesFailure("route-not-served");
  if (resp.status === 503 || resp.status === 504) return framesFailure("container-unreachable");
  if (!resp.ok) return framesFailure("container-error");
  let body: Record<string, unknown>;
  try {
    body = (await resp.json()) as Record<string, unknown>;
  } catch {
    return framesFailure("container-error");
  }
  if (!body || body.ok !== true) return framesFailure("container-error");
  return { ok: true, body };
}

/** The whole operation: reuse an existing sheet if one is already in storage, else presign both ends
 *  and ask the container to build one. The caller has already guarded `sourceKey`. */
export async function buildFramesSheet(
  platform: Platform,
  sourceKey: string,
  count: number,
  at: number | null,
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<FramesOutcome> {
  const key = deriveFramesKey(sourceKey, count, at);
  const grid = gridFor(count);

  // Idempotence: a deterministic key means a repeat request is already answered. Checked BEFORE the
  // tier check on purpose -- an existing sheet is serveable on a studio whose tier was later unbound.
  const existing = await platform.renders.head(key);
  if (existing) {
    return { ok: true, key, count, grid, frame_times: [], duration: null, reused: true };
  }

  const vpc = platform.hostBindings?.VIDEO_FINISH_VPC;
  if (!vpc) return framesFailure("tier-unavailable");

  let videoUrl: string;
  let outputUrl: string;
  try {
    videoUrl = await platform.presigner.presignGet(sourceKey, FRAMES_PRESIGN_TTL_SECONDS);
    outputUrl = await platform.presigner.presignPut(key, FRAMES_CONTENT_TYPE, FRAMES_PRESIGN_TTL_SECONDS);
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "this storage backend cannot mint a scoped, expiring URL for frame extraction";
    return framesFailure("store-unpresignable", message);
  }

  const r = await requestFramesFromContainer(
    vpc,
    { videoUrl, outputUrl, outputKey: key, count, at, cols: grid.cols, rows: grid.rows, contentType: FRAMES_CONTENT_TYPE },
    opts,
  );
  if (!r.ok) return r;

  const times = Array.isArray(r.body.frame_times)
    ? (r.body.frame_times as unknown[]).filter((n): n is number => typeof n === "number")
    : [];
  const duration = typeof r.body.duration === "number" ? r.body.duration : null;
  return { ok: true, key, count, grid, frame_times: times, duration, reused: false };
}

/** HTTP handler for `POST /api/render/frames`. Same guard as `/api/artifact-url` and `/api/artifact`:
 *  the key runs through isSafeRelKey + ARTIFACT_PREFIXES, and existence is checked with head() BEFORE
 *  ever asking the container, so a miss is an honest 404 here rather than a container download failure
 *  later. */
export async function handleRenderFrames(req: Request, platform: Platform): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readBody<Record<string, unknown>>(req);
  } catch {
    throw badRequest("invalid JSON body: expected { key, count?, at? }");
  }

  const key = String(body.key ?? "").trim();
  if (!key || !isSafeRelKey(key) || !ARTIFACT_PREFIXES.some((pre) => key.startsWith(pre))) {
    throw notFound("artifact");
  }
  const src = await platform.renders.head(key);
  if (!src) throw notFound("artifact");

  const asParam = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
  const count = clampFrameCount(asParam(body.count));
  // `at` only means anything for a single frame; for a sheet the container spaces the samples itself.
  const at = count === 1 ? parseFrameAt(asParam(body.at)) : null;

  const outcome = await buildFramesSheet(platform, key, count, at);
  if (!outcome.ok) {
    return json({ error: outcome.reason, state: outcome.state, source_key: key }, outcome.status);
  }
  return json({
    key: outcome.key,
    source_key: key,
    count: outcome.count,
    grid: outcome.grid,
    frame_times: outcome.frame_times,
    duration: outcome.duration,
    reused: outcome.reused,
    content_type: FRAMES_CONTENT_TYPE,
    // Carried in the response on purpose: the honest scope of the evidence travels WITH the evidence, so
    // a caller cannot quote the sheet as "the clip was checked".
    proves:
      "Evidence about the frames sampled at frame_times, not about the whole clip. Per-frame flicker " +
      "and motion between the samples are not visible in a contact sheet.",
  });
}
